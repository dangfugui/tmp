// LLM Float content script
// 职责：注入悬浮球 iframe + 聊天 iframe + 字幕气泡 iframe；处理拖动 / 显示隐藏 / 配置推送 / ttsTarget 自动朗读
(() => {
  if (window.__llmFloatInjected) return;
  window.__llmFloatInjected = true;

  const MARGIN = 20;
  const ORB_WIN = 120;

  // ---------- iframe 容器（悬浮球 / 聊天窗 / 字幕气泡） ----------
  const ORB = document.createElement("iframe");
  ORB.className = "llm-float-orb-frame";
  ORB.src = chrome.runtime.getURL("ui/button.html");
  ORB.setAttribute("scrolling", "no");
  document.documentElement.appendChild(ORB);

  const CHAT = document.createElement("iframe");
  CHAT.className = "llm-float-chat-frame";
  CHAT.src = chrome.runtime.getURL("ui/chat.html");
  document.documentElement.appendChild(CHAT);

  const BUBBLE = document.createElement("iframe");
  BUBBLE.className = "llm-float-bubble-frame";
  BUBBLE.src = chrome.runtime.getURL("ui/bubble.html");
  document.documentElement.appendChild(BUBBLE);

  // ---------- 初始位置：右下角（orb 右下，聊天窗在 orb 上方） ----------
  function initPos() {
    ORB.style.right = MARGIN + "px";
    ORB.style.bottom = MARGIN + "px";
    ORB.style.left = "auto";
    ORB.style.top = "auto";
    CHAT.style.right = (MARGIN + ORB_WIN) + "px";
    CHAT.style.bottom = (MARGIN + ORB_WIN + 12) + "px";
    CHAT.style.left = "auto";
    CHAT.style.top = "auto";
  }
  initPos();
  window.addEventListener("resize", () => { if (!dragging) initPos(); });

  // ---------- iframe 通信辅助 ----------
  function post(frame, data) {
    try { frame.contentWindow.postMessage(data, "*"); } catch (e) { /* iframe 未就绪 */ }
  }
  function pushOrb(name, payload) { post(ORB, { kind: "assistant", name, payload }); }
  function pushChat(name, payload) { post(CHAT, { kind: "assistant", name, payload }); }
  function pushBubble(name, payload) { post(BUBBLE, { kind: "assistant", name, payload }); }

  // ---------- Python 桥 / 控制台通道：UI 状态聚合与事件上报 ----------
  // uiState 字段与 JS/storage 命名一致（见 PYTHON-SDK.md §3.3）
  let uiState = {
    orb:    { enabled: true, state: "idle" },
    chat:   { open: false, busy: false },
    bubble: { show: false, mode: "subtitle" },
    tts:    { speaking: false, current: "" },
    asr:    { listening: false },
  };
  function reportToBridge(name, payload) {
    try { chrome.runtime.sendMessage({ type: "llm_bridge_event", name, payload }); } catch (e) { /* 忽略 */ }
  }
  function setUi(patch) {
    Object.assign(uiState, patch);
    reportToBridge("uiState", uiState);
  }
  function pushOrbState(state) {
    uiState.orb.state = state;
    pushOrb("setOrbState", { state });
    reportToBridge("orbState", { state });
    reportToBridge("uiState", uiState);
  }

  // ---------- 弹窗跟随悬浮球定位 ----------
  // 锚定的是【可见的圆】（圆在 120×120 iframe 内居中，不是透明外框），
  // 否则弹窗会贴在透明框边缘，视觉上离圆有一截"隐形距离"。
  // mode "top-left"：聊天窗 → 右下角贴圆的左上角（左不够放右侧，上不够放下方）
  // mode "left"   ：字幕气泡 → 右侧贴圆的左侧、垂直居中（左不够放右侧）
  let orbSize = 68; // 可见圆直径（跟随设置 orb_size）
  function placePanel(frame, w, h, mode) {
    const r = ORB.getBoundingClientRect();
    const inset = Math.max(0, (r.width - orbSize) / 2); // 圆在 iframe 内的内边距
    const cx = r.left + inset;   // 圆左上角 x
    const cy = r.top + inset;    // 圆左上角 y
    const gap = mode === "left" ? 10 : 0; // 气泡留 10px 呼吸感；聊天窗零间距
    let left, top;
    if (mode === "left") {
      left = cx - w - gap;
      top = Math.round(cy + orbSize / 2 - h / 2);
      if (left < 8) left = (r.right - inset) + gap; // 左侧放不下 → 球右侧
    } else {
      left = cx - w - gap;
      top = cy - h - gap;
      if (left < 8) left = (r.right - inset) + gap; // 左边不够 → 球右侧
      if (top < 8) top = cy + orbSize + gap;        // 上方不够 → 球下方
    }
    top = Math.min(Math.max(8, top), window.innerHeight - h - 8);
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    frame.style.left = left + "px";
    frame.style.top = top + "px";
    frame.style.right = "auto";
    frame.style.bottom = "auto";
  }

  function showBubble() {
    hideChat(); // 互斥：打开字幕气泡先关聊天窗
    BUBBLE.classList.add("show");
    placePanel(BUBBLE, 420, 96, "left"); // 正左方、垂直居中
    setUi({ bubble: { show: true } });
    reportToBridge("bubbleShown", { mode: uiState.bubble.mode });
  }
  function hideBubble() {
    BUBBLE.classList.remove("show");
    stopContentTts();
    stopAsr();
    pushBubble("stopDemo", {}); // 停止气泡内正在播放的 TTS / 正在识别的 ASR
    setUi({ bubble: { show: false, mode: "subtitle" }, tts: { speaking: false, current: "" }, asr: { listening: false } });
    reportToBridge("bubbleHidden", {});
  }
  function stopContentTts() {
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
  }

  // ---------- ASR（真实识别在页面顶层 content script 执行；iframe 内 SpeechRecognition 不可用） ----------
  let asrRecognition = null;
  let asrMockTimer = null;
  // 外部驱动（SDK / 控制台）的 ASR 演示：打开识别气泡并进入聆听，内容由 setAsrText / endAsr 控制
  let asrMockLast = "";
  function openAsrMock() {
    stopAsr();
    pushOrbState("asr");
    showBubble();
    pushBubble("setMode", { mode: "asr" });
    pushBubble("onAsrState", { state: "listening" });
    setUi({ bubble: { mode: "asr" }, asr: { listening: true } });
    reportToBridge("onAsrState", { state: "listening" });
  }
  // DEMO 用模拟识别过程：不依赖麦克风/网络（内网环境真实识别不可用时也能展示效果）
  function startAsrMock() {
    openAsrMock();
    const full = "大家好，这是语音识别演示，正在模拟实时转写的过程，欢迎体验。";
    let n = 0;
    const step = () => {
      n += 2;
      if (n >= full.length) {
        if (asrMockTimer) clearInterval(asrMockTimer);
        asrMockTimer = null;
        pushBubble("onAsrFinal", { text: full });
        reportToBridge("onAsrFinal", { text: full });
        pushBubble("onAsrState", { state: "idle" });
        reportToBridge("onAsrState", { state: "idle" });
        setUi({ asr: { listening: false } });
        if (!CHAT.classList.contains("show")) pushOrbState("idle");
        return;
      }
      const partial = full.slice(0, n);
      pushBubble("onAsrPartial", { text: partial });
      reportToBridge("onAsrPartial", { text: partial });
    };
    asrMockTimer = setInterval(step, 180);
  }
  function startAsr() {
    stopAsr();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      pushBubble("setMode", { mode: "asr" });
      pushBubble("onAsrState", { state: "idle" });
      pushBubble("onAsrPartial", { text: "当前浏览器不支持语音识别" });
      return;
    }
    pushBubble("setMode", { mode: "asr" });
    pushBubble("onAsrState", { state: "listening" });
    pushBubble("onAsrPartial", { text: "聆听中…" });
    setUi({ bubble: { mode: "asr" }, asr: { listening: true } });
    reportToBridge("onAsrState", { state: "listening" });
    let rec;
    try {
      rec = new SR();
    } catch (e) {
      pushBubble("onAsrState", { state: "idle" });
      pushBubble("onAsrPartial", { text: "无法启动识别：" + (e && e.message ? e.message : String(e)) });
      return;
    }
    asrRecognition = rec;
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev) => {
      let interim = "", final = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) { pushBubble("onAsrFinal", { text: final }); reportToBridge("onAsrFinal", { text: final }); }
      else if (interim) { pushBubble("onAsrPartial", { text: interim }); reportToBridge("onAsrPartial", { text: interim }); }
    };
    rec.onend = () => {
      asrRecognition = null;
      pushBubble("onAsrState", { state: "idle" });
      reportToBridge("onAsrState", { state: "idle" });
      setUi({ asr: { listening: false } });
      if (!CHAT.classList.contains("show")) pushOrbState("idle");
    };
    rec.onerror = (ev) => {
      pushBubble("onAsrState", { state: "idle" });
      reportToBridge("onAsrState", { state: "idle" });
      setUi({ asr: { listening: false } });
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        pushBubble("onAsrPartial", { text: "麦克风权限被拒绝，请在地址栏允许麦克风后重试" });
      } else if (ev.error === "no-speech") {
        pushBubble("onAsrPartial", { text: "未检测到语音" });
      } else if (ev.error) {
        pushBubble("onAsrPartial", { text: "识别出错：" + ev.error });
      }
    };
    try { rec.start(); } catch (e) {
      asrRecognition = null;
      pushBubble("onAsrState", { state: "idle" });
      pushBubble("onAsrPartial", { text: "无法启动识别：" + (e && e.message ? e.message : String(e)) });
    }
  }
  function stopAsr() {
    if (asrMockTimer) { clearInterval(asrMockTimer); asrMockTimer = null; }
    if (asrRecognition) {
      try { asrRecognition.stop(); } catch (e) { /* 忽略 */ }
      asrRecognition = null;
    }
  }

  // 当前主题（所有 iframe 共用），供推送与 ttsTarget 字幕使用
  let currentTheme = "flat";
  function pushThemeAll() {
    pushOrb("setTheme", { theme: currentTheme });
    pushChat("setTheme", { theme: currentTheme });
    pushBubble("setTheme", { theme: currentTheme });
  }
  function pushOrbSize() {
    try {
      chrome.storage.local.get(["orb_size"], (d) => {
        orbSize = d.orb_size || 68;
        pushOrb("setOrbSize", { size: orbSize });
      });
    } catch (e) { /* 忽略 */ }
  }
  function pushProfiles() {
    try {
      chrome.storage.local.get(["chat_profiles", "active_profile_name"], (d) => {
        pushChat("setChatProfiles", { profiles: d.chat_profiles || [] });
        pushChat("setActiveChatProfile", { profile: { chatName: d.active_profile_name || "" } });
      });
    } catch (e) { /* 忽略 */ }
  }
  // iframe 加载完成后重推（防止 postMessage 早于 iframe 脚本注册而丢失）
  ORB.addEventListener("load", () => { pushThemeAll(); pushOrbSize(); });
  CHAT.addEventListener("load", () => { pushThemeAll(); pushProfiles(); });
  BUBBLE.addEventListener("load", () => { pushThemeAll(); });

  // ---------- 初始化：拉全局配置并推给 iframe ----------
  function setEnabled(enabled) {
    const on = !!enabled; // 悬浮助手总开关（默认开启）
    ORB.classList.toggle("llm-float-disabled", !on);
    CHAT.classList.toggle("llm-float-disabled", !on);
    BUBBLE.classList.toggle("llm-float-disabled", !on);
    if (!on) { hideChat(); hideBubble(); }
    setUi({ orb: { enabled: on } });
  }
  try {
    chrome.runtime.sendMessage({ type: "llm_init" }, (resp) => {
      if (chrome.runtime.lastError) return;
      const d = (resp && resp.data) || {};
      currentTheme = d.theme || "flat";
      pushThemeAll();
      orbSize = d.orb_size || 68;
      pushOrb("setOrbSize", { size: orbSize });
      pushChat("setChatProfiles", { profiles: d.chat_profiles || [] });
      pushChat("setActiveChatProfile", { profile: { chatName: d.active_profile_name || "" } });
      setEnabled(d.orb_enabled !== false);
      startTtsTarget();
    });
  } catch (e) { /* 忽略 */ }

  // ---------- iframe → content script（postMessage） ----------
  window.addEventListener("message", (e) => {
    const data = e.data || {};
    if (data.kind === "orb") {
      if (data.action === "drag_move") moveDrag(data.x, data.y);
      else if (data.action === "drag_end") endDrag();
      else if (data.action === "open_chat") { endDrag(); showChat(); pushOrbState("chat"); }
      else if (data.action === "open_asr") {
        // 悬浮球右键：开始语音识别（先停 TTS/旧识别，再开本页 ASR 气泡，识别在页面顶层执行）
        stopContentTts();
        stopAsr();
        pushOrbState("asr");
        showBubble();
        pushBubble("setTheme", { theme: currentTheme });
        startAsr();
      }
    } else if (data.kind === "chat") {
      if (data.action === "drag_start") startMaskDrag(CHAT);
      else if (data.action === "hide") { hideChat(); pushOrbState("idle"); }
      else if (data.action === "chat_busy") { setUi({ chat: { open: true, busy: !!data.busy } }); }
    } else if (data.kind === "bubble") {
      if (data.action === "demo_done") {
        // 气泡结束：聊天窗开着时不改悬浮球状态（保持 chat 态）
        if (CHAT.classList.contains("show")) return;
        pushOrbState("idle");
      }
    } else if (data.kind === "llm-ctrl") {
      // 页面控制台 / 页面脚本通道（命令名 = bridgeHandle case 名 = SDK 命令名）
      const r = bridgeHandle(data.cmd, data.params || {});
      window.postMessage({ kind: "llm-ctrl-reply", id: data.id, data: r }, "*");
    }
  });

  // ---------- 拖动 ----------
  // 悬浮球：Pointer Capture 协议（button.js 捕获指针后按屏幕坐标上报 drag_move/drag_end，无遮罩）
  // 聊天窗：遮罩协议（chat iframe 内 drag_start → 全屏遮罩接管 mousemove）
  let dragging = false;
  let dragFrame = null;  // pointer 模式：当前拖动的 iframe
  let dragOrigin = null; // pointer 模式：起始 {left, top}
  let dragMouse = null;  // pointer 模式：起始 {x, y}
  let dragEndFn = null;  // 遮罩模式：结束函数

  function ensureOrbDrag(x, y) {
    if (dragFrame) return;
    dragFrame = ORB;
    const r = ORB.getBoundingClientRect();
    dragOrigin = { left: r.left, top: r.top };
    dragMouse = { x: x, y: y };
    ORB.style.left = r.left + "px";
    ORB.style.top = r.top + "px";
    ORB.style.right = "auto";
    ORB.style.bottom = "auto";
  }
  function moveDrag(x, y) {
    // 注意顺序：dragFrame 为 null（首次拖动）时必须先初始化，不能直接 return
    if (!dragFrame) { ensureOrbDrag(x, y); return; }
    if (dragFrame !== ORB) return;
    if (!dragOrigin || !dragMouse) { ensureOrbDrag(x, y); return; }
    ORB.style.left = (dragOrigin.left + (x - dragMouse.x)) + "px";
    ORB.style.top = (dragOrigin.top + (y - dragMouse.y)) + "px";
    // 强关联：拖动悬浮球时，开着的弹窗实时跟随贴靠
    if (CHAT.classList.contains("show")) placePanel(CHAT, 400, 620, "top-left");
    if (BUBBLE.classList.contains("show")) placePanel(BUBBLE, 420, 96, "left");
  }
  function endDrag() {
    const wasOrb = (dragFrame === ORB);
    dragFrame = null;
    dragOrigin = null;
    dragMouse = null;
    if (dragEndFn) dragEndFn();
    dragEndFn = null;
    dragging = false;
    // 拖动悬浮球结束：开着的弹窗收尾贴靠一次（拖动聊天窗自身不重置其位置）
    if (wasOrb) {
      if (CHAT.classList.contains("show")) placePanel(CHAT, 400, 620, "top-left");
      if (BUBBLE.classList.contains("show")) placePanel(BUBBLE, 420, 96, "left");
    }
  }

  /* 遮罩模式（聊天窗）：全屏透明遮罩接管鼠标。
     不要用 ev.buttons 判断松开——mousedown 在 iframe 内、鼠标移到遮罩后，
     Chrome 跨 iframe 边界不传递按钮状态，buttons 恒为 0 会把拖动立即误杀。 */
  function startMaskDrag(frame) {
    if (dragging) return;
    dragging = true;
    const mask = document.createElement("div");
    mask.id = "llm-float-drag-mask";
    mask.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;cursor:grabbing;background:transparent;";
    document.documentElement.appendChild(mask);
    let started = false, sx = 0, sy = 0, bx = 0, by = 0;
    const end = () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", end);
      mask.removeEventListener("mouseup", end);
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
      dragEndFn = null;
      dragging = false;
    };
    const mv = (ev) => {
      if (!started) {
        started = true;
        const r = frame.getBoundingClientRect();
        bx = r.left; by = r.top; sx = ev.clientX; sy = ev.clientY;
        frame.style.left = bx + "px";
        frame.style.top = by + "px";
        frame.style.right = "auto";
        frame.style.bottom = "auto";
      }
      frame.style.left = (bx + ev.clientX - sx) + "px";
      frame.style.top = (by + ev.clientY - sy) + "px";
    };
    dragEndFn = end;
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", end);
    mask.addEventListener("mouseup", end); // 遮罩上松开：主结束路径（直接命中，不依赖冒泡）
  }

  function showChat() {
    hideBubble(); // 互斥：打开聊天窗先关字幕气泡（并停止 TTS/ASR）
    CHAT.classList.add("show");
    placePanel(CHAT, 400, 620, "top-left"); // 左上方
    pushChat("onChatFocus", {});
    setUi({ chat: { open: true, busy: false } });
    reportToBridge("chatOpened", {});
  }
  function hideChat() {
    CHAT.classList.remove("show");
    setUi({ chat: { open: false, busy: false } });
    reportToBridge("chatClosed", {});
  }

  /* ---------- Python 桥 / 控制台：统一命令入口（case 名 = JS 函数名 = SDK 命令名） ---------- */
  function bridgeHandle(cmd, p = {}) {
    let ok = true, data = null, error = "";
    switch (cmd) {
      case "showChat":   showChat(); if (p.send) pushChat("sendText", { text: p.send }); break;
      case "hideChat":   hideChat(); pushOrbState("idle"); break;
      case "sendText":   pushChat("sendText", { text: p.text }); break;
      case "stopChat":   pushChat("stopChat", {}); break;
      case "speakText":  speakText(p.text || ""); break;
      case "stopSpeak":  stopContentTts(); hideBubble(); break;
      case "startAsr":   openAsrMock(); break;
      case "setAsrText": {
        const t = String(p.text || "");
        if (!t) break;
        if (uiState.asr.listening !== true) openAsrMock();
        asrMockLast = t;
        pushBubble("onAsrPartial", { text: t });
        reportToBridge("onAsrPartial", { text: t });
        break;
      }
      case "endAsr": {
        const t = (typeof p.text === "string" && p.text) ? p.text : asrMockLast;
        if (t) { pushBubble("onAsrFinal", { text: t }); reportToBridge("onAsrFinal", { text: t }); }
        pushBubble("onAsrState", { state: "idle" });
        reportToBridge("onAsrState", { state: "idle" });
        setUi({ asr: { listening: false } });
        asrMockLast = "";
        setTimeout(() => hideBubble(), 1200);
        pushOrbState("idle");
        break;
      }
      case "stopAsr":    stopAsr(); hideBubble(); pushOrbState("idle"); break;
      case "setTheme":   currentTheme = p.theme || currentTheme; pushThemeAll(); break;
      case "setOrbSize": orbSize = p.orb_size || orbSize; pushOrb("setOrbSize", { size: orbSize }); break;
      case "setOrbOpacity": pushOrb("setOpacity", { opacity: p.orb_opacity }); pushBubble("setOpacity", { opacity: p.orb_opacity }); break;
      case "ping":       data = {}; break;
      case "getState":   data = uiState; break;
      default: ok = false; error = "unknown cmd: " + cmd;
    }
    return { ok, data, error };
  }

  // ---------- background → content script ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "llm_bridge") {
      // Python 桥命令（background 转发）：同步响应
      sendResponse(bridgeHandle(msg.cmd, msg.params || {}));
    } else if (msg.type === "llm_set_orb_enabled") {
      setEnabled(msg.enabled !== false);
    } else if (msg.type === "llm_active_profile") {
      pushChat("setActiveChatProfile", { profile: { chatName: msg.name || "" } });
      startTtsTarget();
    } else if (msg.type === "llm_config_updated") {
      // 设置页保存后：重拉配置推给 iframe
      try {
        chrome.runtime.sendMessage({ type: "llm_init" }, (resp) => {
          if (chrome.runtime.lastError) return;
          const d = (resp && resp.data) || {};
          currentTheme = d.theme || "flat";
          pushThemeAll();
          orbSize = d.orb_size || 68;
          pushOrb("setOrbSize", { size: orbSize });
          pushChat("setChatProfiles", { profiles: d.chat_profiles || [] });
          startTtsTarget();
        });
      } catch (e) { /* 忽略 */ }
    } else if (msg.type === "llm_demo") {
      // 工具栏 popup / 设置页 TTS / ASR demo：先停旧 TTS/ASR，再显示字幕气泡执行（互斥：开气泡自动关聊天窗）
      stopContentTts();
      stopAsr();
      const isAsr = msg.demo === "asr";
      pushOrbState(isAsr ? "asr" : "tts");
      showBubble();
      pushBubble("setTheme", { theme: currentTheme });
      if (isAsr) startAsrMock(); // DEMO 按钮：模拟识别过程（内网/无麦克风也能演示）
      else pushBubble("runDemo", { type: "tts" });
    }
  });

  // ---------- TTS 定位（ttsTarget）：网页指定 id 出现新文本时朗读 + 字幕 ----------
  let ttsObserver = null;
  let ttsTimer = null;
  let ttsTargetId = "";
  let ttsLastText = "";

  function startTtsTarget() {
    try {
      chrome.storage.local.get(["chat_profiles", "active_profile_name"], (d) => {
        const profiles = d.chat_profiles || [];
        const name = d.active_profile_name || "";
        const profile = profiles.find((p) => p.chatName === name) || profiles[0] || {};
        const target = (profile.ttsTarget || "").trim();
        if (ttsTargetId === target && ttsObserver) return; // 无变化
        stopTtsTarget();
        ttsTargetId = target;
        if (!target) return;
        ttsTimer = setInterval(() => {
          const el = document.getElementById(target);
          if (!el || ttsObserver) return;
          ttsLastText = el.textContent || "";
          ttsObserver = new MutationObserver(() => {
            const text = el.textContent || "";
            if (text.length > ttsLastText.length) {
              const added = text.slice(ttsLastText.length);
              ttsLastText = text;
              if (added.trim()) speakText(added.trim());
            }
          });
          ttsObserver.observe(el, { childList: true, characterData: true, subtree: true });
          clearInterval(ttsTimer);
          ttsTimer = null;
        }, 1000);
      });
    } catch (e) { /* 忽略 */ }
  }

  function stopTtsTarget() {
    if (ttsObserver) { try { ttsObserver.disconnect(); } catch (e) { /* 忽略 */ } ttsObserver = null; }
    if (ttsTimer) { clearInterval(ttsTimer); ttsTimer = null; }
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
    ttsTargetId = "";
  }

  function speakText(text) {
    try {
      stopAsr(); // 互斥：朗读时停止正在进行的识别
      const sentences = String(text).split(/[。！？!?；;]/).map(s => s.trim()).filter(Boolean);
      if (!sentences.length) return;
      showBubble();
      pushBubble("setTheme", { theme: currentTheme });
      const total = sentences.length;
      const say = (i) => {
        if (i >= total) {
          setUi({ tts: { speaking: false, current: "" } });
          reportToBridge("onTtsIdle", {});
          setTimeout(() => hideBubble(), 1200);
          return;
        }
        const s = sentences[i];
        setUi({ bubble: { mode: "subtitle" }, tts: { speaking: true, current: s } });
        reportToBridge("onTtsSentence", { text: s, index: i + 1, total });
        pushBubble("onTtsSentence", { text: s });
        const u = new SpeechSynthesisUtterance(s);
        u.lang = "zh-CN";
        u.onend = () => say(i + 1);
        u.onerror = () => say(i + 1);
        speechSynthesis.speak(u);
      };
      say(0);
    } catch (e) { /* 忽略 */ }
  }
})();
