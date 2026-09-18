// ui/common.js —— 面板页面公共逻辑：assistant 消息分发 + 默认主题应用 + 兜底读取
// 所有面板页面（button / chat / bubble）在各自 js 之前引入本文件。
(function () {
  // 1) content → 页面：assistant 命令分发（name → window.assistant[name]）
  window.addEventListener("message", (e) => {
    const data = e.data || {};
    if (data.kind !== "assistant" || !data.name) return;
    const fn = window.assistant && window.assistant[data.name];
    if (typeof fn === "function") {
      try { fn(data.payload || {}); } catch (err) { console.error("[llm-float] assistant." + data.name, err); }
    }
  });

  // 2) 默认 setTheme（页面如已定义则保留自己的实现，如 chat.js 的 applyChatTheme）
  window.assistant = window.assistant || {};
  if (!window.assistant.setTheme) {
    window.assistant.setTheme = (payload) => {
      document.body.dataset.theme = (payload && payload.theme) || "dark";
    };
  }

  // 3) 兜底：iframe 加载后直接读 storage 主题（非扩展环境忽略）
  try {
    chrome.storage.local.get(["theme"], (d) => {
      if (d.theme) document.body.dataset.theme = d.theme;
    });
  } catch (e) { /* 非扩展环境忽略 */ }
})();
