// 工具栏 popup 菜单：开关本插件 / TTS demo / ASR demo
const toggleBtn = document.getElementById("btn-toggle");
const stateEl = document.getElementById("state");
const dotToggle = document.getElementById("dot-toggle");
const labelToggle = document.getElementById("label-toggle");

function send(type, payload) {
  // fire-and-forget：不期望响应，避免 popup 关闭引发 "port closed" 报错
  try { chrome.runtime.sendMessage({ type, ...(payload || {}) }); } catch (e) { /* 忽略 */ }
  window.close();
}

chrome.storage.local.get("orb_enabled", (d) => {
  const enabled = d.orb_enabled !== false; // 默认开启
  stateEl.textContent = "状态：" + (enabled ? "已开启（页面显示悬浮球）" : "已关闭（页面隐藏悬浮球）");
  stateEl.style.color = enabled ? "#4ade80" : "#f87171";
  dotToggle.style.background = enabled ? "#4ade80" : "#f87171";
  labelToggle.textContent = enabled ? "关闭本插件" : "开启本插件";
});

toggleBtn.addEventListener("click", () => send("llm_toggle_enabled"));
document.getElementById("btn-tts").addEventListener("click", () => send("llm_demo", { demo: "tts" }));
document.getElementById("btn-asr").addEventListener("click", () => send("llm_demo", { demo: "asr" }));
