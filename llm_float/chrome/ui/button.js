const orb = document.getElementById("orb");

let moved = false;
let captured = false;
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

/* ---------- Pointer Capture 拖动：按住移动=拖动，单击=开聊天 ----------
   指针在 iframe 内被捕获（setPointerCapture），鼠标移到屏幕任意位置
   事件都不中断，彻底规避跨 iframe 边界丢事件/遮罩竞态问题。 */
orb.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // 仅左键
  downX = e.screenX;
  downY = e.screenY;
  moved = false;
  captured = true;
  try { orb.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  e.preventDefault();
});

orb.addEventListener("pointermove", (e) => {
  if (!captured) return;
  const dx = e.screenX - downX;
  const dy = e.screenY - downY;
  if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) moved = true;
  if (moved) {
    orb.classList.add("dragging");
    try {
      window.parent.postMessage({ kind: "orb", action: "drag_move", x: e.screenX, y: e.screenY }, "*");
    } catch (err) { /* 忽略 */ }
  }
});

function endPointer() {
  if (!captured) return;
  captured = false;
  orb.classList.remove("dragging");
  try {
    if (moved) {
      // 拖动结束：通知 content 落定位置
      window.parent.postMessage({ kind: "orb", action: "drag_end" }, "*");
    } else {
      // 单击（无位移）：打开聊天窗口
      window.parent.postMessage({ kind: "orb", action: "open_chat" }, "*");
    }
  } catch (err) { /* 忽略 */ }
}
orb.addEventListener("pointerup", endPointer);
orb.addEventListener("pointercancel", endPointer);

orb.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (captured) return;
  // 右键：开始语音识别（ASR）
  window.parent.postMessage({ kind: "orb", action: "open_asr" }, "*");
});
