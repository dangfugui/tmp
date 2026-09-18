// LLM Float content script — 模块：ui.js（iframe 容器 / 定位 / 显隐 / 配置推送 / 初始化）
// 与 drag.js / tts.js / asr.js / bridge.js / main.js 共享 isolated world 全局（顶层 var 声明，跨文件可见）
// 顶层共享变量必须用 var：重复注入时 var 可覆盖而不报 SyntaxError；副作用集中在 initUi（由 main.js 注入守卫调用一次）

var MARGIN = 20;
var ORB_WIN = 120;
var ORB = null;    // iframe 容器（悬浮球）
var CHAT = null;   // iframe 容器（聊天窗）
var BUBBLE = null; // iframe 容器（字幕气泡）

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

  // ---------- iframe 通信辅助 ----------
  function post(frame, data) {
    try { frame.contentWindow.postMessage(data, "*"); } catch (e) { /* iframe 未就绪 */ }
  }
  function pushOrb(name, payload) { post(ORB, { kind: "assistant", name, payload }); }
  function pushChat(name, payload) { post(CHAT, { kind: "assistant", name, payload }); }
  function pushBubble(name, payload) { post(BUBBLE, { kind: "assistant", name, payload }); }

  // ---------- 弹窗跟随悬浮球定位 ----------
  // 锚定的是【可见的圆】（圆在 120×120 iframe 内居中，不是透明外框），
  // 否则弹窗会贴在透明框边缘，视觉上离圆有一截"隐形距离"。
  // mode "top-left"：聊天窗 → 右下角贴圆的左上角（左不够放右侧，上不够放下方）
  // mode "left"   ：字幕气泡 → 右侧贴圆的左侧、垂直居中（左不够放右侧）
  var orbSize = 68; // 可见圆直径（跟随设置 orb_size）
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

  // 当前主题（所有 iframe 共用），供推送与 ttsTarget 字幕使用
  var currentTheme = "flat";
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

  // ---------- 初始化：拉全局配置并推给 iframe ----------
  function setEnabled(enabled) {
    const on = !!enabled; // 悬浮助手总开关（默认开启）
    ORB.classList.toggle("llm-float-disabled", !on);
    CHAT.classList.toggle("llm-float-disabled", !on);
    BUBBLE.classList.toggle("llm-float-disabled", !on);
    if (!on) { hideChat(); hideBubble(); }
    setUi({ orb: { enabled: on } });
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

  /* 副作用初始化（创建 iframe / 注册事件 / 拉配置），由 main.js 注入守卫调用一次 */
  function initUi() {
    ORB = document.createElement("iframe");
    ORB.className = "llm-float-orb-frame";
    ORB.src = chrome.runtime.getURL("ui/button.html");
    ORB.setAttribute("scrolling", "no");
    document.documentElement.appendChild(ORB);

    CHAT = document.createElement("iframe");
    CHAT.className = "llm-float-chat-frame";
    CHAT.src = chrome.runtime.getURL("ui/chat.html");
    document.documentElement.appendChild(CHAT);

    BUBBLE = document.createElement("iframe");
    BUBBLE.className = "llm-float-bubble-frame";
    BUBBLE.src = chrome.runtime.getURL("ui/bubble.html");
    document.documentElement.appendChild(BUBBLE);

    initPos();
    window.addEventListener("resize", () => { if (!dragging) initPos(); });
    // iframe 加载完成后重推（防止 postMessage 早于 iframe 脚本注册而丢失）
    ORB.addEventListener("load", () => { pushThemeAll(); pushOrbSize(); });
    CHAT.addEventListener("load", () => { pushThemeAll(); pushProfiles(); });
    BUBBLE.addEventListener("load", () => { pushThemeAll(); });
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
        // tts.js 可能在动态注入时尚未加载完成，存在性检查避免竞态
        if (typeof startTtsTarget === "function") startTtsTarget();
      });
    } catch (e) { /* 忽略 */ }
  }
