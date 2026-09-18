// LLM Float content script — 模块：main.js（事件入口：postMessage + background 消息，最后加载）
  function initMain() {
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
  }

  // 注入守卫：全部模块就绪后只执行一次（防重复注入产生双份 iframe / 重复监听）
  if (!window.__llmFloatInjected) {
    initUi();
    initMain();
    window.__llmFloatInjected = true;
  }
