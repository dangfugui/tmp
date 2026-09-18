// LLM Float content script — 模块：drag.js（悬浮球 / 聊天窗拖动）
  // ---------- 拖动 ----------
  // 悬浮球：Pointer Capture 协议（button.js 捕获指针后按屏幕坐标上报 drag_move/drag_end，无遮罩）
  // 聊天窗：遮罩协议（chat iframe 内 drag_start → 全屏遮罩接管 mousemove）
  var dragging = false;
  var dragFrame = null;  // pointer 模式：当前拖动的 iframe
  var dragOrigin = null; // pointer 模式：起始 {left, top}
  var dragMouse = null;  // pointer 模式：起始 {x, y}
  var dragEndFn = null;  // 遮罩模式：结束函数

  function ensureOrbDrag(x, y) {
    if (dragFrame) return;
    dragFrame = ORB;
    const r = ORB.getBoundingClientRect();
    dragOrigin = { left: r.left, top: r.top };
    dragMouse = { x: x, y: y };
    ORB.style.left = r.left + "px";
    ORB.style.top = r.top + "px";
    ORB.style.right = "auto";
    ORB.style.bottom = "auto";
  }
  function moveDrag(x, y) {
    // 注意顺序：dragFrame 为 null（首次拖动）时必须先初始化，不能直接 return
    if (!dragFrame) { ensureOrbDrag(x, y); return; }
    if (dragFrame !== ORB) return;
    if (!dragOrigin || !dragMouse) { ensureOrbDrag(x, y); return; }
    ORB.style.left = (dragOrigin.left + (x - dragMouse.x)) + "px";
    ORB.style.top = (dragOrigin.top + (y - dragMouse.y)) + "px";
    // 强关联：拖动悬浮球时，开着的弹窗实时跟随贴靠
    if (CHAT.classList.contains("show")) placePanel(CHAT, 400, 620, "top-left");
    if (BUBBLE.classList.contains("show")) placePanel(BUBBLE, 420, 96, "left");
  }
  function endDrag() {
    const wasOrb = (dragFrame === ORB);
    dragFrame = null;
    dragOrigin = null;
    dragMouse = null;
    if (dragEndFn) dragEndFn();
    dragEndFn = null;
    dragging = false;
    // 拖动悬浮球结束：开着的弹窗收尾贴靠一次（拖动聊天窗自身不重置其位置）
    if (wasOrb) {
      if (CHAT.classList.contains("show")) placePanel(CHAT, 400, 620, "top-left");
      if (BUBBLE.classList.contains("show")) placePanel(BUBBLE, 420, 96, "left");
    }
  }

  /* 遮罩模式（聊天窗）：全屏透明遮罩接管鼠标。
     不要用 ev.buttons 判断松开——mousedown 在 iframe 内、鼠标移到遮罩后，
     Chrome 跨 iframe 边界不传递按钮状态，buttons 恒为 0 会把拖动立即误杀。 */
  function startMaskDrag(frame) {
    if (dragging) return;
    dragging = true;
    const mask = document.createElement("div");
    mask.id = "llm-float-drag-mask";
    mask.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;cursor:grabbing;background:transparent;";
    document.documentElement.appendChild(mask);
    let started = false, sx = 0, sy = 0, bx = 0, by = 0;
    const end = () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", end);
      mask.removeEventListener("mouseup", end);
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
      dragEndFn = null;
      dragging = false;
    };
    const mv = (ev) => {
      if (!started) {
        started = true;
        const r = frame.getBoundingClientRect();
        bx = r.left; by = r.top; sx = ev.clientX; sy = ev.clientY;
        frame.style.left = bx + "px";
        frame.style.top = by + "px";
        frame.style.right = "auto";
        frame.style.bottom = "auto";
      }
      frame.style.left = (bx + ev.clientX - sx) + "px";
      frame.style.top = (by + ev.clientY - sy) + "px";
    };
    dragEndFn = end;
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", end);
    mask.addEventListener("mouseup", end); // 遮罩上松开：主结束路径（直接命中，不依赖冒泡）
  }
