// LLM Float content script — 功能单元：agent.js（LLM agent 工具命令：page_* 操作当前网页）
// 所有命令均为 registerCommand 注册的独立命令，不依赖 eval 的 DOM 原语不受页面 CSP 限制。

/* 页面工具命令（agent LLM 模式：page_* 工具经此执行，操作当前网页） */
/* 生成稳定 CSS 选择器：优先 id/aria-label/data-*，否则 nth-child 路径 */
function genSelector(el) {
  if (!el || el.nodeType !== 1) return "";
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return "#" + el.id;
  const aria = el.getAttribute && el.getAttribute("aria-label");
  if (aria) return el.tagName.toLowerCase() + '[aria-label="' + aria.replace(/"/g, "\"") + '"]';
  for (const a of ["data-testid", "data-test", "data-role", "data-action"]) {
    const v = el.getAttribute && el.getAttribute(a);
    if (v) return el.tagName.toLowerCase() + "[" + a + '="' + v + '"]';
  }
  // nth-child 路径
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 5) {
    let part = cur.tagName.toLowerCase();
    const sibs = cur.parentNode ? Array.from(cur.parentNode.children).filter(c => c.tagName === cur.tagName) : [];
    if (sibs.length > 1) {
      part += ":nth-of-type(" + (sibs.indexOf(cur) + 1) + ")";
    }
    parts.unshift(part);
    cur = cur.parentNode;
  }
  return parts.join(" > ");
}

registerCommand("getPageInfo", () => {
  const t = ((document.body && document.body.innerText) || "").replace(/\s+/g, " ").trim();
  const interactive = [];
  let idx = 0;
  const els = document.querySelectorAll("button, input, select, textarea, a[href], [role=button], [role=textbox], [contenteditable=true], .ProseMirror");
  for (const el of els) {
    if (idx >= 50) break;
    const tag = el.tagName.toLowerCase();
    const type = el.type ? el.type : "";
    // 标签：innerText > aria-label > placeholder，避免把 value 当标签
    const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 50);
    // 值：input/select 的当前 value（密码框不显示明文）
    let val = "";
    if (tag === "input" || tag === "select" || tag === "textarea") {
      val = (type === "password") ? "***" : String(el.value || "").slice(0, 50);
    } else if (el.isContentEditable || el.classList.contains("ProseMirror")) {
      val = (el.innerText || el.textContent || "").trim().slice(0, 50);
    }
    const isLink = tag === "a" && el.href ? true : false;
    const isSubmit = (tag === "input" && (type === "submit" || type === "button")) || tag === "button" ? true : false;
    idx++;
    interactive.push({ index: idx, tag, type, label, val, isLink, isSubmit, selector: genSelector(el) });
  }
  return { ok: true, data: { url: location.href, title: document.title, text: t.slice(0, 1500), elements: interactive } };
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
    return { ok: true, action: "click", selector: genSelector(el), tag: el.tagName, text: (el.innerText || el.value || "").slice(0, 200),
      checked: el.checked != null ? !!el.checked : undefined,
      expanded: el.getAttribute ? el.getAttribute("aria-expanded") : undefined };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_set_input", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "");
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    if (el.disabled) return { ok: false, skipped: true, reason: "disabled" };
    if (el.readOnly) return { ok: false, skipped: true, reason: "readonly" };
    const val = String((p && p.value) || "");
    el.focus();

    const tag = el.tagName.toLowerCase();
    const isProseMirror = el.classList.contains("ProseMirror") || el.closest(".ProseMirror");
    const isContentEditable = el.isContentEditable || el.getAttribute("contenteditable") === "true";

    // 富文本编辑器（ProseMirror / contenteditable）
    if (isProseMirror || isContentEditable) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("insertText", false, val);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: val }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      const readBack = (el.innerText || el.textContent || "").slice(0, 100);
      return { ok: true, action: "set_input", selector: genSelector(el), tag: el.tagName, rich: isProseMirror ? "ProseMirror" : "contenteditable", readBack };
    }

    // 普通表单 input/textarea
    if (tag === "input" || tag === "textarea") {
      const realVal = val.replace(/\\n/g, "\n");
      el.value = realVal;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      const readBack = String(el.value || "").slice(0, 100);
      // 回读校验：如果回读和写入不一致，返回失败
      if (readBack !== realVal.slice(0, 100)) {
        return { ok: false, error: "写入后回读不一致", expected: realVal.slice(0, 100), readBack };
      }
      return { ok: true, action: "set_input", selector: genSelector(el), tag: el.tagName, value: realVal.slice(0, 100), readBack };
    }

    // 其他元素：不支持直接写入
    return { ok: false, error: "不支持的元素类型: " + tag + "（需 input/textarea 或 contenteditable）" };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_get_attr", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "");
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    const attr = (p && p.attr) || "value";
    const boolAttrs = ["checked", "disabled", "readonly", "required", "multiple", "autofocus", "selected"];
    if (boolAttrs.includes(attr.toLowerCase())) {
      return { ok: true, data: { attr, value: !!el[attr], type: "boolean" } };
    }
    const v = el[attr] != null ? el[attr] : el.getAttribute(attr);
    return { ok: true, data: { attr, value: v == null ? "" : String(v).slice(0, 2000) } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_scroll", (p) => {
  return new Promise((resolve) => {
    try {
      const sel = (p && p.selector) || "";
      const dir = (p && p.direction) || "bottom";
      const startTop = window.scrollY || document.documentElement.scrollTop;
      if (sel) {
        const el = document.querySelector(sel);
        if (!el) { resolve({ ok: false, error: "元素不存在: " + sel }); return; }
        el.scrollIntoView({ block: "center" });
      } else if (dir === "top") {
        window.scrollTo(0, 0);
      } else if (dir === "bottom") {
        window.scrollTo(0, document.documentElement.scrollHeight);
      } else {
        const by = dir === "up" ? -600 : 600;
        window.scrollBy({ top: by, behavior: "auto" });
      }
      // 等滚动稳定（最多 800ms）
      let stableCount = 0;
      let lastTop = -1;
      const check = setInterval(() => {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 10;
        const didScroll = Math.abs(scrollTop - startTop) > 5;
        if (Math.abs(scrollTop - lastTop) < 3) stableCount++;
        else stableCount = 0;
        lastTop = scrollTop;
        if (stableCount >= 2 || Date.now() - startTimer > 800) {
          clearInterval(check);
          window._prevScrollTop = scrollTop;
          const scrollPercent = scrollHeight > clientHeight ? Math.round(scrollTop / (scrollHeight - clientHeight) * 100) : 100;
          const scrollTopInt = Math.round(scrollTop);
          resolve({ ok: true, data: { scrolled: sel ? "element" : dir, scrollTop: scrollTopInt, scrollHeight, clientHeight, atBottom, didScroll, scrollPercent } });
        }
      }, 50);
      const startTimer = Date.now();
    } catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
  });
});
registerCommand("page_hover", (p) => {
  try {
    const el = document.querySelector((p && p.selector) || "");
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    return { ok: true, action: "hover", selector: genSelector(el), tag: el.tagName };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_wait", (p) => {
  let ms = parseInt((p && p.ms) || 0, 10) || 0;
  const clamped = ms < 0 || ms > 10000;
  ms = Math.min(10000, Math.max(0, ms));
  return new Promise((resolve) => setTimeout(() => resolve({ ok: true, data: { waited: ms, clamped } }), ms));
});
/* 键盘按键：在当前聚焦元素上按某个键（Enter/Tab/Escape 等） */
registerCommand("page_press_key", (p) => {
  try {
    const key = String((p && p.key) || "Enter");
    const sel = (p && p.selector) || "";
    let el;
    if (sel) {
      el = document.querySelector(sel);
      if (!el) return { ok: false, error: "元素不存在: " + sel };
      el.focus();
    } else {
      el = document.activeElement || document.body;
    }
    const opts = { key, code: key, which: key === "Enter" ? 13 : 0, keyCode: key === "Enter" ? 13 : 0, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
    let submitted = false;
    if (key === "Enter" && el.form) {
      try { el.form.requestSubmit(); submitted = true; } catch (e) { el.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); submitted = true; }
    }
    const active = document.activeElement;
    return { ok: true, action: "press_key", key, tag: el.tagName, selector: genSelector(el), submitted, activeTag: active ? active.tagName : "", activeSelector: active ? genSelector(active) : "" };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
/* 条件等待：等元素出现或消失 */
registerCommand("page_wait_for", (p) => {
  const selector = (p && p.selector) || "";
  const state = (p && p.state) || "visible";
  const timeout = Math.min(10000, Math.max(500, parseInt((p && p.timeout) || 3000, 10) || 3000));
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const el = selector ? document.querySelector(selector) : null;
      const visible = !!(el && el.offsetParent !== null);
      const ok = state === "visible" ? visible : !visible;
      if (ok || Date.now() - start > timeout) {
        clearInterval(timer);
        resolve({ ok: true, data: { selector, state, elapsed: Date.now() - start, matched: ok } });
      }
    }, 200);
  });
});

/* 只抓页面所有链接（省 token，比 getPageInfo 轻） */
registerCommand("page_get_links", () => {
  const seen = new Set();
  const links = [];
  const els = document.querySelectorAll("a[href]");
  for (const el of els) {
    if (links.length >= 50) break;
    const text = (el.innerText || el.textContent || "").trim().slice(0, 60);
    const href = el.getAttribute("href") || "";
    if (!text || !href || href.startsWith("javascript:")) continue;
    let absolute = href;
    try { absolute = new URL(href, location.href).href; } catch (e) {}
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    let isExternal = false;
    try { isExternal = new URL(absolute).hostname !== location.hostname; } catch (e) {}
    links.push({ text, href: href.slice(0, 200), absoluteHref: absolute.slice(0, 300), isExternal });
  }
  return { ok: true, data: { links } };
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
    return { ok: true, action: "select", selector: genSelector(el), value: matched.value, text: matched.text };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

/* 后台抓网页：转发到 background 发 fetch（background 不受 CORS 限制） */
registerCommand("web_fetch", async (p) => {
  try {
    const url = (p && p.url) || "";
    if (!/^https?:/i.test(url)) return { ok: false, category: "bad_url", error: "url 需以 http/https 开头" };
    const resp = await chrome.runtime.sendMessage({ type: "llm_web_fetch", url });
    if (!resp) return { ok: false, category: "background", error: "background 无响应" };
    if (!resp.ok) return { ok: false, category: resp.category || "unknown", error: resp.error };
    const maxChars = Math.min(20000, Math.max(500, parseInt(p && p.maxChars, 10) || 8000));
    const text = (resp.text || "").slice(0, maxChars);
    return { ok: true, data: { url, status: resp.status, contentType: resp.contentType, text, truncated: (resp.text || "").length > maxChars } };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { ok: false, category: "content", error: msg };
  }
});
