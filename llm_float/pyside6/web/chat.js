const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const titlebarEl = document.getElementById("titlebar");

const WELCOME = "你好，我是 AI 助手 👋\n默认内容如下（当前为 UI Mock，尚未接入真实模型）。";

const PALETTES = [
  { title: "主色调", colors: ["#49BCCF", "#5BC2D3", "#45C1D6", "#00BCDC", "#40A8BD", "#AEF3FF"] },
  { title: "点缀色", colors: ["#2C3E50", "#3373B8"] },
  { title: "中性色", colors: ["#FFFFFF", "#AFAFAF", "#848383", "#656565", "#555555", "#525252", "#474747", "#313131", "#282828"] },
];

const MOCK_REPLIES = [
  "收到～ 这是 Mock 回复，后面把这里换成真实 LLM 即可。",
  "好的，我理解你的意思了。需要我把这段内容整理成要点吗？",
  "这个问题可以从三个角度来看：目标、现状、下一步。",
];

let api = null;
let busy = false;

function applyChatTheme(theme) {
  const isLight = theme === "light";
  document.body.dataset.theme = isLight ? "light" : "dark";
  document.body.classList.toggle("theme-light", isLight);
}

window.qtReady.then((bridge) => {
  api = bridge;
  if (!api || typeof api.get_settings !== "function") return;
  const data = api.get_settings();
  const sections = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  const theme = sections.flatMap((section) => section.items || []).find((item) => item.key === "theme");
  if (theme) applyChatTheme(theme.value);
});

/* ---------- helpers ---------- */
function timeLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function scrollToEnd() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- clipboard ---------- */
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (err) {
    console.error("copy failed:", err);
  }
  ta.remove();
}

function makeMeta(getText) {
  const meta = el("div", "meta");
  meta.appendChild(el("span", "time", timeLabel()));
  const btn = el("button", "copy-btn", "复制");
  btn.type = "button";
  btn.addEventListener("click", () => {
    copyText(getText());
    btn.textContent = "已复制";
    setTimeout(() => { btn.textContent = "复制"; }, 1200);
  });
  meta.appendChild(btn);
  return meta;
}

/* ---------- messages ---------- */
function addMessage(role, text) {
  const msg = el("div", `msg ${role}`);
  const bubble = el("div", "bubble", text);
  msg.append(bubble, makeMeta(() => bubble.innerText));
  messagesEl.appendChild(msg);
  scrollToEnd();
}

function addPalette(groups) {
  const msg = el("div", "msg bot palette-msg");
  const bubble = el("div", "bubble palette");

  groups.forEach((group) => {
    bubble.appendChild(el("div", "palette-title", group.title));
    const grid = el("div", "swatches");
    group.colors.forEach((hex) => {
      const item = el("div", "swatch");
      const chip = el("span", "chip");
      chip.style.background = hex;
      item.append(chip, el("span", "code", hex.toUpperCase()));
      grid.appendChild(item);
    });
    bubble.appendChild(grid);
  });

  msg.append(bubble, makeMeta(() => bubble.innerText));
  messagesEl.appendChild(msg);
  scrollToEnd();
}

function showTyping() {
  const msg = document.createElement("div");
  msg.className = "msg bot";
  msg.id = "typing";
  msg.innerHTML = '<div class="bubble typing"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(msg);
  scrollToEnd();
}

function removeTyping() {
  document.getElementById("typing")?.remove();
}

/* ---------- send flow (mocked) ---------- */
function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;

  addMessage("user", text);
  inputEl.value = "";
  autoResize();

  busy = true;
  sendBtn.disabled = true;
  showTyping();

  setTimeout(() => {
    removeTyping();
    addMessage("bot", MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)]);
    busy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }, 600 + Math.random() * 600);
}

/* ---------- input behavior ---------- */
function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
}

inputEl.addEventListener("input", autoResize);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
sendBtn.addEventListener("click", send);

/* ---------- titlebar drag (native window move) ---------- */
titlebarEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (e.target.closest(".icon-btn")) return;
  if (api && api.start_drag) api.start_drag();
});

/* ---------- window controls ---------- */
function callApi(method) {
  if (api && api[method]) {
    api[method]();
  } else {
    console.warn("qt api not ready:", method);
  }
}

window.assistant = window.assistant || {};
window.assistant.setTheme = function (payload) {
  applyChatTheme(payload && payload.theme === "light" ? "light" : "dark");
};

document.getElementById("btn-close").addEventListener("click", () => callApi("hide_chat"));
document.getElementById("btn-min").addEventListener("click", () => callApi("hide_chat"));
document.getElementById("btn-clear").addEventListener("click", () => {
  messagesEl.innerHTML = "";
  addMessage("bot", WELCOME);
  addPalette(PALETTES);
});

/* ---------- init ---------- */
addMessage("bot", WELCOME);
addPalette(PALETTES);
inputEl.focus();
