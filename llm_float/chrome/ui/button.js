const orb = document.getElementById("orb");

let dragging = false;
let downX = 0;
let downY = 0;

const DRAG_THRESHOLD = 4;

// Chrome 扩展桥：background/options 推送（content script 中转 postMessage）
window.addEventListener("message", (e) => {
  const data = e.data || {};
  if (data.kind !== "assistant" || !data.name) return;
  const fn = window.assistant[data.name];
  if (typeof fn === "function") fn(data.payload || {});
});

window.assistant = window.assistant || {};
window.assistant.setTheme = function (payload) {
  const theme = payload && payload.theme ? payload.theme : "dark";
  document.body.dataset.theme = theme;
};

// 兜底：iframe 加载后直接读 storage（postMessage 可能早于本脚本注册）
(function initFromStorage() {
  try {
    chrome.storage.local.get(["theme", "orb_size"], (d) => {
      if (d.theme) window.assistant.setTheme({ theme: d.theme });
      if (d.orb_size) window.assistant.setOrbSize({ size: d.orb_size });
    });
  } catch (e) { /* 非扩展环境忽略 */ }
})();

/* 悬浮球大小（px）：驱动图标与提示按比例缩放 */
window.assistant.setOrbSize = function (payload) {
  const size = payload && payload.size ? Number(payload.size) : 68;
  // 无二值蒙版：可见圆即 CSS 圆（--orb-size 直接等于设置值），由 GPU 抗锯齿合成
  const visual = Math.max(20, size);
  document.documentElement.style.setProperty("--orb-size", visual + "px");
};
window.assistant.setOrbGradient = function (payload) {
  const start = payload && payload.start ? payload.start : "#6366f1";
  const mid = payload && payload.mid ? payload.mid : "#8b5cf6";
  const end = payload && payload.end ? payload.end : "#ec4899";
  orb.style.background = `linear-gradient(135deg, ${start} 0%, ${mid} 50%, ${end} 100%)`;
};
/* New: switch the orb's visual state to match the active panel.
 * state: "idle" | "chat" | "settings" | "tts" | "asr" */
window.assistant.setOrbState = function (payload) {
  const state = payload && payload.state;
  if (["idle", "chat", "settings", "tts", "asr"].includes(state)) {
    orb.dataset.state = state;
  }
};

/* ---------- drag vs click ---------- */
function onMouseMove(e) {
  if (dragging) return;
  if (Math.abs(e.screenX - downX) > DRAG_THRESHOLD ||
      Math.abs(e.screenY - downY) > DRAG_THRESHOLD) {
    dragging = true;
    orb.classList.add("dragging");
    window.parent.postMessage({ kind: "orb", action: "drag_start" }, "*");
    window.removeEventListener("mousemove", onMouseMove);
  }
}

function onMouseUp() {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", onMouseUp);
  orb.classList.remove("dragging");
}

orb.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  dragging = false;
  downX = e.screenX;
  downY = e.screenY;
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
});

orb.addEventListener("click", (e) => {
  if (dragging) {
    dragging = false;
    return;
  }
  window.parent.postMessage({ kind: "orb", action: "open_chat" }, "*");
});

orb.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (dragging) return;
  window.parent.postMessage({ kind: "orb", action: "open_settings" }, "*");
});
