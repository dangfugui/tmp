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

/* 统一元素定位：querySelectorAll + index 参数，返回 {el, matched, idx, all} */
function pickEl(p) {
  const sel = (p && p.selector) || "";
  let idx = 0;
  if (p && p.index !== undefined && p.index !== null && p.index !== "") {
    idx = parseInt(p.index, 10) || 0;
  }
  const all = Array.from(document.querySelectorAll(sel));
  const matched = all.length;
  const el = all[idx] || null;
  return { el, matched, idx, all };
}

/* 候选列表：给 LLM 看清命中多个时的元素（最多 5 个） */
function briefCandidates(all, limit) {
  const n = Math.min(limit || 5, all.length);
  const arr = [];
  for (let i = 0; i < n; i++) {
    const e = all[i];
    arr.push({
      index: i,
      tag: e.tagName ? e.tagName.toLowerCase() : "",
      text: (e.innerText || e.value || (e.getAttribute && e.getAttribute("aria-label")) || "").toString().trim().slice(0, 60),
      selector: genSelector(e)
    });
  }
  if (all.length > n) arr.push({ more: all.length - n });
  return arr;
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
    const { el, matched } = pickEl(p);
    if (!el) return { ok: true, data: { found: false, matched: 0 } };
    if (matched > 1) {
      // 命中多个：返回所有匹配的文本列表
      const results = [];
      const all = document.querySelectorAll((p && p.selector) || "");
      for (let i = 0; i < Math.min(20, all.length); i++) {
        const e = all[i];
        results.push({ index: i, selector: genSelector(e), text: (e.innerText || e.textContent || "").trim().slice(0, 800) });
      }
      return { ok: true, data: { found: true, matched, results } };
    }
    const txt = (el.innerText || el.textContent || "").trim().slice(0, 3000);
    return { ok: true, data: { found: true, matched: 1, text: txt, html: el.outerHTML.slice(0, 2000) } };
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
    const { el, matched, all } = pickEl(p);
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    if (matched > 1 && !(p && p.index !== undefined && p.index !== null && p.index !== "")) {
      return { ok: false, ambiguous: true, matched, candidates: briefCandidates(all), hint: "选择器命中多个，请传 index 或用候选里的精确 selector" };
    }
    el.scrollIntoView({ block: "center" });
    el.click();
    return { ok: true, action: "click", selector: genSelector(el), tag: el.tagName, matched, index: (p && p.index !== undefined ? parseInt(p.index, 10) : 0), text: (el.innerText || el.value || "").slice(0, 200),
      checked: el.checked != null ? !!el.checked : undefined,
      expanded: el.getAttribute ? el.getAttribute("aria-expanded") : undefined };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_set_input", (p) => {
  try {
    const { el, matched, all } = pickEl(p);
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    if (matched > 1 && !(p && p.index !== undefined && p.index !== null && p.index !== "")) {
      return { ok: false, ambiguous: true, matched, candidates: briefCandidates(all), hint: "选择器命中多个，请传 index 或用候选里的精确 selector" };
    }
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
    const { el, matched } = pickEl(p);
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    const attr = (p && p.attr) || "value";
    const boolAttrs = ["checked", "disabled", "readonly", "required", "multiple", "autofocus", "selected"];
    const readVal = (e) => {
      if (boolAttrs.includes(attr.toLowerCase())) return { attr, value: !!e[attr], type: "boolean" };
      const v = e[attr] != null ? e[attr] : e.getAttribute(attr);
      return { attr, value: v == null ? "" : String(v).slice(0, 2000) };
    };
    if (matched > 1) {
      const results = [];
      const all = document.querySelectorAll((p && p.selector) || "");
      for (let i = 0; i < Math.min(20, all.length); i++) {
        results.push({ index: i, selector: genSelector(all[i]), ...readVal(all[i]) });
      }
      return { ok: true, data: { matched, results } };
    }
    return { ok: true, data: { matched: 1, ...readVal(el) } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_scroll", (p) => {
  return new Promise((resolve) => {
    try {
      const sel = (p && p.selector) || "";
      const dir = (p && p.direction) || "bottom";
      const startTop = window.scrollY || document.documentElement.scrollTop;
      if (sel) {
        const { el, matched, all } = pickEl(p);
        if (!el) { resolve({ ok: false, error: "元素不存在: " + sel }); return; }
        if (matched > 1 && !(p && p.index !== undefined && p.index !== null && p.index !== "")) {
          resolve({ ok: false, ambiguous: true, matched, candidates: briefCandidates(all), hint: "选择器命中多个，请传 index 或用候选里的精确 selector" }); return;
        }
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
    const { el, matched, all } = pickEl(p);
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    if (matched > 1 && !(p && p.index !== undefined && p.index !== null && p.index !== "")) {
      return { ok: false, ambiguous: true, matched, candidates: briefCandidates(all), hint: "选择器命中多个，请传 index 或用候选里的精确 selector" };
    }
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    return { ok: true, action: "hover", selector: genSelector(el), tag: el.tagName, matched };
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
    let el, matched = 1;
    if (sel) {
      const pk = pickEl(p);
      el = pk.el;
      matched = pk.matched;
      if (!el) return { ok: false, error: "元素不存在: " + sel };
      if (matched > 1 && !(p && p.index !== undefined && p.index !== null && p.index !== "")) {
        return { ok: false, ambiguous: true, matched, candidates: briefCandidates(pk.all), hint: "选择器命中多个，请传 index 或用候选里的精确 selector" };
      }
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
    const sel = (p && p.selector) || "body";
    const { el, matched } = pickEl(Object.assign({}, p, { selector: sel }));
    if (!el) return { ok: false, error: "元素不存在: " + sel };
    if (matched > 1) {
      const results = [];
      const all = document.querySelectorAll(sel);
      for (let i = 0; i < Math.min(20, all.length); i++) {
        results.push({ index: i, selector: genSelector(all[i]), html: (all[i].outerHTML || "").slice(0, 1000) });
      }
      return { ok: true, data: { matched, results } };
    }
    return { ok: true, data: { matched: 1, html: (el.outerHTML || "").slice(0, 5000) } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
registerCommand("page_get_dom", (p) => {
  try {
    const sel = (p && p.selector) || "body";
    const maxDepth = Math.min(10, Math.max(1, parseInt((p && p.maxDepth) || 5, 10) || 5));
    const maxNodes = Math.min(500, Math.max(10, parseInt((p && p.maxNodes) || 200, 10) || 200));
    const all = Array.from(document.querySelectorAll(sel));
    if (!all.length) return { ok: false, error: "元素不存在: " + sel };
    const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "path", "link", "meta", "head", "title"]);
    let count = 0;
    function describe(el, depth) {
      if (count >= maxNodes || depth > maxDepth) return null;
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (!tag || SKIP_TAGS.has(tag)) return null;
      count++;
      const node = { tag, selector: genSelector(el) };
      if (el.id) node.id = el.id;
      if (el.className && typeof el.className === "string") {
        const cls = el.className.split(/\s+/).filter(Boolean).slice(0, 5);
        if (cls.length) node.class = cls.join(".");
      }
      if (tag === "a" && el.href) node.href = el.href.slice(0, 200);
      if (tag === "input") {
        node.type = el.type || "text";
        if (el.placeholder) node.placeholder = el.placeholder.slice(0, 50);
      }
      if (el.getAttribute && el.getAttribute("aria-label")) node.aria = el.getAttribute("aria-label").slice(0, 60);
      if (el.getAttribute && el.getAttribute("role")) node.role = el.getAttribute("role");
      if (el.getAttribute && el.getAttribute("data-testid")) node.testid = el.getAttribute("data-testid");
      // 直接文本子节点（不重复算后代）
      const directText = (el.childNodes && Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(" ") || "").trim();
      if (directText) node.text = directText.slice(0, 80);
      else if (!el.children || !el.children.length) {
        const t = (el.textContent || "").trim();
        if (t) node.text = t.slice(0, 80);
      }
      if (el.children && el.children.length && depth < maxDepth) {
        const kids = [];
        for (const child of el.children) {
          const d = describe(child, depth + 1);
          if (d) kids.push(d);
        }
        if (kids.length) node.children = kids;
      }
      return node;
    }
    // 命中多个：返回所有匹配的树列表，共用 maxNodes 全局上限
    const results = [];
    for (const el of all) {
      if (count >= maxNodes) break;
      const t = describe(el, 0);
      if (t) results.push(t);
    }
    return { ok: true, data: { root: sel, matched: all.length, nodes: count, truncated: count >= maxNodes, results } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

registerCommand("page_select", (p) => {
  try {
    const { el, matched, all } = pickEl(p);
    if (!el) return { ok: false, error: "元素不存在: " + (p && p.selector) };
    if (matched > 1 && !(p && p.index !== undefined && p.index !== null && p.index !== "")) {
      return { ok: false, ambiguous: true, matched, candidates: briefCandidates(all), hint: "选择器命中多个，请传 index 或用候选里的精确 selector" };
    }
    if (el.tagName !== "SELECT") return { ok: false, error: "不是 select 元素: " + (p && p.selector) };
    const want = String((p && p.value) || "");
    let opt = Array.from(el.options).find((o) => o.value === want);
    if (!opt) opt = Array.from(el.options).find((o) => o.text.trim() === want);
    if (!opt) return { ok: false, error: "选项不存在: " + want };
    el.value = opt.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, action: "select", selector: genSelector(el), matched: matched, value: opt.value, text: opt.text };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

/* 后台抓网页：转发到 background 发 fetch（background 不受 CORS 限制） */
registerCommand("web_fetch", async (p) => {
  try {
    const url = (p && p.url) || "";
    if (!/^https?:/i.test(url)) return { ok: false, category: "bad_url", error: "url 需以 http/https 开头" };
    const resp = await chrome.runtime.sendMessage({ type: "llm_web_fetch", url, render: !!(p && p.render) });
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
