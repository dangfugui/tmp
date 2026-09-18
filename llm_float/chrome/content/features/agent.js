// LLM Float content script — 功能单元：agent.js（LLM agent 工具命令：page_* 操作当前网页）
// 所有命令均为 registerCommand 注册的独立命令，不依赖 eval 的 DOM 原语不受页面 CSP 限制。

/* 页面工具命令（agent LLM 模式：page_* 工具经此执行，操作当前网页） */
registerCommand("getPageInfo", () => {
  const t = ((document.body && document.body.innerText) || "").replace(/\s+/g, " ").trim();
  return { ok: true, data: { url: location.href, title: document.title, text: t.slice(0, 3000) } };
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
    const fn = new Function((p && p.code) || "");
    const r = fn();
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
    el.focus();
    el.value = String((p && p.value) || "");
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
