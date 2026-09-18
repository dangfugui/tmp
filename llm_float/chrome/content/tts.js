// LLM Float content script — 模块：tts.js（TTS 朗读 + ttsTarget 自动朗读）
// 播报优先走设置页配置的 WS 流式 TTS 接口（qwen3-tts /v1/audio/speech/stream），
// 未配置 HOST / 接口失败时回退浏览器 speechSynthesis。
  function stopContentTts() {
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
    // 网络请求在 background 执行：通知断开 WS（fetch 无法中止，结果到达后会被 ttsCanceled 忽略）
    try { chrome.runtime.sendMessage({ type: "llm_tts_ws_stop" }); } catch (e) { /* 忽略 */ }
    ttsCanceled = true;
  }

  // ---------- TTS 定位（ttsTarget）：每 1s 轮询定位元素文本，有变化才播报 ----------
  var ttsTimer = null;
  var ttsTargetId = "";
  var ttsLastText = "";

  // TTS 定位元素：先按 id 找（兼容旧配置），找不到再按 CSS 选择器找（支持 class / 属性 / 任意选择器）
  function findTtsEl(target) {
    const byId = document.getElementById(target);
    if (byId) return byId;
    try { return document.querySelector(target); } catch (e) { return null; }
  }

  function startTtsTarget() {
    try {
      chrome.storage.local.get(["chat_profiles", "active_profile_name"], (d) => {
        const profiles = d.chat_profiles || [];
        const name = d.active_profile_name || "";
        const profile = profiles.find((p) => p.chatName === name) || profiles[0] || {};
        const target = (profile.ttsTarget || "").trim();
        if (ttsTargetId === target && ttsTimer) return; // 无变化
        stopTtsTarget();
        ttsTargetId = target;
        if (!target) return;
        console.log("[llm-float][ttsTarget] 启动轮询: '" + target + "' (配置: " + name + ")");
        // 每 1s 轮询定位元素文本：与上次一致不触发；追加场景播增量、整体重写场景播全文
        ttsTimer = setInterval(() => {
          const el = findTtsEl(target);
          if (!el) return;
          const text = (el.textContent || "").trim();
          if (text === ttsLastText) return; // 与上次一致，不触发
          let toSpeak = text;
          if (text.startsWith(ttsLastText) && text.length > ttsLastText.length) {
            toSpeak = text.slice(ttsLastText.length).trim();
            if (!toSpeak) { ttsLastText = text; return; }
          }
          ttsLastText = text;
          console.log("[llm-float][ttsTarget] 文本变化, 播报: '" + toSpeak + "'");
          speakText(toSpeak);
        }, 1000);
      });
    } catch (e) { /* 忽略 */ }
  }

  function stopTtsTarget() {
    if (ttsTimer) { clearInterval(ttsTimer); ttsTimer = null; }
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
    ttsTargetId = "";
    ttsLastText = "";
  }

  // ---------- WS 流式 TTS（qwen3-tts /v1/audio/speech/stream）----------
  var wsTtsAudioCtx = null;
  var ttsCanceled = false; // 被 stopContentTts 中断标记（避免中断后回退重播）

  function getTtsConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["tts_mode", "tts_host", "tts_api_key", "tts_model", "tts_voice", "tts_response_format", "tts_sample_rate", "tts_language", "tts_speed", "tts_instructions"], (d) => resolve(d || {}));
      } catch (e) { resolve({}); }
    });
  }

  // HOST 容错：允许误填完整接口路径（如 .../v1/audio/speech/stream），剥到根地址再拼接
  function normalizeHost(h) {
    return String(h || "").trim().replace(/\/+$/, "").replace(/\/(v1\/audio\/(speech\/stream|speech|transcriptions))$/i, "");
  }

  // HOST 必须带协议（如 wss://llm.nucc.com）；不自动补协议，未带协议视为无效由调用方回退
  function buildWsUrl(host, model, apiKey) {
    let h = normalizeHost(host);
    if (!h || !/^[a-z]+:\/\//i.test(h)) return "";
    h = h.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
    let url = h + "/v1/audio/speech/stream?model=" + encodeURIComponent(model || "qwen3-tts");
    // 浏览器 WebSocket 无法携带自定义请求头（Authorization），API Key 拼入 query 尝试鉴权
    if (apiKey) url += "&api_key=" + encodeURIComponent(apiKey);
    return url;
  }

  // PCM 原始数据（16bit 单声道小端）→ AudioBuffer → 播放
  function playPcm(chunks, sampleRate) {
    return new Promise((resolve) => {
      try {
        const total = chunks.reduce((n, c) => n + (c ? c.byteLength : 0), 0);
        if (!total) { resolve(); return; }
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { buf.set(new Uint8Array(c), off); off += c.byteLength; }
        const frames = Math.floor(total / 2);
        if (!wsTtsAudioCtx) wsTtsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuf = wsTtsAudioCtx.createBuffer(1, frames, sampleRate || 24000);
        const ch = audioBuf.getChannelData(0);
        for (let i = 0; i < frames; i++) {
          const v = (buf[i * 2] | (buf[i * 2 + 1] << 8));
          ch[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768;
        }
        const src = wsTtsAudioCtx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(wsTtsAudioCtx.destination);
        const finish = () => { try { src.disconnect(); } catch (e) { /* 忽略 */ } resolve(); };
        src.onended = finish;
        // autoplay 策略：无用户手势时可能挂起，尝试恢复（失败则仅字幕、无声）
        if (wsTtsAudioCtx.state === "suspended") { try { wsTtsAudioCtx.resume(); } catch (e) { /* 忽略 */ } }
        src.start();
      } catch (e) { console.error("[llm-float][tts] PCM 播放出错:", e); resolve(); }
    });
  }

  // HTTP 非流式 TTS（/v1/audio/speech，OpenAI 风格 POST）：网络在 background 执行（可带 Authorization 头，避开 Mixed Content）
  function httpTtsSpeak(text, cfg) {
    return new Promise((resolve) => {
      const h = normalizeHost(cfg.tts_host);
      if (!h || !/^https?:\/\//i.test(h)) {
        console.warn("[llm-float][tts] HTTP TTS: HOST 未配置或未带 http(s):// 协议，回退浏览器合成 (当前值: '" + String(cfg.tts_host || "").trim() + "')");
        resolve(false); return;
      }
      const headers = { "Content-Type": "application/json" };
      if (cfg.tts_api_key) headers["Authorization"] = "Bearer " + cfg.tts_api_key;
      const body = {
        model: cfg.tts_model || "qwen3-tts",
        voice: cfg.tts_voice || "vivian",
        input: String(text),
        response_format: cfg.tts_response_format || "pcm",
        speed: Number(cfg.tts_speed) || 1.0,
      };
      if (cfg.tts_language) body.language = cfg.tts_language;
      if (cfg.tts_instructions) body.instructions = cfg.tts_instructions;
      console.log("[llm-float][tts] HTTP TTS 发起(background): POST " + h + "/v1/audio/speech");
      let settled = false;
      const timeout = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 35000);
      try {
        chrome.runtime.sendMessage({ type: "llm_tts_http", url: h + "/v1/audio/speech", headers, body }, (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            console.error("[llm-float][tts] HTTP TTS 失败(background):", (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "?");
            resolve(false);
            return;
          }
          const fmt = String(cfg.tts_response_format || "pcm").toLowerCase();
          const play = fmt === "pcm" ? playPcm([resp.data], Number(cfg.tts_sample_rate) || 24000) : playEncoded(resp.data);
          play.then(() => resolve(true));
        });
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timeout); resolve(false); }
      }
    });
  }

  // 编码音频（mp3/opus/wav）→ decodeAudioData → 播放
  function playEncoded(buf) {
    return new Promise((resolve) => {
      try {
        if (!wsTtsAudioCtx) wsTtsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const data = buf.slice(0); // decodeAudioData 会 detach 传入的 buffer
        wsTtsAudioCtx.decodeAudioData(data).then((audioBuf) => {
          const src = wsTtsAudioCtx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(wsTtsAudioCtx.destination);
          const finish = () => { try { src.disconnect(); } catch (e) { /* 忽略 */ } resolve(); };
          src.onended = finish;
          if (wsTtsAudioCtx.state === "suspended") { try { wsTtsAudioCtx.resume(); } catch (e) { /* 忽略 */ } }
          src.start();
        }).catch(() => resolve());
      } catch (e) { console.error("[llm-float][tts] 音频解码播放失败:", e); resolve(); }
    });
  }

  // 走配置的 WS 流式 TTS（/v1/audio/speech/stream）：网络在 background 执行（避开页面 Mixed Content）
  // true=已处理，false=失败可回退
  function wsTtsSpeak(text, cfg) {
    return new Promise((resolve) => {
      const url = buildWsUrl(cfg.tts_host, cfg.tts_model, cfg.tts_api_key);
      if (!url) {
        console.warn("[llm-float][tts] WS TTS: HOST 未配置或未带 ws(s):// 协议，回退浏览器合成 (当前值: '" + String(cfg.tts_host || "").trim() + "')");
        resolve(false); return;
      }
      console.log("[llm-float][tts] WS TTS 发起(background): " + url);
      const config = {
        type: "session.config",
        model: cfg.tts_model || "qwen3-tts",
        voice: cfg.tts_voice || "vivian",
        response_format: cfg.tts_response_format || "pcm",
        sample_rate: Number(cfg.tts_sample_rate) || 24000,
        language: cfg.tts_language || "zh",
        speed: Number(cfg.tts_speed) || 1.0,
        instructions: cfg.tts_instructions || "",
      };
      let settled = false;
      const timeout = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 35000);
      try {
        chrome.runtime.sendMessage({ type: "llm_tts_ws", url, config, text }, (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            console.error("[llm-float][tts] WS TTS 失败(background):", (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "?");
            resolve(false);
            return;
          }
          playPcm([resp.pcm], Number(cfg.tts_sample_rate) || 24000).then(() => resolve(true));
        });
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timeout); resolve(false); }
      }
    });
  }

  // 回退：浏览器 speechSynthesis 逐句朗读 + 字幕推进
  function legacySpeakSentences(sentences) {
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
      try { speechSynthesis.speak(u); } catch (e) { say(i + 1); }
    };
    say(0);
  }

  function speakText(text) {
    console.log("[llm-float][tts] speakText 进入: '" + text + "'");
    try {
      stopAsr(); // 互斥：朗读时停止正在进行的识别
      const sentences = String(text).split(/[。！？!?；;]/).map(s => s.trim()).filter(Boolean);
      if (!sentences.length) return;
      getTtsConfig().then((cfg) => {
        const mode = cfg.tts_mode || "stream";
        if (mode === "off") {
          console.warn("[llm-float][tts] speakText 已跳过：TTS 开关为 off（设置 → 字幕（TTS）标题栏三态）");
          return; // 播报已关闭（标题栏三态：关）
        }
        showBubble();
        pushBubble("setMode", { mode: "subtitle" }); // 激活字幕区（否则气泡只显示空窗口）
        pushBubble("setTheme", { theme: currentTheme });
        ttsCanceled = false;
        const fullText = String(text).trim();
        // 字幕先显示（TTS 接口为整段合成，字幕同步显示整段）
        setUi({ bubble: { mode: "subtitle" }, tts: { speaking: true, current: fullText } });
        reportToBridge("onTtsSentence", { text: fullText, index: 1, total: 1 });
        pushBubble("onTtsSentence", { text: fullText });
        const runner = mode === "http" ? httpTtsSpeak : wsTtsSpeak; // 按设置选择接口
        runner(text, cfg).then((ok) => {
          if (ttsCanceled) return;
          if (ok) {
            setUi({ tts: { speaking: false, current: "" } });
            reportToBridge("onTtsIdle", {});
            setTimeout(() => hideBubble(), 1200);
          } else {
            legacySpeakSentences(sentences); // 未配置 HOST / 接口失败 → 回退
          }
        });
      });
    } catch (e) { console.error("[llm-float][tts] speakText 出错:", e); }
  }
