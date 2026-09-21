// LLM Float chat iframe — agent.js（LLM agent 工具：schema / 桥接 / fs 读写 / 授权目录）
// 由 chat.html 引入，先于 chat.js 加载；全局变量与 chat.js 共享。

const AGENT_TOOL_DEFS = [
  { type: "function", function: { name: "page_get_info", description: "【读网页】获取当前网页的 URL、标题与可见文本摘要。了解页面内容时优先用这个，不要用 page_exec_js", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "page_read", description: "【读网页】按 CSS 选择器读取当前网页某个元素的文本/HTML。读页面内容用这个，不要用 page_exec_js", parameters: { type: "object", properties: { selector: { type: "string", description: "CSS 选择器，如 #title、.content p" } }, required: ["selector"] } } },
  // 【已禁用】page_exec_js：CSP 严格页面用不了，避免走弯路
  // { type: "function", function: { name: "page_exec_js", description: "【操作网页】在当前网页执行一段 JavaScript（点击、填表单等动态操作）。注意：CSP 严格页面会被浏览器拒绝，此时请改用 page_read/page_get_info", parameters: { type: "object", properties: { code: { type: "string", description: "要执行的 JS 表达式或语句（return 的值会被 JSON 返回）" } }, required: ["code"] } } } },
  { type: "function", function: { name: "fs_read", description: "【读本地文件】读取已授权工作目录内的文本文件（路径相对工作目录）。优先用 startLine/endLine 按行读省 token；不传则按字符 offset/limit", parameters: { type: "object", properties: { path: { type: "string", description: "相对路径，如 src/main.py" }, startLine: { type: "number", description: "起始行号（1-based），与 endLine 配合按行读" }, endLine: { type: "number", description: "结束行号（1-based），不传则读到文件末尾" }, offset: { type: "number", description: "起始字符偏移（不传 startLine 时才用）" }, limit: { type: "number", description: "本次最多读取字符数（不传 startLine 时才用）" } }, required: ["path"] } } },
  { type: "function", function: { name: "fs_write", description: "【写本地文件】写入已授权工作目录内的文件（不存在则创建，注意是覆盖写入）", parameters: { type: "object", properties: { path: { type: "string", description: "相对路径" }, content: { type: "string", description: "文件内容" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "fs_find", description: "【找本地文件】在已授权工作目录内递归查找文件名匹配的文件（glob，如 *.py、data/*.json）", parameters: { type: "object", properties: { pattern: { type: "string", description: "文件名 glob 模式" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "page_click", description: "【点网页】点击当前网页某个元素（按钮/链接/输入框等）。帮用户点页面用这个，不受 CSP 限制", parameters: { type: "object", properties: { selector: { type: "string", description: "CSS 选择器，如 #submitBtn、a.login" } }, required: ["selector"] } } },
  { type: "function", function: { name: "page_set_input", description: "【填网页】给当前网页输入框/文本框填值并触发 input/change 事件。帮用户填表单用这个，不受 CSP 限制", parameters: { type: "object", properties: { selector: { type: "string", description: "CSS 选择器，如 #kw、textarea.content" }, value: { type: "string", description: "要填入的值" } }, required: ["selector", "value"] } } },
  { type: "function", function: { name: "page_get_attr", description: "【读网页属性】读取当前网页元素的属性或 value（如输入框当前值、链接 href）", parameters: { type: "object", properties: { selector: { type: "string", description: "CSS 选择器" }, attr: { type: "string", description: "属性名，默认 value（也可用 href、id、className 等）" } }, required: ["selector"] } } },
  { type: "function", function: { name: "navigate", description: "【切页面】当前标签页导航到新 URL（不切标签页，悬浮窗自动重新注入）。注意：这是最后一步——调用后页面会跳转，与当前页面的交互就结束了。可以传 chatText 参数，跳转后自动把这个文本发给新页面的 LLM 继续对话，这样交互就连起来了", parameters: { type: "object", properties: { url: { type: "string", description: "要导航到的完整 URL（http/https 开头）" }, chatText: { type: "string", description: "跳转后自动发给 LLM 的文本（可选，不传就不自动发）" } }, required: ["url"] } } },
  { type: "function", function: { name: "page_scroll", description: "【滚网页】滚动页面或元素（direction: top/bottom/up/down，不带 selector 滚整页）", parameters: { type: "object", properties: { selector: { type: "string", description: "要滚动到的元素 CSS 选择器（可选，不带则滚整页）" }, direction: { type: "string", description: "top/bottom/up/down，默认 bottom" } } } } },
  { type: "function", function: { name: "page_hover", description: "【悬停网页】鼠标悬停到元素上（触发下拉菜单/悬浮层）", parameters: { type: "object", properties: { selector: { type: "string", description: "CSS 选择器" } }, required: ["selector"] } } },
  { type: "function", function: { name: "page_wait", description: "【等待】等待若干毫秒（页面加载/动画/异步内容）", parameters: { type: "object", properties: { ms: { type: "number", description: "毫秒数，最大 10000" } }, required: ["ms"] } } },
  { type: "function", function: { name: "page_press_key", description: "【按键】在指定元素上按键盘键（Enter 提交搜索/表单、Tab 切焦点、Escape 关闭弹窗）。可传 selector 先聚焦到目标元素", parameters: { type: "object", properties: { key: { type: "string", description: "键名，如 Enter、Tab、Escape、ArrowDown" }, selector: { type: "string", description: "可选，先聚焦到该元素再按键" } }, required: ["key"] } } },
  { type: "function", function: { name: "page_get_links", description: "【读链接】只抓当前页面所有链接（文本+URL+是否外链），比 page_get_info 轻量。找链接用这个", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "page_wait_for", description: "【条件等待】等元素出现或消失（比固定毫秒稳，适合懒加载页面）", parameters: { type: "object", properties: { selector: { type: "string", description: "要等的元素选择器" }, state: { type: "string", description: "visible=等出现，hidden=等消失", enum: ["visible", "hidden"] }, timeout: { type: "number", description: "超时毫秒（默认3000）" } }, required: ["selector", "state"] } } },
  { type: "function", function: { name: "page_get_html", description: "【读网页 HTML】读取元素的 outerHTML（默认 body），最多 5000 字符", parameters: { type: "object", properties: { selector: { type: "string", description: "CSS 选择器，默认 body" } } } } },
  { type: "function", function: { name: "page_select", description: "【选下拉框】选择当前网页 select 下拉框的选项（优先按 option value 匹配，没匹配到按 option 文本匹配）", parameters: { type: "object", properties: { selector: { type: "string", description: "select 元素的 CSS 选择器" }, value: { type: "string", description: "要选的 option 的 value 或文本" } }, required: ["selector", "value"] } } },
  { type: "function", function: { name: "web_fetch", description: "【抓网页】后台 fetch 任意 URL，返回页面纯文本（后台跨域不受限）。查资料、读文档用。优先于 navigate（不影响当前页面）", parameters: { type: "object", properties: { url: { type: "string", description: "完整 URL" }, maxChars: { type: "number", description: "最多返回字符数（默认8000，最大20000）" } }, required: ["url"] } } },
  { type: "function", function: { name: "done", description: "【完成】任务完成后调用这个工具结束循环。text 是给用户的最终回复（简洁明了）。success 表示任务是否成功完成", parameters: { type: "object", properties: { text: { type: "string", description: "给用户的最终回复" }, success: { type: "boolean", description: "任务是否成功完成，默认 true" } }, required: ["text"] } } },
  { type: "function", function: { name: "ask_user", description: "【问用户】需要用户更多信息或遇到无法解决的问题（如验证码、登录）时，用这个工具问用户。可以提供 options 快捷选项", parameters: { type: "object", properties: { question: { type: "string", description: "要问用户的问题" }, options: { type: "array", items: { type: "string" }, description: "快捷选项按钮（可选，最多 4 个）" } }, required: ["question"] } } },
];

const AGENT_TOOLS = {
  page_get_info: async () => bridgeCmd("getPageInfo", {}),
  page_read: async (p) => bridgeCmd("querySelector", { selector: (p && p.selector) || "" }),
  // page_exec_js: async (p) => bridgeCmd("execJs", { code: (p && p.code) || "" }),  // 已禁用
  fs_read: async (p) => fsTool("read", p),
  fs_write: async (p) => fsTool("write", p),
  fs_find: async (p) => fsTool("find", p),
  page_click: async (p) => bridgeCmd("page_click", { selector: (p && p.selector) || "" }),
  page_set_input: async (p) => bridgeCmd("page_set_input", { selector: (p && p.selector) || "", value: (p && p.value) || "" }),
  page_get_attr: async (p) => bridgeCmd("page_get_attr", { selector: (p && p.selector) || "", attr: (p && p.attr) || "" }),
  navigate: async (p) => {
    const url = (p && p.url) || "";
    const chatText = (p && p.chatText) || "";
    try { window.assistant && window.assistant.flushState && window.assistant.flushState(); } catch (e) {}
    if (chatText) {
      // 防重入：如果 3 秒内已有相同 chatText 的 pending，不重复设置
      const existing = await chrome.storage.local.get(["pending_nav_chat"]);
      const prev = existing && existing.pending_nav_chat;
      if (prev && prev.text === chatText && Date.now() - (prev.ts || 0) < 3000) {
        // 跳过，已设置过
      } else {
        try { await chrome.storage.local.set({ pending_nav_chat: { text: chatText, ts: Date.now() } }); } catch (e) {}
      }
    }
    await new Promise((r) => setTimeout(r, 200));
    return bridgeCmd("navigate", { url });
  },
  page_scroll: async (p) => bridgeCmd("page_scroll", { selector: (p && p.selector) || "", direction: (p && p.direction) || "" }),
  page_hover: async (p) => bridgeCmd("page_hover", { selector: (p && p.selector) || "" }),
  page_wait: async (p) => bridgeCmd("page_wait", { ms: (p && p.ms) || 500 }),
  page_press_key: async (p) => bridgeCmd("page_press_key", { key: (p && p.key) || "Enter", selector: (p && p.selector) || "" }),
  page_get_links: async () => bridgeCmd("page_get_links", {}),
  page_wait_for: async (p) => bridgeCmd("page_wait_for", { selector: (p && p.selector) || "", state: (p && p.state) || "visible", timeout: (p && p.timeout) || 3000 }),
  page_get_html: async (p) => bridgeCmd("page_get_html", { selector: (p && p.selector) || "" }),
  page_select: async (p) => bridgeCmd("page_select", { selector: (p && p.selector) || "", value: (p && p.value) || "" }),
  web_fetch: async (p) => bridgeCmd("web_fetch", { url: (p && p.url) || "", maxChars: (p && p.maxChars) || 0 }),
  done: async (p) => ({ done: true, text: (p && p.text) || "", success: p ? (p.success !== false) : true }),
  ask_user: async (p) => new Promise((resolve) => {
    const q = (p && p.question) || "";
    const opts = (p && Array.isArray(p.options)) ? p.options.slice(0, 4) : [];
    window.assistant.onAskUser && window.assistant.onAskUser(q, opts, (ans) => resolve({ answer: ans }));
  }),
};

/* ---- 页面工具：经 background 转发到当前页 content 命令表 ---- */
function bridgeCmd(cmd, params) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "llm_bridge", cmd, params }, (resp) => {
        if (chrome.runtime.lastError) resolve({ error: "页面命令失败: " + chrome.runtime.lastError.message });
        else if (resp && resp.ok) {
          // 统一返回：data 字段优先，否则把整个 resp（除 ok/error）展开
          const { ok, error, ...rest } = resp;
          resolve(resp.data ? Object.assign({}, resp.data, rest) : rest);
        }
        else resolve({ error: (resp && resp.error) || "页面命令失败" });
      });
    } catch (e) { resolve({ error: String((e && e.message) || e) }); }
  });
}

/* ---- fs 工具：授权目录（File System Access，句柄存 IndexedDB，同 options 页共享） ---- */
const AGENT_IDB = "llm-float";
function idbGetHandle() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(AGENT_IDB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore("handles"); } catch (e) {} };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction("handles", "readonly");
          const get = tx.objectStore("handles").get("agent_workdir");
          get.onsuccess = () => resolve(get.result || null);
          get.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      };
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}

async function workdirHandle() {
  const h = await idbGetHandle();
  if (!h) { showFsAuthBanner(); return { error: "未授权工作目录", needAuth: true }; }
  const perm = await h.queryPermission({ mode: "readwrite" });
  if (perm !== "granted") { showFsAuthBanner(); return { error: "工作目录授权失效", needAuth: true }; }
  return { handle: h };
}

/* 未授权时弹出授权提示条（按钮点击 = 用户手势，showDirectoryPicker 必须在手势上下文） */
function idbSetHandle(handle) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(AGENT_IDB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore("handles"); } catch (e) {} };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction("handles", "readwrite");
          tx.objectStore("handles").put(handle, "agent_workdir");
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) { resolve(false); }
      };
      req.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

function showFsAuthBanner() {
  if (document.getElementById("fs-auth-banner")) return;
  const bar = document.createElement("div");
  bar.id = "fs-auth-banner";
  bar.style.cssText = "position:absolute;left:12px;right:12px;bottom:12px;padding:8px 12px;background:rgba(255,170,40,.96);color:#222;border-radius:8px;font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;z-index:999;box-shadow:0 2px 8px rgba(0,0,0,.25);font-family:inherit;";
  const txt = document.createElement("span");
  txt.textContent = "未授权工作目录，无法读写文件";
  const btn = document.createElement("button");
  btn.textContent = "点这里授权";
  btn.style.cssText = "padding:4px 10px;border:none;border-radius:6px;background:#222;color:#fff;cursor:pointer;font-size:12px;white-space:nowrap;";
  txt.textContent = "未授权工作目录，点击后在设置页选择文件夹";
  btn.textContent = "去授权";
  btn.addEventListener("click", async () => {
    // chat 是嵌入网页的跨源 iframe，showDirectoryPicker 受浏览器限制不可用 → 打开顶层设置页授权
    try {
      await chrome.runtime.sendMessage({ type: "llm_open_options" });
    } catch (e) { /* 忽略 */ }
    bar.remove(); // 引导完即收起，不遮挡输入区
  });
  bar.appendChild(txt);
  bar.appendChild(btn);
  document.body.appendChild(bar);
}

async function resolveFsPath(dir, rel, create) {
  const parts = String(rel || "").split(/[\\/]/).filter(Boolean);
  if (!parts.length) return { dir, name: "" };
  let cur = dir;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = await cur.getDirectoryHandle(parts[i], create ? { create: true } : {});
  }
  return { dir: cur, name: parts[parts.length - 1] };
}

function globToRe(s) {
  const esc = String(s || "").replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + esc.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
}

async function walkDir(dir, prefix, depth, out, re, max) {
  if (depth > 4 || out.length >= max) return;
  const skipDirs = new Set([".git", "node_modules", ".next", "dist", "build", ".cache"]);
  let entries = [];
  try { for await (const e of dir.entries()) entries.push(e); } catch (e) { return; }
  for (const [name, handle] of entries) {
    if (out.length >= max) break;
    if (handle.kind === "directory" && skipDirs.has(name)) continue;
    const rel = prefix ? prefix + "/" + name : name;
    if (handle.kind === "file") { if (re.test(name)) out.push(rel); }
    else { if (re.test(name)) out.push(rel + "/"); await walkDir(handle, rel, depth + 1, out, re, max); }
  }
}

async function fsTool(op, p) {
  const w = await workdirHandle();
  if (w.error) return { error: w.error };
  try {
    if (op === "read") {
      const { dir, name } = await resolveFsPath(w.handle, p && p.path);
      if (!name) return { error: "path 不能为空" };
      const fh = await dir.getFileHandle(name);
      const txt = await (await fh.getFile()).text();
      // 优先按行读（startLine/endLine，1-based），省 token
      const startLine = parseInt(p && p.startLine, 10);
      const endLine = parseInt(p && p.endLine, 10);
      if (startLine > 0 || endLine > 0) {
        const lines = txt.split("\n");
        const s = Math.max(1, startLine || 1);
        const e = Math.min(lines.length, endLine || lines.length);
        const seg = lines.slice(s - 1, e).join("\n");
        return { ok: true, content: seg, startLine: s, endLine: e, totalLines: lines.length, hasMore: e < lines.length };
      }
      // 否则按字符 offset/limit
      const offset = Math.max(0, parseInt(p && p.offset, 10) || 0);
      const limit = Math.min(50000, Math.max(1000, parseInt(p && p.limit, 10) || 5000));
      const seg = txt.slice(offset, offset + limit);
      return { ok: true, content: seg, offset, total: txt.length, hasMore: offset + limit < txt.length };
    }
    if (op === "write") {
      const { dir, name } = await resolveFsPath(w.handle, p && p.path, true);
      if (!name) return { error: "path 不能为空" };
      const fh = await dir.getFileHandle(name, { create: true });
      const wr = await fh.createWritable();
      await wr.write(String(p && p.content == null ? "" : p.content));
      await wr.close();
      return { ok: true, written: String((p && p.content) || "").length };
    }
    if (op === "find") {
      const out = [];
      const re = globToRe(p && p.pattern);
      await walkDir(w.handle, "", 0, out, re, 100);
      return { ok: true, matches: out.slice(0, 100) };
    }
    return { error: "未知 fs 操作" };
  } catch (e) {
    return { error: "fs_" + op + " 失败: " + String((e && e.message) || e) };
  }
}
