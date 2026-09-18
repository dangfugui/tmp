// LLM Float content script — 模块：tts.js（TTS 朗读 + ttsTarget 自动朗读）
  function stopContentTts() {
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
  }

  // ---------- TTS 定位（ttsTarget）：网页指定 id 出现新文本时朗读 + 字幕 ----------
  var ttsObserver = null;
  var ttsTimer = null;
  var ttsTargetId = "";
  var ttsLastText = "";

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
