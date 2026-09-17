const orb = document.getElementById("orb");

let api = null;
let dragging = false;
let downX = 0;
let downY = 0;

const DRAG_THRESHOLD = 4;

window.qtReady.then((bridge) => {
  api = bridge;
});

window.assistant = window.assistant || {};
window.assistant.setTheme = function (payload) {
  const theme = payload && payload.theme ? payload.theme : "dark";
  document.body.dataset.theme = theme;
};
/* 悬浮球大小（px）：驱动图标与提示按比例缩放 */
window.assistant.setOrbSize = function (payload) {
  const size = payload && payload.size ? Number(payload.size) : 68;
  // 视觉圆比窗口遮罩小 3px：QRegion 椭圆遮罩的像素锯齿落在透明环内，
  // 可见边缘由浏览器抗锯齿渲染，消除悬浮球边缘毛刺
  const visual = Math.max(20, size - 3);
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
    if (api && api.start_drag) api.start_drag();
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
  if (api && api.open_chat) api.open_chat();
});

orb.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (dragging) return;
  if (api && api.open_settings) api.open_settings();
});
