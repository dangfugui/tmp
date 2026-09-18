const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const titlebarEl = document.getElementById("titlebar");

const WELCOME = "你好，我是 AI 助手 👋\n输入消息即可开始对话（已接入 QwenPaw 聊天接口）。";

const PALETTES = [
  { title: "主色调", colors: ["#49BCCF", "#5BC2D3", "#45C1D6", "#00BCDC", "#40A8BD", "#AEF3FF"] },
  { title: "点缀色", colors: ["#2C3E50", "#3373B8"] },
  { title: "中性色", colors: ["#FFFFFF", "#AFAFAF", "#848383", "#656565", "#555555", "#525252", "#474747", "#313131", "#282828"] },
];

let busy = false;
let botEl = null; // 当前正在流式接收的机器人消息元素
let pendingBotText = null; // 待渲染的流式文本（rAF 节流）
let rafId = null;

function applyChatTheme(theme) {
  document.body.dataset.theme = theme || "flat";
}

// ===== Chrome 扩展桥：content script 中转的配置 / 状态推送 =====
window.addEventListener("message", (e) => {
  const data = e.data || {};
  if (data.kind !== "assistant" || !data.name) return;
  const fn = window.assistant[data.name];
  if (typeof fn === "function") fn(data.payload || {});
});

(function initFromStorage() {
  // 兜底：直接读 chrome.storage 填充（iframe 为扩展页，可访问）
  try {
    chrome.storage.local.get(["theme", "chat_profiles", "active_profile_name"], (d) => {
      if (d.theme) applyChatTheme(d.theme);
      if (d.chat_profiles) window.assistant.setChatProfiles({ profiles: d.chat_profiles });
      if (d.active_profile_name) window.assistant.setActiveChatProfile({ profile: { chatName: d.active_profile_name } });
    });
  } catch (e) { /* 非扩展环境忽略 */ }
})();

/* ================= Markdown 渲染（安全：先转义，再转换） ================= */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(src) {
  if (!src) return "";
  let text = escapeHtml(src);

  // 代码块 ```lang ... ```（转义后内容，占位符避免被后续规则破坏）
  const codeBlocks = [];
  text = text.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (m, lang, code) => {
    codeBlocks.push('<pre class="md-pre"><code>' + code.replace(/\n$/, "") + "</code></pre>");
    return "\u0000CB" + (codeBlocks.length - 1) + "\u0000";
  });

  // 行内代码 `...`
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (m, c) => {
    inlineCodes.push('<code class="md-code">' + c + "</code>");
    return "\u0000IC" + (inlineCodes.length - 1) + "\u0000";
  });

  // 链接 [text](url)：onclick return false 防止 iframe 内导航
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a class="md-link" href="$2" rel="noopener" onclick="return false">$1</a>'
  );

  // 粗体 / 斜体 / 删除线（先双星后单星）
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  // 恢复行内代码占位符
  text = text.replace(/\u0000IC(\d+)\u0000/g, (m, n) => inlineCodes[+n]);

  // 块级处理：标题 / 引用 / 列表 / 表格 / 段落
  const lines = text.split("\n");
  const out = [];
  let list = null; // "ul" | "ol" | null
  let para = [];
  let i = 0;

  const flushPara = () => {
    if (para.length) {
      out.push("<p>" + para.join("<br>") + "</p>");
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push("</" + list + ">");
      list = null;
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    // 代码块占位符
    const ph = line.match(/^\u0000CB(\d+)\u0000$/);
    if (ph) {
      flushPara(); flushList();
      out.push(codeBlocks[+ph[1]]);
      i += 1;
      continue;
    }
    if (!line) {
      flushPara(); flushList();
      i += 1;
      continue;
    }

    // 标题 # ~ ####
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara(); flushList();
      const lv = heading[1].length;
      out.push("<h" + lv + ' class="md-h">' + heading[2] + "</h" + lv + ">");
      i += 1;
      continue;
    }

    // 引用 > text（转义后为 &gt;）
    if (line.startsWith("&gt; ")) {
      flushPara(); flushList();
      out.push('<blockquote class="md-quote">' + line.slice(5) + "</blockquote>");
      i += 1;
      continue;
    }

    // 无序列表 - item / * item
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (list !== "ul") {
        flushList();
        out.push('<ul class="md-ul">');
        list = "ul";
      }
      out.push("<li>" + ul[1] + "</li>");
      i += 1;
      continue;
    }

    // 有序列表 1. item
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list !== "ol") {
        flushList();
        out.push('<ol class="md-ol">');
        list = "ol";
      }
      out.push("<li>" + ol[1] + "</li>");
      i += 1;
      continue;
    }

    // 表格 | a | b |（下一行是分隔行 | --- |）
    if (line.startsWith("|") && line.endsWith("|")) {
      flushPara(); flushList();
      const next = (lines[i + 1] || "").trim();
      const isSep = /^\|?[\s:|-]+\|?$/.test(next) && next.includes("-");
      if (isSep) {
        const heads = line.slice(1, -1).split("|").map((c) => c.trim());
        out.push('<table class="md-table"><thead><tr>' + heads.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>");
        i += 2;
        while (i < lines.length) {
          const r = lines[i].trim();
          if (!r.startsWith("|") || !r.endsWith("|")) break;
          const cells = r.slice(1, -1).split("|").map((c) => c.trim());
          out.push("<tr>" + cells.map((c) => "<td>" + c + "</td>").join("") + "</tr>");
          i += 1;
        }
        out.push("</tbody></table>");
        continue;
      }
      // 不是表格则按普通段落
    }

    // 普通行（并入段落）
    para.push(line);
    i += 1;
  }
  flushPara();
  flushList();

  let html = out.join("\n");
  // 恢复代码块占位符（若出现在段落行内则放行）
  html = html.replace(/\u0000CB(\d+)\u0000/g, (m, n) => codeBlocks[+n]);
  return '<div class="md-body">' + html + "</div>";
}

/* ================= 消息渲染 ================= */

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
  const bubble = el("div", "bubble");
  if (role === "bot") {
    bubble.innerHTML = renderMarkdown(text); // AI 回复渲染 Markdown
  } else {
    bubble.textContent = text; // 用户消息原样显示
  }
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

/* 流式渲染节流：高频增量合并到下一帧统一渲染 */
function scheduleBotRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (!botEl || pendingBotText === null) return;
    botEl.querySelector(".bubble").innerHTML = renderMarkdown(pendingBotText);
    pendingBotText = null;
    scrollToEnd();
  });
}

function setBusy(v) {
  // 等待回复时按钮切换为可点击的「停止」
  busy = v;
  sendBtn.classList.toggle("stop", v);
  sendBtn.title = v ? "停止" : "发送";
  // 同步 busy 给 content 的 uiState（经 uiState 事件到 Python）
  try { window.parent.postMessage({ kind: "chat", action: "chat_busy", busy: v }, "*"); } catch (e) { /* 忽略 */ }
}

function stopSend() {
  // 点击「停止」：断开 QwenPaw SSE 连接，本地立即收尾（AbortController）
  console.log("stop_chat requested");
  abortChat();
}

function finishReply(error) {
  removeTyping();
  if (botEl && pendingBotText !== null) {
    botEl.querySelector(".bubble").innerHTML = renderMarkdown(pendingBotText);
    pendingBotText = null;
  }
  botEl = null;
  setBusy(false);
  inputEl.focus();
  if (error) addMessage("bot", error);
}

window.assistant = window.assistant || {};
window.assistant.onChatMessage = function (payload) {
  if (!payload) return;
  // 事件上行 → Python（事件名 = SDK 事件名）
  try { chrome.runtime.sendMessage({ type: "llm_bridge_event", name: "onChatMessage", payload }); } catch (e) { /* 忽略 */ }
  if (payload.error) {
    finishReply(payload.error);
    return;
  }
  const text = payload.text || "";

  if (payload.done) {
    pendingBotText = text;
    if (!botEl && text) {
      botEl = el("div", "msg bot");
      botEl.append(el("div", "bubble"), makeMeta(() => botEl.querySelector(".bubble").innerText));
      messagesEl.appendChild(botEl);
    }
    finishReply();
    return;
  }

  // 流式增量
  removeTyping();
  if (!busy) setBusy(true); // 兜底：任何入口进入回复状态，按钮自动切为「停止」
  pendingBotText = text;
  if (!botEl) {
    botEl = el("div", "msg bot");
    botEl.append(el("div", "bubble"), makeMeta(() => botEl.querySelector(".bubble").innerText));
    messagesEl.appendChild(botEl);
  }
  scheduleBotRender();
};

/* ---------- QwenPaw 直连（iframe 为扩展页，host_permissions 豁免 CORS；SSE 解析同 Python 版） ---------- */
let chatAbort = null;
let currentProfileCache = null; // { profiles, name }

function refreshProfileCache() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["chat_profiles", "active_profile_name"], (d) => {
        currentProfileCache = {
          profiles: d.chat_profiles || [],
          name: d.active_profile_name || ""
        };
        resolve();
      });
    } catch (e) {
      currentProfileCache = { profiles: [], name: "" };
      resolve();
    }
  });
}

function currentProfile() {
  const c = currentProfileCache || { profiles: [], name: "" };
  return c.profiles.find((p) => p.chatName === c.name) || c.profiles[0] || {};
}

function responseText(event) {
  const out = event.output;
  const items = Array.isArray(out) ? out : (out && typeof out === "object" ? [out] : []);
  const parts = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.object === "message" && item.type !== "reasoning") {
      for (const c of item.content || []) {
        if (c && c.type === "text" && c.text) parts.push(c.text);
      }
    }
  }
  return parts.join("");
}

async function qwenChat(text) {
  await refreshProfileCache();
  const cfg = currentProfile();
  const baseUrl = (cfg.baseUrl || "http://localhost:8088").replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json", "X-Agent-Id": cfg.agentId || "default" };
  if (cfg.token) headers["Authorization"] = "Bearer " + cfg.token;
  const payload = {
    input: [{ role: "user", content: [{ type: "text", text }] }],
    session_id: cfg.sessionId || ("chrome-" + location.hostname),
    user_id: "chrome-user",
    channel: "console",
  };
  chatAbort = new AbortController();
  try {
    const resp = await fetch(baseUrl + "/api/console/chat", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: chatAbort.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      finishReply("HTTP " + resp.status + ": " + body.slice(0, 200));
      return;
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let accumulated = "";
    const msgTypes = {};
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (ev.error) {
          const m = typeof ev.error === "object" ? (ev.error.message || "未知错误") : String(ev.error);
          finishReply(m);
          return;
        }
        if (ev.object === "message" && ev.id) {
          msgTypes[ev.id] = ev.type || "message";
        } else if (ev.object === "content" && ev.type === "text") {
          if (msgTypes[ev.msg_id] === "message") {
            const t = ev.text || "";
            accumulated = ev.delta === false ? t : accumulated + t;
            window.assistant.onChatMessage({ role: "bot", text: accumulated, done: false });
          }
        } else if (ev.object === "response" && ev.status === "completed") {
          const ft = responseText(ev);
          if (ft) accumulated = ft;
          window.assistant.onChatMessage({ role: "bot", text: accumulated, done: true });
          return;
        }
      }
    }
    window.assistant.onChatMessage({ role: "bot", text: accumulated, done: true });
  } catch (err) {
    if (err && err.name === "AbortError") {
      // 用户停止：以已接收内容收尾（同 Python 语义）
      finishReply();
      return;
    }
    console.error("qwen chat failed:", err);
    finishReply("连接失败: " + err);
  }
}

function abortChat() {
  if (chatAbort) { try { chatAbort.abort(); } catch (e) { /* 忽略 */ } }
  removeTyping();
  botEl = null;
  pendingBotText = null;
  setBusy(false);
  inputEl.focus();
}

/* ---------- send flow ---------- */
function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;

  addMessage("user", text);
  inputEl.value = "";
  autoResize();

  setBusy(true);
  showTyping();

  // Chrome 扩展：本地直连 QwenPaw（SSE 解析与 Python 版一致）
  qwenChat(text);
}

/* ---------- Python 桥 / 控制台：外部发送与停止（方法名 = SDK 命令名） ---------- */
window.assistant.sendText = function (payload) {
  const text = payload && payload.text ? String(payload.text).trim() : "";
  if (!text || busy) return;
  addMessage("user", text);
  setBusy(true);
  showTyping();
  qwenChat(text);
};
window.assistant.stopChat = function () { stopSend(); };

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
sendBtn.addEventListener("click", () => {
  if (busy) { stopSend(); return; }
  send();
});

/* ---------- titlebar drag (iframe 模式：content script 拖动) ---------- */
titlebarEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (e.target.closest(".icon-btn")) return;
  window.parent.postMessage({ kind: "chat", action: "drag_start" }, "*");
});

/* ---------- window controls ---------- */
function callApi(method) {
  if (method === "hide_all") {
    window.parent.postMessage({ kind: "chat", action: "hide" }, "*");
  } else {
    console.warn("unsupported api:", method);
  }
}

/* 配置列表到达：填充下拉框 */
window.assistant.setChatProfiles = function (payload) {
  const select = document.getElementById("chat-title");
  if (!select || !payload || !Array.isArray(payload.profiles)) return;
  const profiles = payload.profiles;
  if (profiles.length) {
    select.innerHTML = "";
    profiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.chatName || "";
      opt.textContent = p.chatName || "(未命名)";
      select.appendChild(opt);
    });
  } else {
    select.innerHTML = '<option value="">AI 助手</option>';
  }
  console.log("setChatProfiles options:", select.options.length,
              "values:", Array.from(select.options).map((o) => o.value).join("|"));
};

/* 当前匹配配置到达：选中 */
window.assistant.setActiveChatProfile = function (payload) {
  const select = document.getElementById("chat-title");
  if (!select || !payload || !payload.profile) return;
  const name = payload.profile.chatName;
  console.log("setActiveChatProfile:", name);
  if (name && Array.from(select.options).some((o) => o.value === name)) {
    select.value = name;
  }
};

document.getElementById("chat-title").addEventListener("change", (e) => {
  const name = e.target.value;
  currentProfileCache = null; // 清缓存，下次发送前按名称重新拉取
  try { chrome.storage.local.set({ active_profile_name: name }); } catch (err) { /* 忽略 */ }
});

window.assistant.setTheme = function (payload) {
  applyChatTheme(payload && payload.theme ? payload.theme : "dark");
};

/* 全局拦截 Markdown 链接点击：不破坏悬浮窗页面 */
document.addEventListener(
  "click",
  (e) => {
    if (e.target.closest("a.md-link")) {
      e.preventDefault();
    }
  },
  true
);

document.getElementById("btn-close").addEventListener("click", () => callApi("hide_all"));
document.getElementById("btn-min").addEventListener("click", () => callApi("hide_all"));
document.getElementById("btn-clear").addEventListener("click", () => {
  messagesEl.innerHTML = "";
  addMessage("bot", WELCOME);
  addPalette(PALETTES);
});

/* ---------- init ---------- */
addMessage("bot", WELCOME);
addPalette(PALETTES);
inputEl.focus();
