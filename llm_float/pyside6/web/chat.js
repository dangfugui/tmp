/* JS 控制台转发到 Python 日志（便于排查，经 WebChannel js_log 槽） */
(function () {
  function forward(level, args) {
    try {
      if (window.api && typeof window.api.js_log === "function") {
        window.api.js_log(level + ": " + Array.prototype.map.call(args, String).join(" "));
      }
    } catch (e) { /* 忽略转发失败 */ }
  }
  var _log = console.log, _err = console.error, _warn = console.warn;
  console.log = function () { forward("log", arguments); _log.apply(console, arguments); };
  console.error = function () { forward("error", arguments); _err.apply(console, arguments); };
  console.warn = function () { forward("warn", arguments); _warn.apply(console, arguments); };
})();

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

// 仅在没有 Python 后端（如纯浏览器打开预览）时兜底使用
const MOCK_REPLIES = [
  "当前未检测到 Python 后端，这是本地 Mock 回复。",
  "请通过 Python 启动悬浮窗应用后使用真实聊天。",
];

let api = null;
let busy = false;
let botEl = null; // 当前正在流式接收的机器人消息元素
let pendingBotText = null; // 待渲染的流式文本（rAF 节流）
let rafId = null;

function applyChatTheme(theme) {
  document.body.dataset.theme = theme || "flat";
}

window.qtReady.then((bridge) => {
  api = bridge;
  if (!api) return;

  // 标题下拉框：填充全部配置名，并选中当前匹配的配置
  initChatTitle();

  if (typeof api.get_settings !== "function") return;
  const data = api.get_settings();
  const sections = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  const theme = sections.flatMap((section) => section.items || []).find((item) => item.key === "theme");
  if (theme) applyChatTheme(theme.value);
});

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

  // 链接 [text](url)：onclick return false 防止 Qt WebEngine 在当前页导航
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

function finishReply(error) {
  removeTyping();
  if (botEl && pendingBotText !== null) {
    botEl.querySelector(".bubble").innerHTML = renderMarkdown(pendingBotText);
    pendingBotText = null;
  }
  botEl = null;
  busy = false;
  sendBtn.disabled = false;
  inputEl.focus();
  if (error) addMessage("bot", error);
}

/* ---------- Python 推送：window.assistant.onChatMessage ----------
   payload:
     { role: "bot", text: "...", done: false }   流式增量（text 为累计文本）
     { role: "bot", text: "...", done: true }    回复结束
     { role: "bot", error: "..." }               出错（等价 done）        */
window.assistant = window.assistant || {};
window.assistant.onChatMessage = function (payload) {
  if (!payload) return;
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
  pendingBotText = text;
  if (!botEl) {
    botEl = el("div", "msg bot");
    botEl.append(el("div", "bubble"), makeMeta(() => botEl.querySelector(".bubble").innerText));
    messagesEl.appendChild(botEl);
  }
  scheduleBotRender();
};

/* ---------- send flow ---------- */
function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;

  addMessage("user", text);
  inputEl.value = "";
  autoResize();

  busy = true;
  sendBtn.disabled = true;
  showTyping();

  // 有 Python 后端：触发后端（同步返回很快），流式回复由 onChatMessage 推送
  if (api && typeof api.chat_send === "function") {
    try {
      api.chat_send(text);
      return;
    } catch (err) {
      console.error("chat_send failed:", err);
      finishReply("发送失败：" + err);
      return;
    }
  }

  // 无后端（纯浏览器预览）：本地 Mock 兜底
  setTimeout(() => {
    removeTyping();
    addMessage("bot", MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)]);
    busy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }, 500 + Math.random() * 500);
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

window.assistant.setChatTitle = function (payload) {
  if (!payload || !payload.chatName) return;
  const select = document.getElementById("chat-title");
  if (select && Array.from(select.options).some((o) => o.value === payload.chatName)) {
    select.value = payload.chatName;
  }
};

/* 配置列表到达（Python 推送）：填充下拉框 */
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

/* 当前匹配配置到达（Python 推送）：选中 */
window.assistant.setActiveChatProfile = function (payload) {
  const select = document.getElementById("chat-title");
  if (!select || !payload || !payload.profile) return;
  const name = payload.profile.chatName;
  console.log("setActiveChatProfile:", name);
  if (name && Array.from(select.options).some((o) => o.value === name)) {
    select.value = name;
  }
};

/* 标题下拉框：发起请求，由 Python 推送配置列表与当前匹配项 */
function initChatTitle() {
  const select = document.getElementById("chat-title");
  if (!select) return;
  if (!api) return;
  // 诊断：get_settings 返回值类型（排查 WebChannel 返回值通道）
  if (typeof api.get_settings === "function") {
    try {
      const gs = api.get_settings();
      console.log("get_settings type:", typeof gs, "value:", JSON.stringify(gs).slice(0, 300));
    } catch (err) {
      console.error("get_settings failed:", err);
    }
  }
  if (typeof api.request_chat_profiles === "function") {
    api.request_chat_profiles();
  } else {
    console.error("request_chat_profiles not available");
  }
  if (typeof api.request_active_chat_profile === "function") {
    api.request_active_chat_profile();
  }
}

document.getElementById("chat-title").addEventListener("change", (e) => {
  if (api && typeof api.set_chat_profile === "function") {
    try {
      api.set_chat_profile(e.target.value);
    } catch (err) {
      console.error("set_chat_profile failed:", err);
    }
  }
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
