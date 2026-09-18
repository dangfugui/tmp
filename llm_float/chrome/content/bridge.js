// LLM Float content script — 模块：bridge.js（Python 桥 / 控制台通道：uiState + bridgeHandle）
  // ---------- Python 桥 / 控制台通道：UI 状态聚合与事件上报 ----------
  // uiState 字段与 JS/storage 命名一致（见 PYTHON-SDK.md §3.3）
  var uiState = {
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

  /* ---------- Python 桥 / 控制台：统一命令入口（case 名 = JS 函数名 = SDK 命令名） ---------- */
  function bridgeHandle(cmd, p = {}) {
    let ok = true, data = null, error = "";
    switch (cmd) {
      case "showChat":   showChat(); if (p.send) pushChat("sendText", { text: p.send }); break;
      case "hideChat":   hideChat(); pushOrbState("idle"); break;
case "hideAll":    hideChat(); hideBubble(); pushOrbState("idle"); break;
      case "sendText":   pushChat("sendText", { text: p.text }); break;
      case "stopChat":   pushChat("stopChat", {}); break;
      case "speakText":  speakText(p.text || ""); break;
      case "stopSpeak":  stopContentTts(); hideBubble(); break;
      case "startAsr":   startAsrRecording(); break;
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
