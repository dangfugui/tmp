// LLM Float content script — 功能单元：asr.js（语音识别：录音 + 接口识别 / 浏览器实时识别）
// 非流式（http）：MediaRecorder 录音 → 停止 → POST {host}/v1/audio/transcriptions（OpenAI 兼容）→ 结果 → 聊天窗
// 流式（stream）：浏览器 SpeechRecognition 实时识别（partial 持续显示）→ 结束 → 结果 → 聊天窗
// 未配置 HOST / 浏览器不支持时给出清晰提示；关闭（off）时右键无动作
  var asrMediaRec = null;
  var asrMediaChunks = [];
  var asrMediaStream = null;
  var asrWebRec = null;   // SpeechRecognition（流式实时）
  var asrWebFinal = "";   // 浏览器识别累积结果
  var asrStopIntent = false; // 用户点停止：收尾识别并发送
  var asrMuted = false;      // 互斥停止（TTS 播报 / 关闭气泡）：不识别不发送
  var asrActive = false;
  var asrMockTimer = null;
  var asrMockLast = "";
  var asrAudioCtx = null;
  var asrAnalyser = null;
  var asrVolumeRaf = null;

  // HOST 容错：允许误填完整接口路径（如 .../v1/audio/transcriptions），剥到根地址再拼接
  function normalizeHost(h) {
    return String(h || "").trim().replace(/\/+$/, "").replace(/\/(v1\/audio\/(speech\/stream|speech|transcriptions))$/i, "");
  }

  function getAsrConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["asr_mode", "asr_host", "asr_api_key", "asr_model", "asr_language"], (d) => resolve(d || {}));
      } catch (e) { resolve({}); }
    });
  }

  function openAsrUi() {
    // 注意：不要在这里调 stopAsr()——它会把 asrMuted 置 true，污染 getUserMedia 等待期的状态判断。
    // 所有调用方（startMediaRecord / startAsrWebRecognition）入口均已先 stopAsr()。
    pushOrbState("asr");
    openPanel("bubble");
    BUBBLE.classList.add("asr-active"); // 开启气泡点击（停止按钮）
    pushBubble("setMode", { mode: "asr" });
    pushBubble("setTheme", { theme: currentTheme });
    pushBubble("onAsrState", { state: "listening" });
    setUi({ bubble: { mode: "asr" }, asr: { listening: true } });
    reportToBridge("onAsrState", { state: "listening" });
  }
  function showAsrText(t) {
    pushBubble("onAsrPartial", { text: t });
    reportToBridge("onAsrPartial", { text: t });
  }
  function showAsrFinal(t) {
    pushBubble("onAsrFinal", { text: t });
    reportToBridge("onAsrFinal", { text: t });
    pushBubble("onAsrState", { state: "idle" });
    reportToBridge("onAsrState", { state: "idle" });
    setUi({ asr: { listening: false } });
  }
  function showAsrFail(text) {
    pushBubble("onAsrState", { state: "idle" });
    reportToBridge("onAsrState", { state: "idle" });
    showAsrText(text);
    setUi({ asr: { listening: false } });
    setTimeout(() => closePanel("bubble"), 2400);
    pushOrbState("idle");
  }
  function releaseMic() {
    if (asrVolumeRaf) { clearTimeout(asrVolumeRaf); asrVolumeRaf = null; }
    if (asrAudioCtx) { try { asrAudioCtx.close(); } catch (e) {} asrAudioCtx = null; }
    asrAnalyser = null;
    if (asrMediaStream) {
      try { asrMediaStream.getTracks().forEach((tr) => tr.stop()); } catch (e) { /* 忽略 */ }
      asrMediaStream = null;
    }
  }

  // 识别结果 → 打开聊天窗并作为用户消息发送（触发 AI 回复）
  function sendResultToChat(text) {
    const t = String(text || "").trim();
    if (!t) return;
    stopAsr();
    pushOrbState("idle");
    setTimeout(() => {
      callCommand("showChat", {});
      pushChat("sendText", { text: t });
    }, 120);
  }

  // 入口：悬浮球右键 / SDK startAsr —— 按设置的模式分流
  function startAsrRecording() {
    stopAsr();
    getAsrConfig().then((cfg) => {
      const mode = cfg.asr_mode || "http";
      if (mode === "off") return; // 关闭：右键无动作
      if (mode === "stream") { startAsrWebRecognition(); return; } // 流式：实时识别持续显示
      startMediaRecord(); // 非流式：录音 → 停止 → 识别
    });
  }

  // ---------- 非流式：MediaRecorder 录音 ----------
  function startMediaRecord() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      showAsrFail("当前页面不支持麦克风录音（需要 HTTPS 或 localhost 环境）");
      return;
    }
    asrStopIntent = false;
    asrMuted = false;
    openAsrUi();
    console.log("[llm-float][asr] 请求麦克风权限...");
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (asrMuted) {
        // 权限等待期间已被停止（互斥/关闭），不启动录音并释放麦克风
        console.log("[llm-float][asr] 权限等待期间被停止，释放麦克风");
        try { stream.getTracks().forEach((tr) => tr.stop()); } catch (e) { /* 忽略 */ }
        return;
      }
      asrStopIntent = false;
      asrMuted = false;
      asrMediaStream = stream;
      asrMediaChunks = [];
      let rec;
      try {
        const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch (e) {
        rec = new MediaRecorder(stream);
      }
      asrMediaRec = rec;
      rec.ondataavailable = (e) => { if (e.data && e.data.size) asrMediaChunks.push(e.data); };
      rec.onstop = () => onMediaStopped();
      rec.start();
      asrActive = true;
      console.log("[llm-float][asr] 录音已开始 (mime=" + (rec.mimeType || "default") + ", state=" + rec.state + ")");
      showAsrText("聆听中…（点击停止后识别）");
      // 启动真实音量分析（波形用）
      try {
        asrAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = asrAudioCtx.createMediaStreamSource(stream);
        asrAnalyser = asrAudioCtx.createAnalyser();
        asrAnalyser.fftSize = 256;
        source.connect(asrAnalyser);
        const dataArray = new Uint8Array(asrAnalyser.fftSize);
        const tick = () => {
          if (!asrAnalyser) return;
          asrAnalyser.getByteTimeDomainData(dataArray);
          // 从波形数据里分 10 段，取每段的最大振幅
          const levels = [];
          const segSize = Math.floor(dataArray.length / 10);
          for (let i = 0; i < 10; i++) {
            let max = 0;
            for (let j = 0; j < segSize; j++) {
              const v = Math.abs(dataArray[i * segSize + j] - 128) / 128;
              if (v > max) max = v;
            }
            levels.push(max);
          }
          pushBubble("onAsrVolume", { levels: levels });
          asrVolumeRaf = setTimeout(tick, 100); // 每 100ms 更新一次
        };
        tick();
      } catch (e) { console.warn("[llm-float][asr] 音量分析启动失败:", e); }
    }).catch((err) => {
      asrActive = false;
      console.error("[llm-float][asr] 麦克风不可用:", err && err.message ? err.message : String(err));
      showAsrFail("麦克风不可用：" + (err && err.message ? err.message : String(err)));
    });
  }

  function onMediaStopped() {
    const rec = asrMediaRec;
    const doRecognize = asrStopIntent; // 仅用户点停止才识别
    asrMediaRec = null;
    asrActive = false;
    asrStopIntent = false;
    asrMuted = false;
    releaseMic();
    console.log("[llm-float][asr] onMediaStopped: doRecognize=" + doRecognize + ", chunks=" + asrMediaChunks.length);
    if (!doRecognize) return; // 互斥停止：直接结束
    const blob = new Blob(asrMediaChunks, { type: rec ? rec.mimeType || "audio/webm" : "audio/webm" });
    asrMediaChunks = [];
    showAsrText("识别中…");
    pushBubble("onAsrState", { state: "recognizing" });
    reportToBridge("onAsrState", { state: "recognizing" });
    getAsrConfig().then((cfg) => {
      const hostNorm = normalizeHost(cfg.asr_host);
      console.log("[llm-float][asr] 识别配置: host='" + String(cfg.asr_host || "") + "', mode='" + String(cfg.asr_mode || "") + "', model=" + (cfg.asr_model || "qwen3-asr") + ", language=" + (cfg.asr_language || "zh"));
      if (hostNorm && /^https?:\/\//i.test(hostNorm)) {
        httpAsrRecognize(blob, cfg).then((text) => {
          if (!text) { showAsrFail("识别无结果（接口返回空）"); return; }
          // 先在气泡里显示结果，停 2 秒再发到聊天窗
          showAsrFinal(text);
          setTimeout(() => sendResultToChat(text), 2000);
        }).catch((e) => showAsrFail("识别失败：" + (e && e.message ? e.message : String(e))));
      } else {
        console.warn("[llm-float][asr] HOST 未配置或未带 http(s):// 协议，未发起识别");
        showAsrFail("未配置 ASR 服务（设置 → 识别（ASR）分组填 HOST）");
      }
    });
  }


  // webm → WAV 转换（AudioContext 解码 + 重采样为 16kHz 16bit 单声道 WAV）
  function webmToWav(blob) {
    return new Promise((resolve, reject) => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const fr = new FileReader();
      fr.onload = () => {
        ctx.decodeAudioData(fr.result, (ab) => {
          const srcRate = ab.sampleRate;
          const srcData = ab.getChannelData(0);
          const dstRate = 16000;
          const ratio = dstRate / srcRate;
          const dstLen = Math.round(ab.length * ratio);
          const dstData = new Float32Array(dstLen);
          for (let i = 0; i < dstLen; i++) {
            const si = i / ratio; const lo = Math.floor(si); const hi = Math.min(lo + 1, ab.length - 1); const f = si - lo;
            dstData[i] = srcData[lo] * (1 - f) + srcData[hi] * f;
          }
          const pcm = new Int16Array(dstLen);
          for (let i = 0; i < dstLen; i++) { const s = Math.max(-1, Math.min(1, dstData[i])); pcm[i] = s < 0 ? s * 32768 : s * 32767; }
          const dataSize = dstLen * 2;
          const wavBuf = new ArrayBuffer(44 + dataSize);
          const dv = new DataView(wavBuf);
          const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
          ws(0,"RIFF"); dv.setUint32(4, 36+dataSize, true); ws(8,"WAVE"); ws(12,"fmt ");
          dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
          dv.setUint32(24, dstRate, true); dv.setUint32(28, dstRate*2, true);
          dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
          ws(36,"data"); dv.setUint32(40, dataSize, true);
          for (let i = 0; i < dstLen; i++) dv.setInt16(44 + i*2, pcm[i], true);
          ctx.close();
          resolve(new Blob([wavBuf], { type: "audio/wav" }));
        }, (err) => { ctx.close(); reject(new Error("decodeAudioData: " + String(err))); });
      };
      fr.onerror = () => reject(new Error("FileReader error"));
      fr.readAsArrayBuffer(blob);
    });
  }

   // 非流式识别：POST /v1/audio/transcriptions（OpenAI 兼容，multipart）
  // content 做 webm→wav 转换，base64 传 background 发请求（避开 CORS + 避免 ArrayBuffer 损坏）
  function httpAsrRecognize(blob, cfg) {
    return new Promise((resolve, reject) => {
      const h = normalizeHost(cfg.asr_host);
      const params = { model: cfg.asr_model || "qwen3-asr", language: cfg.asr_language || "zh" };
      webmToWav(blob).then((wavBlob) => {
        console.log("[llm-float][asr] HTTP ASR: POST " + h + "/v1/audio/transcriptions", params, "原始:", blob.size, "B", "→ WAV:", wavBlob.size, "B");
        const headers = {};
        if (cfg.asr_api_key) headers["Authorization"] = "Bearer " + cfg.asr_api_key;
        wavBlob.arrayBuffer().then((ab) => {
          const bytes = new Uint8Array(ab);
          let bin = "";
          for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          const b64 = btoa(bin);
          chrome.runtime.sendMessage({
            type: "llm_asr",
            url: h + "/v1/audio/transcriptions",
            headers,
            audioB64: b64,
            model: params.model,
            language: params.language,
          }, (resp) => {
            if (chrome.runtime.lastError) {
              console.error("[llm-float][asr] HTTP ASR 失败(bridge):", chrome.runtime.lastError.message || "?");
              reject(new Error("bridge error: " + (chrome.runtime.lastError.message || "?")));
              return;
            }
            if (!resp || !resp.ok) {
              console.error("[llm-float][asr] HTTP ASR 失败:", (resp && resp.error) || "ASR 请求失败");
              reject(new Error((resp && resp.error) || "ASR 请求失败"));
              return;
            }
            console.log("[llm-float][asr] HTTP ASR 成功，识别结果:", resp.text || "");
            resolve(resp.text || "");
          });
        }).catch((e) => {
          console.error("[llm-float][asr] WAV 读取失败:", e);
          reject(e);
        });
      }).catch((e) => {
        console.error("[llm-float][asr] webm→wav 转换失败:", e.message, "→ 降级发原始 webm");
        // 降级：直接发原始 webm（用 arrayBuffer 传给 background）
        const headers = {};
        if (cfg.asr_api_key) headers["Authorization"] = "Bearer " + cfg.asr_api_key;
        blob.arrayBuffer().then((ab) => {
          const bytes = new Uint8Array(ab);
          let bin = "";
          for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          const b64 = btoa(bin);
          chrome.runtime.sendMessage({
            type: "llm_asr",
            url: h + "/v1/audio/transcriptions",
            headers,
            audioB64: b64,
            model: params.model,
            language: params.language,
          }, (resp) => {
            if (chrome.runtime.lastError) {
              console.error("[llm-float][asr] HTTP ASR 降级失败(bridge):", chrome.runtime.lastError.message || "?");
              reject(new Error("bridge error: " + (chrome.runtime.lastError.message || "?")));
              return;
            }
            if (!resp || !resp.ok) {
              console.error("[llm-float][asr] HTTP ASR 降级失败:", (resp && resp.error) || "ASR 请求失败");
              reject(new Error((resp && resp.error) || "ASR 请求失败"));
              return;
            }
            console.log("[llm-float][asr] HTTP ASR 降级成功，识别结果:", resp.text || "");
            resolve(resp.text || "");
          });
        }).catch((e) => {
          console.error("[llm-float][asr] 原始音频读取失败:", e);
          reject(e);
        });
      });
    });
  }

  // ---------- 流式：浏览器 SpeechRecognition 实时识别 ----------
  function startAsrWebRecognition() {
    asrStopIntent = false;
    asrMuted = false;
    openAsrUi();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showAsrFail("当前浏览器不支持语音识别"); return; }
    let rec;
    try { rec = new SR(); } catch (e) { showAsrFail("无法启动识别：" + (e && e.message ? e.message : String(e))); return; }
    asrWebRec = rec;
    asrWebFinal = "";
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) asrWebFinal += r[0].transcript;
        else interim += r[0].transcript;
      }
      showAsrText(asrWebFinal ? (interim ? asrWebFinal + interim : asrWebFinal) : interim);
    };
    rec.onend = () => {
      asrWebRec = null;
      asrActive = false;
      if (asrMuted) return; // 互斥停止：不识别不发送
      if (asrWebFinal) {
        showAsrFinal(asrWebFinal);
        sendResultToChat(asrWebFinal);
      } else {
        showAsrFail("未检测到语音");
      }
    };
    rec.onerror = (ev) => {
      asrWebRec = null;
      asrActive = false;
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") showAsrFail("麦克风权限被拒绝，请在地址栏允许麦克风后重试");
      else if (ev.error === "no-speech") showAsrFail("未检测到语音");
      else showAsrFail("识别出错：" + ev.error);
    };
    // openAsrUi 内部 stopAsr 会把 asrMuted 置 true，启动前复位，避免自然结束被误判为互斥停止
    asrStopIntent = false;
    asrMuted = false;
    asrActive = true;
    showAsrText("聆听中…（点击停止结束识别）");
    try { rec.start(); } catch (e) { showAsrFail("无法启动识别：" + (e && e.message ? e.message : String(e))); }
  }

  // 停止按钮 / 外部"停止并识别"：触发识别收尾（结果 → 聊天窗）
  function stopAsrAndRecognize() {
    console.log("[llm-float][asr] stopAsrAndRecognize: mediaRec=" + (asrMediaRec ? asrMediaRec.state : "null") + ", webRec=" + (asrWebRec ? "active" : "null"));
    if (asrMediaRec && asrMediaRec.state !== "inactive") {
      asrStopIntent = true;
      asrMuted = false;
      try { asrMediaRec.stop(); } catch (e) { /* 忽略 */ }
      return;
    }
    if (asrWebRec) {
      asrStopIntent = false;
      asrMuted = false;
      try { asrWebRec.stop(); } catch (e) { /* 忽略 */ }
      return;
    }
    // 无活动识别（含 getUserMedia 权限等待中）→ 直接收尾；asrMuted 拦截后续 resolve 的录音启动
    stopAsr();
    closePanel("bubble");
    pushOrbState("idle");
  }

  // 互斥/清理：停止一切且不触发识别（TTS 播报 / 关闭气泡 / 打开聊天窗时调用）
  function stopAsr() {
    if (asrMockTimer) { clearInterval(asrMockTimer); asrMockTimer = null; }
    BUBBLE.classList.remove("asr-active"); // 退出识别：气泡恢复穿透
    asrStopIntent = false;
    asrMuted = true;
    if (asrMediaRec && asrMediaRec.state !== "inactive") {
      try { asrMediaRec.stop(); } catch (e) { /* 忽略 */ }
    }
    asrMediaRec = null;
    asrMediaChunks = [];
    releaseMic();
    if (asrWebRec) { try { asrWebRec.stop(); } catch (e) { /* 忽略 */ } }
    asrWebRec = null;
    asrActive = false;
  }

  // ---------- 外部驱动（SDK / 控制台）的 ASR 演示：打开识别气泡并进入聆听，内容由 setAsrText / endAsr 控制 ----------
  function openAsrMock() {
    stopAsr();
    pushOrbState("asr");
    openPanel("bubble");
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

/* ========== 功能单元注册：命令 + 面板消息 ========== */
registerCommand("startAsr", () => { startAsrRecording(); return { ok: true }; });
registerCommand("setAsrText", (p) => {
  const t = String((p && p.text) || "");
  if (!t) return { ok: true };
  if (uiState.asr.listening !== true) openAsrMock();
  asrMockLast = t;
  pushBubble("onAsrPartial", { text: t });
  reportToBridge("onAsrPartial", { text: t });
  return { ok: true };
});
registerCommand("endAsr", (p) => {
  const t = (typeof p.text === "string" && p.text) ? p.text : asrMockLast;
  if (t) { pushBubble("onAsrFinal", { text: t }); reportToBridge("onAsrFinal", { text: t }); }
  pushBubble("onAsrState", { state: "idle" });
  reportToBridge("onAsrState", { state: "idle" });
  setUi({ asr: { listening: false } });
  asrMockLast = "";
  setTimeout(() => closePanel("bubble"), 1200);
  pushOrbState("idle");
  return { ok: true };
});
registerCommand("stopAsr", () => { stopAsr(); closePanel("bubble"); pushOrbState("idle"); return { ok: true }; });
registerCommand("startAsrDemo", () => { startAsrMock(); return { ok: true }; });

registerPanelMessage("bubble", (kind, data) => {
  if (data.action === "asr_stop") {
    // ASR 气泡停止按钮：停止录音/识别并收尾（结果发到聊天窗）
    console.log("[llm-float][main] asr_stop received");
    stopAsrAndRecognize();
  } else if (data.action === "demo_done") {
    // 气泡结束：聊天窗开着时不改悬浮球状态（保持 chat 态）
    if (CHAT.classList.contains("show")) return;
    pushOrbState("idle");
  }
});
