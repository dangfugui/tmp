const orb = document.getElementById("orb");

let moved = false;
let captured = false;
let downX = 0;
let downY = 0;
let downButton = 0; // 0=左键, 2=右键, 1=滚轮

const DRAG_THRESHOLD = 4;

// 动作配置（从设置读取）
let orbActions = {
  left: 'open_chat',
  right: 'open_asr',
  wheel: 'none',
};

// 兜底：iframe 加载后直接读 storage（postMessage 可能早于本脚本注册；主题由 common.js 兜底）
(function initFromStorage() {
  try {
    chrome.storage.local.get(["orb_size", "orb_opacity", "orb_action_left", "orb_action_right", "orb_action_wheel"], (d) => {
      if (d.orb_size) window.assistant.setOrbSize({ size: d.orb_size });
      if (d.orb_opacity !== undefined) window.assistant.setOpacity({ opacity: d.orb_opacity });
      if (d.orb_action_left) orbActions.left = d.orb_action_left;
      if (d.orb_action_right) orbActions.right = d.orb_action_right;
      if (d.orb_action_wheel) orbActions.wheel = d.orb_action_wheel;
    });
  } catch (e) { /* 非扩展环境忽略 */ }
})();

/* 悬浮球大小（px）：驱动图标与提示按比例缩放 */
window.assistant.setOrbSize = function (payload) {
  const size = payload && payload.size ? Number(payload.size) : 68;
  const visual = Math.max(20, size);
  document.documentElement.style.setProperty("--orb-size", visual + "px");
};
window.assistant.setOrbGradient = function (payload) {
  const start = payload && payload.start ? payload.start : "#6366f1";
  const mid = payload && payload.mid ? payload.mid : "#8b5cf6";
  const end = payload && payload.end ? payload.end : "#ec4899";
  orb.style.background = `linear-gradient(135deg, ${start} 0%, ${mid} 50%, ${end} 100%)`;
};
window.assistant.setOpacity = function (payload) {
  const op = Math.max(0.2, Math.min(1.0, Number(payload && payload.opacity !== undefined ? payload.opacity : 1)));
  orb.style.opacity = String(op);
};

window.assistant.setOrbState = function (payload) {
  const state = payload && payload.state;
  if (["idle", "chat", "settings", "tts", "asr"].includes(state)) {
    orb.dataset.state = state;
  }
};

/* 更新动作配置 */
window.assistant.setOrbActions = function (payload) {
  if (payload) {
    if (payload.left) orbActions.left = payload.left;
    if (payload.right) orbActions.right = payload.right;
    if (payload.wheel) orbActions.wheel = payload.wheel;
  }
};

/* 根据按钮获取动作 */
function getAction(button) {
  if (button === 0) return orbActions.left;
  if (button === 2) return orbActions.right;
  if (button === 1) return orbActions.wheel;
  return 'none';
}

/* ---------- Pointer Capture 拖动：按住移动=拖动，松开=触发动作 ---------- */
orb.addEventListener("pointerdown", (e) => {
  // 中键（button=1）直接触发动作，不进入拖动逻辑
  if (e.button === 1) {
    e.preventDefault();
    const action = getAction(1);
    if (action !== 'none') {
      window.parent.postMessage({ kind: "orb", action: action }, "*");
    }
    return;
  }
  downButton = e.button;
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

function endPointer(e) {
  if (!captured) return;
  captured = false;
  orb.classList.remove("dragging");
  try {
    if (moved) {
      // 拖动结束：落定位置 + 触发对应动作
      window.parent.postMessage({ kind: "orb", action: "drag_end" }, "*");
      const action = getAction(downButton);
      if (action !== 'none') {
        window.parent.postMessage({ kind: "orb", action: action }, "*");
      }
    } else {
      // 单击（无位移）：触发对应动作
      const action = getAction(downButton);
      if (action !== 'none') {
        window.parent.postMessage({ kind: "orb", action: action }, "*");
      }
    }
  } catch (err) { /* 忽略 */ }
}
orb.addEventListener("pointerup", endPointer);
orb.addEventListener("pointercancel", endPointer);

orb.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  // 右键的动作由 pointerdown/pointerup 处理
});

/* 滚轮事件 */
orb.addEventListener("wheel", (e) => {
  e.preventDefault();
  const action = getAction(1); // button=1 是滚轮
  if (action !== 'none') {
    window.parent.postMessage({ kind: "orb", action: action }, "*");
  }
}, { passive: false });
