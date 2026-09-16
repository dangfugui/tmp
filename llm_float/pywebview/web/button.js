const orb = document.getElementById("orb");

let apiReady = false;
let dragging = false;
let downX = 0;
let downY = 0;

const DRAG_THRESHOLD = 4;

window.addEventListener("pywebviewready", () => {
  apiReady = true;
});

/* ---------- drag vs click ---------- */
function onMouseMove(e) {
  if (Math.abs(e.screenX - downX) > DRAG_THRESHOLD ||
      Math.abs(e.screenY - downY) > DRAG_THRESHOLD) {
    dragging = true;
    orb.classList.add("dragging");
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

/* Click sector of the orb decides the action (temporary test hook).
 * up = chat, down = settings, left = subtitle, right = ASR.
 * Later these will be driven by real wake-word / TTS / ASR events. */
function sector(e) {
  const r = orb.getBoundingClientRect();
  const dx = (e.clientX - r.left) - r.width / 2;
  const dy = (e.clientY - r.top) - r.height / 2;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

orb.addEventListener("click", (e) => {
  if (dragging) return;
  if (apiReady && window.pywebview?.api?.orb_action) {
    window.pywebview.api.orb_action(sector(e));
  }
});

orb.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (dragging) return;
  if (apiReady && window.pywebview?.api?.open_settings) {
    window.pywebview.api.open_settings();
  }
});

/* Called by Python while a panel is attached to the orb. */
window.assistant = {
  setActive(payload) {
    orb.classList.toggle("active", !!(payload && payload.active));
  },
  /* New: switch the orb's visual state to match the active panel.
   * state: "idle" | "chat" | "settings" | "tts" | "asr" */
  setOrbState(payload) {
    const state = payload && payload.state;
    if (["idle", "chat", "settings", "tts", "asr"].includes(state)) {
      orb.dataset.state = state;
    }
  },
  setTheme(payload) {
    const theme = payload.theme;
    document.body.dataset.theme = theme;
    // Apply orb gradient based on theme
    const gradientMap = {
      dark: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 45%, #ec4899 100%)",
      blue: "linear-gradient(135deg, #49bccf 0%, #63b3e8 45%, #22d3ee 100%)",
      light: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 45%, #6366f1 100%)",
    };
    orb.style.background = gradientMap[theme] || gradientMap.dark;
  },
  setOrbGradient(payload) {
    const { start, mid, end } = payload;
    orb.style.background = `linear-gradient(135deg, ${start} 0%, ${mid} 45%, ${end} 100%)`;
  },
  setOpacity(payload) {
    const opacity = Math.max(0.2, Math.min(1.0, payload.opacity));
    orb.style.opacity = String(opacity);
  },
};
