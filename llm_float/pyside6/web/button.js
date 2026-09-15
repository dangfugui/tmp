const orb = document.getElementById("orb");

let api = null;
let dragging = false;
let downX = 0;
let downY = 0;

const DRAG_THRESHOLD = 4;

window.qtReady.then((bridge) => {
  api = bridge;
});

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

orb.addEventListener("click", () => {
  if (dragging) {
    dragging = false;
    return;
  }
  if (api && api.open_chat) api.open_chat();
});

orb.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (dragging) return;
  if (api && api.show_menu) api.show_menu();
});
