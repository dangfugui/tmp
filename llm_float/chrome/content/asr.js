// LLM Float content script — 模块：asr.js（ASR 真实识别 / mock 驱动）
  // ---------- ASR（真实识别在页面顶层 content script 执行；iframe 内 SpeechRecognition 不可用） ----------
  var asrRecognition = null;
  var asrMockTimer = null;
  // 外部驱动（SDK / 控制台）的 ASR 演示：打开识别气泡并进入聆听，内容由 setAsrText / endAsr 控制
  var asrMockLast = "";
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
