/* Chat window. Content comes from Python (api.chat_send) or is pushed by
 * Python (window.assistant.onChatMessage / onPalette). Everything is
 * selectable and copyable. */

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const connStatus = document.getElementById("conn-status");

let apiReady = false;
window.addEventListener("pywebviewready", () => {
  apiReady = true;
  connStatus.textContent = "在线";
});

function api(name, ...args) {
  return new Promise((resolve) => {
    const fn = window.pywebview && window.pywebview.api && window.pywebview.api[name];
    if (!apiReady || !fn) {
      resolve(undefined);
      return;
    }
    Promise.resolve(fn(...args)).then(resolve).catch((err) => {
      console.error("api call failed:", name, err);
      resolve(undefined);
    });
  });
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function scrollToEnd() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
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
let busy = false;

function addMessage(role, text) {
  const msg = el("div", `msg ${role}`);
  const bubble = el("div", "bubble", text);
  msg.append(bubble, makeMeta(() => bubble.innerText));
  messagesEl.appendChild(msg);
  scrollToEnd();
  return bubble;
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
  const msg = el("div", "msg bot");
  msg.innerHTML = '<div class="bubble typing"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(msg);
  scrollToEnd();
  return msg;
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;

  addMessage("user", text);
  inputEl.value = "";
  autoResize();

  busy = true;
  sendBtn.disabled = true;
  const typing = showTyping();

  const res = await api("chat_send", text);

  typing.remove();
  const reply = res && res.text ? res.text : "（没有收到回复，Python 侧可能未就绪）";
  addMessage("bot", reply);

  busy = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

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

document.getElementById("btn-close").addEventListener("click", () => api("hide_chat"));
document.getElementById("btn-min").addEventListener("click", () => api("hide_chat"));
document.getElementById("btn-clear").addEventListener("click", () => {
  messagesEl.innerHTML = "";
  addMessage("bot", "对话已清空，继续聊吧～");
});

/* Events pushed from Python */
window.assistant = {
  onChatMessage(payload) { addMessage(payload.role, payload.text); },
  onPalette(payload) { addPalette(payload.groups); },
  setTheme(payload) {
    const theme = payload.theme;
    document.body.dataset.theme = theme;
    const gradientMap = {
      dark: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 45%, #ec4899 100%)",
      blue: "linear-gradient(135deg, #49bccf 0%, #63b3e8 45%, #22d3ee 100%)",
      light: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 45%, #6366f1 100%)",
    };
    document.body.style.background = gradientMap[theme] || gradientMap.dark;
  },
  setOpacity(payload) {
    const opacity = Math.max(0.2, Math.min(1.0, payload.opacity));
    document.body.style.opacity = String(opacity);
  },
};

inputEl.focus();