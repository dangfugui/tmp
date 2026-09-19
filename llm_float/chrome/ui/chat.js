const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const titlebarEl = document.getElementById("titlebar");

const WELCOME = "你好，我是 AI 助手 👋\n输入消息即可开始对话。";


let busy = false;
let botEl = null; // 当前正在流式接收的机器人消息元素
let pendingBotText = null; // 待渲染的流式文本（rAF 节流）
let rafId = null;

function applyChatTheme(theme) {
  document.body.dataset.theme = theme || "flat";
}

(function initFromStorage() {
  // 兜底：直接读 chrome.storage 填充（iframe 为扩展页，可访问；主题由 common.js 兜底）
  try {
    chrome.storage.local.get(["chat_profiles", "active_profile_name", "orb_opacity"], (d) => {
      if (d.orb_opacity !== undefined) document.body.style.opacity = String(Math.max(0.2, Math.min(1.0, Number(d.orb_opacity))));
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
        out.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>' + heads.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>");
        i += 2;
        while (i < lines.length) {
          const r = lines[i].trim();
          if (!r.startsWith("|") || !r.endsWith("|")) break;
          const cells = r.slice(1, -1).split("|").map((c) => c.trim());
          out.push("<tr>" + cells.map((c) => "<td>" + c + "</td>").join("") + "</tr>");
          i += 1;
        }
        out.push("</tbody></table></div>");
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
let restoring = false; // 恢复历史时不重复存
let currentProfileName = ""; // 当前 agent 名（历史按 agent 分 key）
function historyKey() { return "chat_history_" + (currentProfileName || "default"); }

function addMessage(role, text, detail) {
  const msg = el("div", `msg ${role}`);
  const bubble = el("div", "bubble");
  if (role === "bot") {
    bubble.innerHTML = renderMarkdown(text); // AI 回复渲染 Markdown
  } else if (role === "tool") {
    // 工具调用消息用工具样式
    bubble.className = "bubble tool";
    bubble.textContent = text;
    bubble.style.cursor = "pointer";
    bubble.title = "点击展开/收起详情";
    // 如果有详情，加展开功能
    if (detail) {
      const detailEl = el("pre", "tool-detail");
      detailEl.textContent = detail;
      detailEl.style.display = "none";
      bubble.addEventListener("click", () => {
        detailEl.style.display = detailEl.style.display === "none" ? "block" : "none";
      });
      msg.append(bubble, detailEl);
      messagesEl.appendChild(msg);
      scrollToEnd();
      // 持久化消息历史（按 agent 分 key，导航后自动恢复，最多 100 条）
      if (!restoring && text) {
        const key = historyKey();
        try {
          chrome.storage.local.get({ [key]: [] }, (d) => {
            const h = (d[key] || []).slice(-99);
            h.push({ role, text, detail });
            chrome.storage.local.set({ [key]: h });
          });
        } catch (e) { /* 忽略 */ }
      }
      return;
    }
  } else {
    bubble.textContent = text; // 用户消息原样显示
  }
  msg.append(bubble, makeMeta(() => bubble.innerText));
  messagesEl.appendChild(msg);
  scrollToEnd();
  // 持久化消息历史（按 agent 分 key，导航后自动恢复，最多 100 条）
  if (!restoring && text) {
    const key = historyKey();
    try {
      chrome.storage.local.get({ [key]: [] }, (d) => {
        const h = (d[key] || []).slice(-99);
        h.push({ role, text });
        chrome.storage.local.set({ [key]: h });
      });
    } catch (e) { /* 忽略 */ }
  }
}


let askUserCb = null;
function onAskUser(question, options, cb) {
  // 在聊天窗显示问题，等用户输入
  addMessage("bot", "❓ " + question, true);
  // 显示快捷选项按钮（用主题 CSS 变量，跟随主题变化）
  if (options && options.length) {
    const optDiv = document.createElement("div");
    optDiv.className = "ask-options";
    optDiv.style.cssText = "display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;";
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.textContent = opt;
      btn.style.cssText = "padding:6px 14px;border:1px solid var(--accent);border-radius:16px;background:color-mix(in srgb, var(--accent) 15%, transparent);color:var(--accent);cursor:pointer;font-size:13px;transition:all .2s;";
      btn.addEventListener("mouseenter", () => { btn.style.background = "var(--accent)"; btn.style.color = "var(--text-primary)"; });
      btn.addEventListener("mouseleave", () => { btn.style.background = "color-mix(in srgb, var(--accent) 15%, transparent)"; btn.style.color = "var(--accent)"; });
      btn.addEventListener("click", () => {
        const cb = askUserCb;
        askUserCb = null;
        inputEl.placeholder = "输入消息...";
        optDiv.remove();
        addMessage("user", opt);
        cb && cb(opt);
      });
      optDiv.appendChild(btn);
    }
    messagesEl.appendChild(optDiv);
    scrollToEnd();
  }
  inputEl.placeholder = "回答问题...";
  inputEl.focus();
  askUserCb = cb;
}
window.assistant.onAskUser = onAskUser;

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
    const finalText = pendingBotText;
    botEl.querySelector(".bubble").innerHTML = renderMarkdown(finalText);
    // 存 bot 最终文本到历史
    if (finalText) {
      const key = historyKey();
      try {
        chrome.storage.local.get({ [key]: [] }, (d) => {
          const h = (d[key] || []).slice(-99);
          h.push({ role: "bot", text: finalText });
          chrome.storage.local.set({ [key]: h });
        });
      } catch (e) { /* 忽略 */ }
    }
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
      chrome.storage.local.get(["chat_profiles", "active_profile_name", "orb_opacity", "context_turns"], (d) => {
      if (d.orb_opacity !== undefined) document.body.style.opacity = String(Math.max(0.2, Math.min(1.0, Number(d.orb_opacity))));
        currentProfileCache = {
          profiles: d.chat_profiles || [],
          name: d.active_profile_name || "",
          contextTurns: parseInt(d.context_turns || "10", 10) || 10
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
  // 标准 OpenAI 停止 = abort 流式请求；已收到的文本保留，由 AbortError 回调的 finishReply() 渲染成最终气泡
  if (chatAbort) { try { chatAbort.abort(); } catch (e) { /* 忽略 */ } }
  removeTyping();
  setBusy(false);
  inputEl.focus();
}

/* ================= LLM 模式（OpenAI 兼容 + 轻量 agent 工具） ================= */
// 配置 mode='llm' 时启用（设置 → 聊天（网址匹配）→ 模式列）。
// baseUrl 直接填完整接口地址（如 https://api.deepseek.com/chat/completions），不做拼接；
// agentId 字段作模型名；token 作 OpenAI API Key。
// 工具：page_* 扩展内执行（操作当前网页）；fs_* 走 File System Access 授权目录（免 Python）。
// agent 循环：LLM 返回 tool_calls → 执行工具 → 结果回填 → 继续下一轮，直到纯文本回复。

let llmMessages = [];
let llmRound = 0;
const MAX_TOOL_ROUNDS = 20;
/* 从 agent-prompt.md 加载 system prompt（LLM 模式专用，qwenpaw 模式不用） */
let SYSTEM_PROMPT = "你是一个网页助手，可以帮用户操作当前页面。用中文回复。";
fetch(chrome.runtime.getURL("data/agent-prompt.md"))
  .then((r) => r.text())
  .then((t) => { SYSTEM_PROMPT = t.trim(); })
  .catch(() => { /* 加载失败用兜底 */ });

/* agent 工具已迁到 ui/agent.js */
/* ---- 工具执行与气泡展示 ---- */
function addToolMsg(icon, name, summary) {
  const msg = el("div", "msg bot tool-msg");
  const b = el("div", "bubble tool");
  b.textContent = icon + " " + name + "  →  " + summary;
  b.style.cursor = "pointer";
  b.title = "点击展开/收起详情";
  const detail = el("pre", "tool-detail");
  detail.style.display = "none";
  b.addEventListener("click", () => {
    detail.style.display = detail.style.display === "none" ? "block" : "none";
  });
  msg.append(b, detail);
  messagesEl.appendChild(msg);
  scrollToEnd();
  return msg;
}

const TOOL_ICONS = {
  page_get_info: "🌐", page_read: "📖", page_exec_js: "⚡",
  fs_read: "📂", fs_write: "✏️", fs_find: "🔍",
  page_click: "👆", page_set_input: "⌨️", page_get_attr: "📋",
  navigate: "🧭", page_scroll: "📜", page_hover: "🖱️",
  page_wait: "⏳", page_get_html: "📄", page_select: "🎯",
};

async function dispatchTool(name, args) {
  const fn = AGENT_TOOLS[name];
  if (!fn) return { error: "unknown tool: " + name };
  // done 工具不显示在工具列表（只是结束信号）
  if (name === "done") return fn(args || {});
  const msgEl = addToolMsg(TOOL_ICONS[name] || "🔧", name, "执行中…");
  const b = msgEl.querySelector(".bubble");
  const r = await fn(args || {});
  const icon = TOOL_ICONS[name] || "🔧";
  let summary = "✅";
  if (r.error) {
    summary = "❌ " + r.error;
  } else {
    if (r.content !== undefined) {
      // 短结果直接显示内容，长的只显示长度
      const short = r.content.length <= 80;
      summary = short ? "✅ " + r.content.replace(/\s+/g, " ").trim().slice(0, 80) : "✅ " + r.content.length + " 字符";
    }
    else if (r.matches) summary = "✅ " + r.matches.length + " 个匹配" + (r.matches.length <= 5 ? "（" + r.matches.slice(0, 5).join("、") + "）" : "");
    else if (r.written !== undefined) summary = "✅ 写入 " + r.written + " 字符";
    else if (r.data && r.data.value !== undefined && String(r.data.value).length <= 80) summary = "✅ " + String(r.data.value).replace(/\s+/g, " ").trim().slice(0, 80);
    else if (r.data && r.data.selected) summary = "✅ " + (r.data.text || r.data.selected);
    else if (r.data && r.data.clicked) summary = "✅ " + (r.data.tag || "");
    else if (r.data && r.data.set) summary = "✅ " + (r.data.tag || "");
    else if (r.data && r.data.waited) summary = "✅ " + r.data.waited + "ms";
    else if (r.data && r.data.scrolled) summary = "✅ " + r.data.scrolled;
  }
  if (b) b.textContent = icon + " " + name + "  →  " + summary;
  const detail = msgEl.querySelector(".tool-detail");
  if (detail) {
    const argsStr = Object.keys(args || {}).length ? JSON.stringify(args, null, 2) : "（无参数）";
    const resultStr = JSON.stringify(r, null, 2);
    detail.textContent = "▼ 参数\n" + argsStr + "\n\n▼ 结果\n" + resultStr;
  }
  scrollToEnd();
  // 把工具调用也存到历史里（刷新后还能看到，含详情）
  if (!restoring) {
    const toolText = icon + " " + name + "  →  " + summary;
    const argsStr = Object.keys(args || {}).length ? JSON.stringify(args, null, 2) : "（无参数）";
    const resultStr = JSON.stringify(r, null, 2).slice(0, 2000); // 详情截断，省空间
    const toolDetail = "▼ 参数\n" + argsStr + "\n\n▼ 结果\n" + resultStr;
    try {
      const key = historyKey();
      chrome.storage.local.get({ [key]: [] }, (d) => {
        const h = (d[key] || []).slice(-99);
        h.push({ role: "tool", text: toolText, detail: toolDetail });
        chrome.storage.local.set({ [key]: h });
      });
    } catch (e) {}
  }
  return r;
}

/* ---- OpenAI 兼容流式对话（含工具循环） ---- */
function openaiChat(text) {
  llmMessages.push({ role: "user", content: text });
  llmRound = 0;
  runLlmLoop();
}

async function runLlmLoop() {
  while (true) {
    if (++llmRound > MAX_TOOL_ROUNDS) { finishReply("工具调用轮数超限，已停止"); return; }
    const next = await oneLlmCall();
    if (!next) return;
    // 检查是否调用了 done
    const lastTool = llmMessages[llmMessages.length - 1];
    if (lastTool && lastTool.role === "assistant" && lastTool.tool_calls) {
      const doneCall = lastTool.tool_calls.find((t) => t.function && t.function.name === "done");
      if (doneCall) {
        try {
          const args = JSON.parse(doneCall.function.arguments || "{}");
          if (args.text) finishReply(args.text);
          else finishReply();
        } catch (e) { finishReply(); }
        return;
      }
    }
  }
}

let llmCallStart = 0;
async function oneLlmCall() {
  llmCallStart = Date.now();
  await refreshProfileCache();
  const cfg = currentProfile();
  // 直接用设置里填的完整接口地址，不做任何拼接/猜测
  const baseUrl = String(cfg.baseUrl || "").trim();
  if (!baseUrl) { finishReply("LLM 模式：Base URL 未配置（请填完整接口地址，如 https://api.deepseek.com/chat/completions）"); return false; }
  if (!cfg.token) { finishReply("LLM 模式：缺少 Token（OpenAI API Key）"); return false; }
  const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.token };
  // 上下文轮数限制：只传最新的 N 轮（默认 10 轮）
  // 注意：要从完整的轮次开始，不能截断 tool_calls/tool 对
  const ctxTurns = (currentProfileCache && currentProfileCache.contextTurns) || 10;
  let recentMsgs = llmMessages;
  if (llmMessages.length > ctxTurns * 4) {
    // 从后往前找，找到第 ctxTurns 个 user 消息，从那里开始取
    let userCount = 0;
    let startIdx = 0;
    for (let i = llmMessages.length - 1; i >= 0; i--) {
      if (llmMessages[i].role === "user") {
        userCount++;
        if (userCount >= ctxTurns) { startIdx = i; break; }
      }
    }
    recentMsgs = llmMessages.slice(startIdx);
  }

  const body = {
    model: cfg.agentId || "qwen-plus",
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...recentMsgs],
    stream: true,
    tools: AGENT_TOOL_DEFS,
    tool_choice: "auto",
  };
  chatAbort = new AbortController();
  try {
    const resp = await fetch(baseUrl, {
      method: "POST", headers, body: JSON.stringify(body), signal: chatAbort.signal,
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      finishReply("LLM HTTP " + resp.status + ": " + t.slice(0, 200));
      return false;
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let accumulated = "";
    const toolCalls = {}; // index -> {id, name, args}
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") { buf = ""; break; }
        let ev;
        try { ev = JSON.parse(payload); } catch (e) { continue; }
        const delta = ev.choices && ev.choices[0] && ev.choices[0].delta;
        if (!delta) continue;
        if (delta.content) {
          accumulated += delta.content;
          window.assistant.onChatMessage({ role: "bot", text: accumulated, done: false });
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const slot = toolCalls[tc.index] || (toolCalls[tc.index] = { id: "", name: "", args: "" });
            if (tc.id) slot.id = tc.id;
            if (tc.function) {
              if (tc.function.name) slot.name += tc.function.name;
              if (tc.function.arguments) slot.args += tc.function.arguments;
            }
          }
        }
      }
    }
    const calls = Object.keys(toolCalls).sort((a, b) => a - b).map((i) => toolCalls[i]).filter((t) => t.name);
    if (calls.length) {
      // 收尾当前文本为完整气泡，再进入工具执行（下一轮会新建气泡）
      if (accumulated) window.assistant.onChatMessage({ role: "bot", text: accumulated, done: true });
      else finishReply();
      // assistant（含 tool_calls）入历史
      llmMessages.push({
        role: "assistant", content: accumulated || null,
        tool_calls: calls.map((t) => ({ id: t.id || ("call_" + t.name), type: "function", function: { name: t.name, arguments: t.args || "{}" } })),
      });
      for (const t of calls) {
        let args = {};
        try { args = JSON.parse(t.args || "{}"); } catch (e) { args = {}; }
        const result = await dispatchTool(t.name, args);
        if (result && result.needAuth) {
          // 未授权：停止 LLM 调用，只弹授权提示条，不把错误回给 LLM 继续跑
          finishReply("⏸ 已暂停：需要授权工作目录。请点击聊天窗口底部的授权按钮，授权后重新发送消息。");
          return false;
        }
        llmMessages.push({ role: "tool", tool_call_id: t.id || ("call_" + t.name), content: JSON.stringify(result).slice(0, 3000) });
      }
      return true; // 继续下一轮 LLM
    }
    // 纯文本回复：入历史并收尾
    llmMessages.push({ role: "assistant", content: accumulated });
    window.assistant.onChatMessage({ role: "bot", text: accumulated, done: true });
    return false;
  } catch (err) {
    if (err && err.name === "AbortError") { finishReply(); return false; }
    console.error("llm chat failed:", err);
    finishReply("LLM 连接失败: " + err);
    return false;
  }
}

/* ---------- send flow ---------- */
function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;

  // ask_user 模式：把回答返回给 LLM，不走普通发送流程
  if (askUserCb) {
    const cb = askUserCb;
    askUserCb = null;
    inputEl.placeholder = "输入消息...";
    const optDiv = document.querySelector(".ask-options");
    if (optDiv) optDiv.remove();
    addMessage("user", text);
    inputEl.value = "";
    autoResize();
    cb(text);
    return;
  }

  addMessage("user", text);
  inputEl.value = "";
  autoResize();

  setBusy(true);
  showTyping();

  // 分发前先刷新配置缓存（设置页保存后无需刷新页面即生效）
  refreshProfileCache().then(() => {
    // 模式分发：mode='llm' → OpenAI 兼容 + agent 工具；否则 QwenPaw（原有逻辑不变）
    if (currentProfile().mode === 'llm') openaiChat(text);
    else qwenChat(text);
  });
}

/* ---------- Python 桥 / 控制台：外部发送与停止（方法名 = SDK 命令名） ---------- */
window.assistant.sendText = function (payload) {
  const text = payload && payload.text ? String(payload.text).trim() : "";
  if (!text || busy) return;
  addMessage("user", text);
  setBusy(true);
  showTyping();
  refreshProfileCache().then(() => {
    if (currentProfile().mode === 'llm') openaiChat(text);
    else qwenChat(text);
  });
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
  // profile 变了：更新当前名 + 重载该 agent 的历史
  if (name && name !== currentProfileName) {
    currentProfileName = name;
    llmMessages = [];
    restoreHistory();
  }
};

document.getElementById("chat-title").addEventListener("change", (e) => {
  const name = e.target.value;
  currentProfileCache = null; // 清缓存，下次发送前按名称重新拉取
  llmMessages = []; // LLM 模式：切换配置即切换 agent，清空上下文
  currentProfileName = name;
  restoreHistory(); // 加载该 agent 的历史
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
  llmMessages = []; // LLM 模式：清空聊天同时清空对话上下文
  try { chrome.storage.local.set({ [historyKey()]: [] }); } catch (e) {}
  addMessage("bot", WELCOME);
});

/* ---------- init ---------- */
function restoreHistory() {
  try {
    chrome.storage.local.get(["active_profile_name"], (d) => {
      if (!currentProfileName) currentProfileName = d.active_profile_name || "";
      const key = historyKey();
      chrome.storage.local.get({ [key]: [] }, (d2) => {
        const h = d2[key] || [];
        messagesEl.innerHTML = "";
        if (h.length === 0) { addMessage("bot", WELCOME); return; }
        restoring = true;
        // 恢复界面显示（工具调用带详情）
        h.forEach((m) => addMessage(m.role, m.text, m.detail));
        // 同时恢复 llmMessages，让 LLM 能看到之前的聊天记录
        llmMessages = h
          .filter((m) => m.role === "user" || m.role === "bot")
          .map((m) => ({ role: m.role === "bot" ? "assistant" : "user", content: m.text }));
        restoring = false;
        scrollToEnd();
      });
    });
  } catch (e) { addMessage("bot", WELCOME); }
}
restoreHistory();
inputEl.focus();

/* 检查是不是从 navigate 跳过来的，是的话自动把 chatText 发给 LLM */
chrome.storage.local.get(["pending_nav_chat"], (d) => {
  const p = d && d.pending_nav_chat;
  if (p && p.text) {
    // 清空 pending
    chrome.storage.local.remove(["pending_nav_chat"]);
    // 延迟一点，等页面完全加载
    setTimeout(() => {
      inputEl.value = p.text;
      send();
    }, 500);
  }
});
