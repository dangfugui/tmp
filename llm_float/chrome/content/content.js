// LLM Float content script
// 职责：注入悬浮球 iframe + 聊天 iframe + 字幕气泡 iframe；处理拖动 / 显示隐藏 / 配置推送 / ttsTarget 自动朗读
(() => {
  if (window.__llmFloatInjected) return;
  window.__llmFloatInjected = true;

  const MARGIN = 20;
  const ORB_WIN = 120;

  // ---------- 容器 ----------
  const ROOT = document.createElement("div");
  ROOT.id = "llm-float-root";
  document.documentElement.appendChild(ROOT);

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

  function showBubble() { BUBBLE.classList.add("show"); }
  function hideBubble() { BUBBLE.classList.remove("show"); }

  // 当前主题（所有 iframe 共用），供推送与 ttsTarget 字幕使用
  let currentTheme = "flat";
  function pushThemeAll() {
    pushOrb("setTheme", { theme: currentTheme });
    pushChat("setTheme", { theme: currentTheme });
    pushBubble("setTheme", { theme: currentTheme });
  }
  function pushOrbSize() {
    try {
      chrome.storage.local.get(["orb_size"], (d) => pushOrb("setOrbSize", { size: d.orb_size || 68 }));
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
  try {
    chrome.runtime.sendMessage({ type: "llm_init" }, (resp) => {
      const d = (resp && resp.data) || {};
      currentTheme = d.theme || "flat";
      pushThemeAll();
      pushOrb("setOrbSize", { size: d.orb_size || 68 });
      pushChat("setChatProfiles", { profiles: d.chat_profiles || [] });
      pushChat("setActiveChatProfile", { profile: { chatName: d.active_profile_name || "" } });
      startTtsTarget();
    });
  } catch (e) { /* 忽略 */ }

  // ---------- iframe → content script（postMessage） ----------
  window.addEventListener("message", (e) => {
    const data = e.data || {};
    if (data.kind === "orb") {
      if (data.action === "drag_start") startDrag(ORB);
      else if (data.action === "open_chat") { showChat(); pushOrb("setOrbState", { state: "chat" }); }
      else if (data.action === "open_settings") {
        pushOrb("setOrbState", { state: "settings" });
        try { chrome.runtime.sendMessage({ type: "llm_open_options" }); } catch (err) { /* 忽略 */ }
      }
    } else if (data.kind === "chat") {
      if (data.action === "drag_start") startDrag(CHAT);
      else if (data.action === "hide") { hideChat(); pushOrb("setOrbState", { state: "idle" }); }
    } else if (data.kind === "bubble") {
      if (data.action === "demo_done") pushOrb("setOrbState", { state: "idle" });
    }
  });

  // ---------- 拖动（content script 全局监听 mousemove） ----------
  let dragging = false;
  function startDrag(frame) {
    if (dragging) return;
    dragging = true;
    let started = false, sx = 0, sy = 0, bx = 0, by = 0;
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
    const up = () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
      dragging = false;
    };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
  }

  function showChat() {
    CHAT.classList.add("show");
    pushChat("onChatFocus", {});
  }
  function hideChat() {
    CHAT.classList.remove("show");
  }

  // ---------- background → content script ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === "llm_active_profile") {
      pushChat("setActiveChatProfile", { profile: { chatName: msg.name || "" } });
      startTtsTarget();
    } else if (msg.type === "llm_config_updated") {
      // 设置页保存后：重拉配置推给 iframe
      try {
        chrome.runtime.sendMessage({ type: "llm_init" }, (resp) => {
          const d = (resp && resp.data) || {};
          currentTheme = d.theme || "flat";
          pushThemeAll();
          pushOrb("setOrbSize", { size: d.orb_size || 68 });
          pushChat("setChatProfiles", { profiles: d.chat_profiles || [] });
          startTtsTarget();
        });
      } catch (e) { /* 忽略 */ }
    } else if (msg.type === "llm_demo") {
      // 设置页 TTS / ASR demo：显示字幕气泡并执行，悬浮球切对应状态
      showBubble();
      const isAsr = msg.demo === "asr";
      pushOrb("setOrbState", { state: isAsr ? "asr" : "tts" });
      pushBubble("setTheme", { theme: currentTheme });
      pushBubble("runDemo", { type: isAsr ? "asr" : "tts" });
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
      const sentences = String(text).split(/[。！？!?；;]/).map(s => s.trim()).filter(Boolean);
      if (!sentences.length) return;
      showBubble();
      pushBubble("setTheme", { theme: currentTheme });
      const say = (i) => {
        if (i >= sentences.length) {
          setTimeout(() => hideBubble(), 1200);
          return;
        }
        pushBubble("onTtsSentence", { text: sentences[i] });
        const u = new SpeechSynthesisUtterance(sentences[i]);
        u.lang = "zh-CN";
        u.onend = () => say(i + 1);
        u.onerror = () => say(i + 1);
        speechSynthesis.speak(u);
      };
      say(0);
    } catch (e) { /* 忽略 */ }
  }
})();
