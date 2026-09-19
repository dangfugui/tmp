// LLM Float content script — 入口 main.js（消息路由 + 注入守卫，最后加载）
function initMain() {
  // ---------- iframe → content script（postMessage） ----------
  window.addEventListener("message", (e) => {
    const data = e.data || {};
    if (!data.kind) return;
    if (data.kind === "orb") { handleOrbAction(data); return; } // 悬浮球交互（内核）
    if (data.kind === "llm-ctrl") {
      // 页面控制台 / 页面脚本通道（命令名 = 命令表名 = SDK 命令名）
      const r = callCommand(data.cmd, data.params || {});
      window.postMessage({ kind: "llm-ctrl-reply", id: data.id, data: r }, "*");
      return;
    }
    dispatchPanelMessage(data.kind, data); // 面板页面消息（feature 注册的处理器）
  });

  // ---------- background → content script ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "llm_bridge") {
      // Python 桥命令（background 转发）：支持同步和异步命令
      const result = callCommand(msg.cmd, msg.params || {});
      if (result && typeof result.then === "function") {
        // 异步命令（比如 page_wait），等 Promise resolve 后再响应
        result.then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
        return true; // 表示会异步 sendResponse
      }
      sendResponse(result);
    } else if (msg.type === "llm_set_orb_enabled") {
      setEnabled(msg.enabled !== false);
    } else if (msg.type === "llm_active_profile") {
      pushChat("setActiveChatProfile", { profile: { chatName: msg.name || "" } });
      callCommand("startTtsTarget", {});
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
          callCommand("startTtsTarget", {});
        });
      } catch (e) { /* 忽略 */ }
    } else if (msg.type === "llm_demo") {
      // 工具栏 popup / 设置页 TTS / ASR demo：先停旧 TTS/ASR，再显示字幕气泡执行（互斥：开气泡自动关聊天窗）
      callCommand("runDemo", { demo: msg.demo });
    } else if (msg.type === "open_chat") {
      // 工具栏 popup：打开聊天窗口
      callCommand("showChat", {});
      pushOrbState("chat");
    }
  });
}

// 注入守卫：全部模块就绪后只执行一次（防重复注入产生双份 iframe / 重复监听）
if (!window.__llmFloatInjected) {
  initCore();
  initMain();
  window.__llmFloatInjected = true;
}
