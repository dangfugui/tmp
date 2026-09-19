// LLM Float content script — 功能单元：agent.js（LLM agent 工具命令：page_* 操作当前网页）
// 所有命令均为 registerCommand 注册的独立命令，不依赖 eval 的 DOM 原语不受页面 CSP 限制。

/* 页面工具命令（agent LLM 模式：page_* 工具经此执行，操作当前网页） */
registerCommand("getPageInfo", () => {
  const t = ((document.body && document.body.innerText) || "").replace(/\s+/g, " ").trim();
  // 提取可交互元素（带 index）
  const interactive = [];
  let idx = 0;
  const els = document.querySelectorAll("button, input, select, textarea, a[href], [role=button]");
  for (const el of els) {
    if (idx >= 30) break; // 最多 30 个，省 token
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 50);
    if (!text) continue;
    idx++;
    interactive.push({ index: idx, tag, text });
  }
  return { ok: true, data: { url: location.href, title: document.title, text: t.slice(0, 2000), elements: interactive } };
});
registerCommand("querySelector", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "");
    if (!el) return { ok: true, data: { found: false } };
    const txt = (el.innerText || el.textContent || "").trim().slice(0, 3000);
    return { ok: true, data: { found: true, text: txt, html: el.outerHTML.slice(0, 2000) } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("execJs", (p) => {
  try {
    const code = (p && p.code) || "";
    // 支持 async/await 和返回 Promise
    const fn = new Function("return (" + code + ")");
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then((v) => ({ ok: true, data: { result: JSON.stringify(v) } }))
             .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    }
    return { ok: true, data: { result: JSON.stringify(r) } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
/* DOM 操作原语（不依赖 eval，不受页面 CSP 限制：点击 / 填表单 / 读属性） */
registerCommand("page_click", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "");
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    el.scrollIntoView({ block: "center" });
    el.click();
    return { ok: true, data: { clicked: true, tag: el.tagName, text: (el.innerText || el.value || "").slice(0, 200) } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_set_input", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "");
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    const val = String((p && p.value) || "");
    el.focus();

    // ProseMirror 富文本编辑器支持
    const isProseMirror = el.classList.contains("ProseMirror") || el.closest(".ProseMirror");
    if (isProseMirror) {
      // 先清空内容
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      // 用 execCommand 注入文本
      document.execCommand("insertText", false, val);
      return { ok: true, data: { set: true, tag: el.tagName, rich: "ProseMirror" } };
    }

    // 普通 input/textarea
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, data: { set: true, tag: el.tagName } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_get_attr", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "");
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    const attr = (p && p.attr) || "value";
    const v = el[attr] != null ? el[attr] : el.getAttribute(attr);
    return { ok: true, data: { attr, value: v == null ? "" : String(v).slice(0, 2000) } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_scroll", (p) => {
  try {
    const sel = (p && p.selector) || "";
    const dir = (p && p.direction) || "bottom";
    if (sel) {
      const el = document.querySelector(sel);
      if (!el) return { ok: false, error: "元素不存在: " + sel };
      el.scrollIntoView({ block: dir === "top" ? "start" : "center" });
    } else {
      const by = dir === "top" ? 0 : dir === "up" ? -600 : dir === "down" ? 600 : document.body.scrollHeight;
      window.scrollBy({ top: by, behavior: "smooth" });
    }
    return { ok: true, data: { scrolled: dir } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_hover", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "");
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    return { ok: true, data: { hovered: true } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_wait", (p) => {
  const ms = Math.min(10000, Math.max(0, parseInt((p && p.ms) || 500, 10) || 500));
  return new Promise((resolve) => setTimeout(() => resolve({ ok: true, data: { waited: ms } }), ms));
});
registerCommand("page_get_html", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "body");
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    return { ok: true, data: { html: (el.outerHTML || "").slice(0, 5000) } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_select", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "");
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    if (el.tagName !== "SELECT") return { ok: false, error: "不是 select 元素: " + (p && p.selector) };
    const want = String((p && p.value) || "");
    let matched = Array.from(el.options).find((o) => o.value === want);
    if (!matched) matched = Array.from(el.options).find((o) => o.text.trim() === want);
    if (!matched) return { ok: false, error: "选项不存在: " + want };
    el.value = matched.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, data: { selected: matched.value, text: matched.text } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

/* 后台抓网页：从 content script 发起，自动带当前页面的 cookie 和登录信息 */
registerCommand("web_fetch", async (p) => {
  try {
    const url = (p && p.url) || "";
    if (!/^https?:/i.test(url)) return { ok: false, error: "url 需以 http/https 开头" };
    const resp = await fetch(url, { credentials: "include", redirect: "follow" });
    const ct = resp.headers.get("content-type") || "";
    if (!/text|html|json|xml/i.test(ct)) {
      return { ok: true, data: { url, status: resp.status, contentType: ct, text: "(非文本内容)" } };
    }
    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
    return { ok: true, data: { url, status: resp.status, contentType: ct, text } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
