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
  const theme = payload && payload.theme === "light" ? "light" : "dark";
  window.assistant.setOrbGradient(theme === "light"
    ? { start: "#3b82f6", mid: "#6366f1", end: "#1d4ed8" }
    : { start: "#6366f1", mid: "#8b5cf6", end: "#ec4899" });
};
window.assistant.setOrbGradient = function (payload) {
  const start = payload && payload.start ? payload.start : "#6366f1";
  const mid = payload && payload.mid ? payload.mid : "#8b5cf6";
  const end = payload && payload.end ? payload.end : "#ec4899";
  orb.style.background = `linear-gradient(135deg, ${start} 0%, ${mid} 50%, ${end} 100%)`;
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

function sector(e) {
  const rect = orb.getBoundingClientRect();
  const dx = e.clientX - (rect.left + rect.width / 2);
  const dy = e.clientY - (rect.top + rect.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? "left" : "right";
  }
  return dy < 0 ? "up" : "down";
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
  const direction = sector(e);
  if (api && api.orb_action) {
    api.orb_action(direction);
    return;
  }
  if (api && api.open_chat) api.open_chat();
});

orb.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (dragging) return;
  if (api && api.show_menu) api.show_menu();
});
