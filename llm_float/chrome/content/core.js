// LLM Float content script — 内核 core.js（面板注册表 / 定位 / 显隐互斥 / 拖动 / 命令表 / 状态上报 / 悬浮球交互）
// 职责：创建并管理所有面板 iframe（ORB 悬浮球 / CHAT 聊天窗 / BUBBLE 字幕气泡，均由功能单元注册）；
//       统一消息协议（页面 postMessage → feature 分发；background 命令 → 命令表）；
//       悬浮球拖动与弹窗贴靠定位；主题/配置推送；Python 桥状态上报。
// 顶层共享变量用 var：重复注入时 var 可覆盖而不报 SyntaxError；副作用集中在 initCore（由 main.js 注入守卫调用一次）。

var MARGIN = 20;
var ORB_WIN = 120;
var PANEL_FRAMES = {};   // name -> iframe
var ORB = null;          // 兼容别名：悬浮球 iframe（features 直接引用）
var CHAT = null;         // 兼容别名：聊天窗 iframe（features 直接引用）
var BUBBLE = null;       // 兼容别名：字幕气泡 iframe（features 直接引用）
var orbSize = 68;        // 可见圆直径（跟随设置 orb_size）
var currentTheme = "flat";
/* navigate 跳转沿用标记（启动时读 navigate_keep_profile 填入） */
var keepProfileOnStart = "";
/* 启动时读 navigate 沿用标记（一次性，读完即清） */
try { chrome.storage.local.get("navigate_keep_profile", (d) => { keepProfileOnStart = d.navigate_keep_profile || ""; try { chrome.storage.local.set({ navigate_keep_profile: "" }); } catch (e) {} }); } catch (e) {}
var uiState = {
  orb:    { enabled: true, state: "idle" },
  chat:   { open: false, busy: false },
  bubble: { show: false, mode: "subtitle" },
  tts:    { speaking: false, current: "" },
  asr:    { listening: false },
};

/* ========== 面板注册表 ========== */
var PANELS = {};         // name -> def {url, w, h, place, exclusive, cls, init, onLoad, onOpen, onClose}
function registerPanel(def) { PANELS[def.name] = def; return def; }

function createPanel(name) {
  const def = PANELS[name];
  if (!def) return null;
  const f = document.createElement("iframe");
  f.className = def.cls || "llm-float-panel";
  f.src = chrome.runtime.getURL(def.url);
  f.setAttribute("scrolling", "no");
  document.documentElement.appendChild(f);
  PANEL_FRAMES[name] = f;
  if (name === "orb") ORB = f;
  else if (name === "chat") CHAT = f;
  else if (name === "bubble") BUBBLE = f;
  // iframe 加载完成后重推（防止 postMessage 早于 iframe 脚本注册而丢失）
  f.addEventListener("load", () => {
    if (def.onLoad) { try { def.onLoad(); } catch (e) { console.error("[llm-float][core] panel onLoad " + name, e); } }
  });
  return f;
}

/* ========== 初始位置（各面板 def.init 声明） ========== */
function initPos() {
  for (const name of Object.keys(PANELS)) {
    const def = PANELS[name];
    if (!def || !def.init) continue;
    const f = PANEL_FRAMES[name];
    if (!f) continue;
    f.style.right = def.init.right;
    f.style.bottom = def.init.bottom;
    f.style.left = def.init.left;
    f.style.top = def.init.top;
  }
}

/* ========== iframe 通信辅助 ========== */
function post(frame, data) {
  try { frame.contentWindow.postMessage(data, "*"); } catch (e) { /* iframe 未就绪 */ }
}
function pushOrb(name, payload) { if (ORB) post(ORB, { kind: "assistant", name, payload }); }
function pushChat(name, payload) { if (CHAT) post(CHAT, { kind: "assistant", name, payload }); }
function pushBubble(name, payload) { if (BUBBLE) post(BUBBLE, { kind: "assistant", name, payload }); }

/* ========== 弹窗跟随悬浮球定位 ========== */
// 锚定的是【可见的圆】（圆在 120×120 iframe 内居中，不是透明外框），
// 否则弹窗会贴在透明框边缘，视觉上离圆有一截"隐形距离"。
// mode "top-left"：聊天窗 → 右下角贴圆的左上角（左不够放右侧，上不够放下方）
// mode "left"   ：字幕气泡 → 右侧贴圆的左侧、垂直居中（左不够放右侧）
function placePanel(frame, w, h, mode) {
  const r = ORB.getBoundingClientRect();
  const inset = Math.max(0, (r.width - orbSize) / 2); // 圆在 iframe 内的内边距
  const cx = r.left + inset;   // 圆左上角 x
  const cy = r.top + inset;    // 圆左上角 y
  const gap = mode === "left" ? 10 : 0; // 气泡留 10px 呼吸感；聊天窗零间距
  let left, top;
  if (mode === "left") {
    left = cx - w - gap;
    top = Math.round(cy + orbSize / 2 - h / 2);
    if (left < 8) left = (r.right - inset) + gap; // 左侧放不下 → 球右侧
  } else {
    left = cx - w - gap;
    top = cy - h - gap;
    if (left < 8) left = (r.right - inset) + gap; // 左边不够 → 球右侧
    if (top < 8) top = cy + orbSize + gap;        // 上方不够 → 球下方
  }
  top = Math.min(Math.max(8, top), window.innerHeight - h - 8);
  left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
  frame.style.left = left + "px";
  frame.style.top = top + "px";
  frame.style.right = "auto";
  frame.style.bottom = "auto";
}

/* ========== 打开 / 关闭（含互斥链） ========== */
// 互斥规则：exclusive 面板互斥——打开一个时关闭其他已开的 exclusive 面板；
//           关闭字幕气泡时额外停 TTS/ASR（经命令表，feature 未注册时无副作用）。
function openPanel(name, opts = {}) {
  const def = PANELS[name];
  const f = PANEL_FRAMES[name];
  if (!def || !f) return { ok: false, error: "unknown panel: " + name };
  if (def.exclusive) {
    for (const k of Object.keys(PANEL_FRAMES)) {
      if (k === name) continue;
      const d = PANELS[k];
      if (!d || !d.exclusive) continue;
      if (!PANEL_FRAMES[k].classList.contains("show")) continue;
      if (k === "bubble") { callCommand("stopSpeak", {}); callCommand("stopAsr", {}); }
      closePanel(k);
    }
  }
  f.classList.add("show");
  if (def.w && def.h) placePanel(f, def.w, def.h, def.place || "left");
  if (def.onOpen) { try { def.onOpen(); } catch (e) { console.error("[llm-float][core] panel onOpen " + name, e); } }
  return { ok: true };
}
function closePanel(name, opts = {}) {
  const def = PANELS[name];
  const f = PANEL_FRAMES[name];
  if (!def || !f) return;
  if (!f.classList.contains("show") && !opts.force) return;
  f.classList.remove("show");
  f.classList.remove("asr-active"); // 气泡：退出识别恢复点击穿透
  if (def.onClose) { try { def.onClose(); } catch (e) { console.error("[llm-float][core] panel onClose " + name, e); } }
}

/* ========== 配置推送 ========== */
function pushThemeAll() {
  pushOrb("setTheme", { theme: currentTheme });
  pushChat("setTheme", { theme: currentTheme });
  pushBubble("setTheme", { theme: currentTheme });
}
function pushOrbSize() {
  try {
    chrome.storage.local.get(["orb_size"], (d) => {
      orbSize = d.orb_size || 68;
      pushOrb("setOrbSize", { size: orbSize });
    });
  } catch (e) { /* 忽略 */ }
}
function pushProfiles() {
  try {
    chrome.storage.local.get(["chat_profiles"], (d) => {
      const profiles = d.chat_profiles || [];
      pushChat("setChatProfiles", { profiles });
      let matched = null;
      // 优先：navigate 跳转过来的，沿用之前的 agent（标记已在启动时读+清）
      if (keepProfileOnStart) {
        matched = profiles.find((p) => p.chatName === keepProfileOnStart);
        keepProfileOnStart = "";
      }
      // 否则：根据当前页面 URL 匹配 profile
      if (!matched) {
        const url = location.href || "";
        matched = profiles[0];
        for (let i = 1; i < profiles.length; i++) {
          const p = profiles[i] || {};
          if (!p.urlRegex) continue;
          try { if (new RegExp(p.urlRegex).test(url)) { matched = p; break; } } catch (e) { /* 非法正则跳过 */ }
        }
      }
      if (matched) {
        pushChat("setActiveChatProfile", { profile: { chatName: matched.chatName } });
        try { chrome.storage.local.set({ active_profile_name: matched.chatName }); } catch (e) {}
      }
    });
  } catch (e) { /* 忽略 */ }
}

/* ========== Python 桥 / 控制台：UI 状态聚合与事件上报 ========== */
function reportToBridge(name, payload) {
  try { chrome.runtime.sendMessage({ type: "llm_bridge_event", name, payload }); } catch (e) { /* 忽略 */ }
}
function setUi(patch) {
  Object.assign(uiState, patch);
  reportToBridge("uiState", uiState);
}
function pushOrbState(state) {
  uiState.orb.state = state;
  pushOrb("setOrbState", { state });
  reportToBridge("orbState", { state });
  reportToBridge("uiState", uiState);
}

/* ========== 命令表（命令名 = JS 函数名 = SDK 命令名，保持兼容） ========== */
var COMMANDS = {};
function registerCommand(name, fn) { COMMANDS[name] = fn; }
function callCommand(name, params) {
  const fn = COMMANDS[name];
  if (!fn) return { ok: false, error: "unknown cmd: " + name };
  try { return fn(params || {}) || { ok: true }; }
  catch (e) { console.error("[llm-float][cmd] " + name, e); return { ok: false, error: String((e && e.message) || e) }; }
}

/* 内置命令：与旧 bridgeHandle case 同名同语义 */
registerCommand("ping", () => ({ ok: true }));
registerCommand("getState", () => ({ ok: true, data: uiState }));
registerCommand("setTheme", (p) => { currentTheme = p.theme || currentTheme; pushThemeAll(); return { ok: true }; });
registerCommand("setOrbSize", (p) => { orbSize = p.orb_size || orbSize; pushOrb("setOrbSize", { size: orbSize }); return { ok: true }; });
registerCommand("setOrbOpacity", (p) => { pushOrb("setOpacity", { opacity: p.orb_opacity }); pushBubble("setOpacity", { opacity: p.orb_opacity }); return { ok: true }; });
registerCommand("hideAll", () => {
  closePanel("chat");
  callCommand("stopSpeak", {}); callCommand("stopAsr", {});
  closePanel("bubble");
  pushOrbState("idle");
  return { ok: true };
});
registerCommand("runDemo", (p) => {
  const isAsr = p && p.demo === "asr";
  callCommand("stopSpeak", {}); callCommand("stopAsr", {});
  pushOrbState(isAsr ? "asr" : "tts");
  openPanel("bubble");
  pushBubble("setTheme", { theme: currentTheme });
  if (isAsr) callCommand("startAsrDemo", {});
  else pushBubble("runDemo", { type: "tts" });
  return { ok: true };
});

/* ========== 悬浮球拖动（Pointer 捕获协议 + 聊天窗遮罩协议） ========== */
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
  if (PANEL_FRAMES.chat && PANELS.chat && PANEL_FRAMES.chat.classList.contains("show")) placePanel(PANEL_FRAMES.chat, PANELS.chat.w, PANELS.chat.h, "top-left");
  if (PANEL_FRAMES.bubble && PANELS.bubble && PANEL_FRAMES.bubble.classList.contains("show")) placePanel(PANEL_FRAMES.bubble, PANELS.bubble.w, PANELS.bubble.h, "left");
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
    if (PANEL_FRAMES.chat && PANELS.chat && PANEL_FRAMES.chat.classList.contains("show")) placePanel(PANEL_FRAMES.chat, PANELS.chat.w, PANELS.chat.h, "top-left");
    if (PANEL_FRAMES.bubble && PANELS.bubble && PANEL_FRAMES.bubble.classList.contains("show")) placePanel(PANEL_FRAMES.bubble, PANELS.bubble.w, PANELS.bubble.h, "left");
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

/* ========== 悬浮球交互（button iframe 上报，内核处理） ========== */
function handleOrbAction(data) {
  if (data.action === "drag_move") moveDrag(data.x, data.y);
  else if (data.action === "drag_end") endDrag();
  else if (data.action === "open_chat") { endDrag(); callCommand("showChat", {}); pushOrbState("chat"); }
  else if (data.action === "open_asr") { callCommand("stopSpeak", {}); callCommand("startAsr", {}); }
}

/* ========== 总开关 ========== */
function setEnabled(enabled) {
  const on = !!enabled; // 悬浮助手总开关（默认开启）
  for (const k of ["orb", "chat", "bubble"]) { const f = PANEL_FRAMES[k]; if (f) f.classList.toggle("llm-float-disabled", !on); }
  if (!on) {
    closePanel("chat");
    callCommand("stopSpeak", {}); callCommand("stopAsr", {});
    closePanel("bubble");
  }
  setUi({ orb: { enabled: on } });
}

/* ========== 面板页面消息分发（iframe postMessage → feature 注册的处理器） ========== */
var PANEL_MSG = {};    // kind -> [handler(kind, data)]
function registerPanelMessage(kind, fn) { (PANEL_MSG[kind] = PANEL_MSG[kind] || []).push(fn); }
function dispatchPanelMessage(kind, data) {
  for (const fn of (PANEL_MSG[kind] || [])) {
    try { fn(kind, data); } catch (e) { console.error("[llm-float][panel-msg] " + kind, e); }
  }
}

/* ========== 内置面板：orb（悬浮球） + bubble（字幕气泡，TTS/ASR 共用公共资源） ========== */
registerPanel({
  name: "orb", url: "ui/button.html", cls: "llm-float-orb-frame", exclusive: false,
  init: { right: MARGIN + "px", bottom: MARGIN + "px", left: "auto", top: "auto" },
  onLoad: () => { pushThemeAll(); pushOrbSize(); },
});
registerPanel({
  name: "bubble", url: "ui/bubble.html", w: 420, h: 96, place: "left",
  cls: "llm-float-bubble-frame", exclusive: true,
  onLoad: () => { pushThemeAll(); },
  onOpen: () => { setUi({ bubble: { show: true } }); reportToBridge("bubbleShown", { mode: uiState.bubble.mode }); },
  onClose: () => {
    pushBubble("stopDemo", {}); // 停止气泡内正在播放的 TTS / 正在识别的 ASR
    setUi({ bubble: { show: false, mode: "subtitle" }, tts: { speaking: false, current: "" }, asr: { listening: false } });
    reportToBridge("bubbleHidden", {});
  },
});

/* ========== 初始化：创建全部已注册面板 + 拉全局配置推给 iframe ========== */
function initCore() {
  for (const name of Object.keys(PANELS)) createPanel(name);
  initPos();
  window.addEventListener("resize", () => { if (!dragging) initPos(); });
  try {
    chrome.runtime.sendMessage({ type: "llm_init" }, (resp) => {
      if (chrome.runtime.lastError) return;
      const d = (resp && resp.data) || {};
      currentTheme = d.theme || "flat";
      pushThemeAll();
      orbSize = d.orb_size || 68;
      pushOrb("setOrbSize", { size: orbSize });
      pushChat("setChatProfiles", { profiles: d.chat_profiles || [] });
      pushChat("setActiveChatProfile", { profile: { chatName: d.active_profile_name || "" } });
      setEnabled(d.orb_enabled !== false);
      callCommand("startTtsTarget", {}); // 由 tts feature 注册；未注册时返回 unknown（无副作用）
    });
  } catch (e) { /* 忽略 */ }
}
