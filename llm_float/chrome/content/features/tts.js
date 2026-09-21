// LLM Float content script — 功能单元：tts.js（TTS 朗读 + ttsTarget 自动朗读）
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
        let profile = window.llmUtils.matchProfile(location.href, profiles);
        // 没匹配到就用当前激活的 profile
        if (!profile) profile = profiles.find((p) => p.chatName === name) || profiles[profiles.length - 1] || {};
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
        chrome.storage.local.get([
          "tts_mode",
          "tts_hide_time",
          "tts_ws_host", "tts_ws_api_key", "tts_ws_model", "tts_ws_voice", "tts_ws_language", "tts_ws_speed", "tts_ws_instructions",
          "tts_http_host", "tts_http_api_key", "tts_http_model", "tts_http_voice", "tts_http_response_format", "tts_http_sample_rate", "tts_http_language", "tts_http_speed", "tts_http_instructions"
        ], (d) => resolve(d || {}));
      } catch (e) { resolve({}); }
    });
  }

  // 斜杠 ≤ 2 个（只有域名）补路径，否则直接用
  function ttsUrl(host, suffix) {
    const h = String(host || "").trim();
    if (!h) return "";
    const slashCount = (h.match(/\//g) || []).length;
    if (slashCount <= 2) return h.replace(/\/+$/, "") + suffix;
    return h;
  }

  // HOST 必须带协议（如 wss://llm.nucc.com）；不自动补协议，未带协议视为无效由调用方回退
  function buildWsUrl(host, model, apiKey) {
    let h = String(host || "").trim();
    if (!h || !/^[a-z]+:\/\//i.test(h)) return "";
    h = h.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
    h = h.replace(/\/+$/, "");
    const slashCount = (h.match(/\//g) || []).length;
    let url;
    if (slashCount <= 2) {
      url = h + "/v1/audio/speech/stream?model=" + encodeURIComponent(model || "qwen3-tts");
    } else {
      url = h + (h.indexOf("?") >= 0 ? "&" : "?") + "model=" + encodeURIComponent(model || "qwen3-tts");
    }
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
        if (wsTtsAudioCtx.state === "suspended") {
          console.warn("[llm-float][tts] AudioContext 被浏览器暂停（自动播放策略），尝试恢复...");
          try { wsTtsAudioCtx.resume(); } catch (e) { /* 忽略 */ }
          console.warn("[llm-float][tts] 提示：如果听不到声音，请点击一下页面或悬浮球解锁声音播放");
        }
        src.start();
      } catch (e) { console.error("[llm-float][tts] PCM 播放出错:", e); resolve(); }
    });
  }

  // HTTP 非流式 TTS（/v1/audio/speech，OpenAI 风格 POST）：网络在 background 执行（可带 Authorization 头，避开 Mixed Content）
  function httpTtsSpeak(text, cfg) {
    return new Promise((resolve) => {
      const h = String(cfg.tts_http_host || "").trim();
      if (!h || !/^https?:\/\//i.test(h)) {
        console.warn("[llm-float][tts] HTTP TTS: HOST 未配置或未带 http(s):// 协议，回退浏览器合成 (当前值: '" + h + "')");
        resolve(false); return;
      }
      const httpSlashCount = (h.match(/\//g) || []).length;
      const ttsEndpoint = httpSlashCount <= 2 ? h.replace(/\/+$/, "") + "/v1/audio/speech" : h;
      const headers = { "Content-Type": "application/json" };
      if (cfg.tts_http_api_key) headers["Authorization"] = "Bearer " + cfg.tts_http_api_key;
      const body = {
        model: cfg.tts_http_model || "qwen3-tts",
        voice: cfg.tts_http_voice || "vivian",
        input: String(text),
        response_format: cfg.tts_http_response_format || "pcm",
        speed: Number(cfg.tts_http_speed) || 1.0,
      };
      if (cfg.tts_http_language) body.language = cfg.tts_http_language;
      if (cfg.tts_http_instructions) body.instructions = cfg.tts_http_instructions;
      const ttsStart = Date.now();
      console.log("[llm-float][tts] HTTP TTS 发起: POST " + ttsEndpoint, body);
      let settled = false;
      const timeout = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 35000);
      try {
        chrome.runtime.sendMessage({ type: "llm_tts_http", url: ttsEndpoint, headers, body }, (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            console.error("[llm-float][tts] HTTP TTS 失败(background):", (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "?");
            resolve(false);
            return;
          }
          const fmt = String(cfg.tts_response_format || "pcm").toLowerCase();
          if (!resp.dataB64) { console.error("[llm-float][tts] dataB64 为空"); resolve(false); return; }
          // base64 → ArrayBuffer
          const bin = atob(resp.dataB64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          const audioBuf = arr.buffer;
          console.log("[llm-float][tts] HTTP TTS 成功, 耗时:", ((Date.now()-ttsStart)/1000).toFixed(2)+"s, format=" + fmt + ", size=" + audioBuf.byteLength + "B (" + (audioBuf.byteLength / 1024).toFixed(1) + " KB)");
          const play = fmt === "pcm" ? playPcm([audioBuf], Number(cfg.tts_http_sample_rate) || 24000) : playEncoded(audioBuf);
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
      const url = buildWsUrl(cfg.tts_ws_host, cfg.tts_ws_model, cfg.tts_ws_api_key);
      if (!url) {
        console.warn("[llm-float][tts] WS TTS: HOST 未配置或未带 ws(s):// 协议，回退浏览器合成 (当前值: '" + String(cfg.tts_ws_host || "").trim() + "')");
        resolve(false); return;
      }
      console.log("[llm-float][tts] WS TTS 发起(background): " + url);
      const config = {
        type: "session.config",
        model: cfg.tts_ws_model || "qwen3-tts",
        voice: cfg.tts_ws_voice || "vivian",
        response_format: "pcm",
        sample_rate: 24000,
        language: cfg.tts_ws_language || "zh",
        speed: Number(cfg.tts_ws_speed) || 1.0,
        instructions: cfg.tts_ws_instructions || "",
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
        setTimeout(() => closePanel("bubble"), 1200);
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

  function speakText(text, background) {
    console.log("[llm-float][tts] speakText 进入: '" + text + "'" + (background ? " (后台)" : ""));
    try {
      callCommand("stopAsr", {});
      const sentences = String(text).split(/[。！？!?；;]/).map(s => s.trim()).filter(Boolean);
      if (!sentences.length) return;
      getTtsConfig().then((cfg) => {
        const mode = cfg.tts_mode || "stream";
        if (mode === "off") {
          console.warn("[llm-float][tts] speakText 已跳过：TTS 开关为 off");
          return;
        }
        if (!background) {
          openPanel("bubble");
          pushBubble("setMode", { mode: "subtitle" });
          pushBubble("setTheme", { theme: currentTheme });
        }
        ttsCanceled = false;
        const fullText = String(text).trim();
        setUi({ bubble: { mode: "subtitle" }, tts: { speaking: true, current: fullText } });
        reportToBridge("onTtsSentence", { text: fullText, index: 1, total: 1 });
        if (!background) pushBubble("onTtsSentence", { text: fullText });
        const runner = mode === "http" ? httpTtsSpeak : wsTtsSpeak;
        runner(text, cfg).then((ok) => {
          if (ttsCanceled) return;
          if (ok) {
            setUi({ tts: { speaking: false, current: "" } });
            reportToBridge("onTtsIdle", {});
            if (!background) {
              const hideTime = Number(cfg.tts_hide_time) || 1;
              setTimeout(() => closePanel("bubble"), hideTime * 1000);
            }
          } else {
            legacySpeakSentences(sentences);
          }
        });
      });
    } catch (e) { console.error("[llm-float][tts] speakText 出错:", e); }
  }

/* ========== 功能单元注册：命令 ========== */
registerCommand("speakText", (p) => { speakText((p && p.text) || "", (p && p.background) || false); return { ok: true }; });
registerCommand("stopSpeak", () => { stopContentTts(); closePanel("bubble"); return { ok: true }; });
registerCommand("startTtsTarget", () => { startTtsTarget(); return { ok: true }; });
