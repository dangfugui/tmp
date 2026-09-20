// LLM Float background
// 职责：URL 匹配聊天配置、全局配置读写、消息路由（悬浮助手开关、TTS/ASR demo、options 打开、配置广播）
let DEFAULTS = {};

// 从 data/default-config.json 加载默认配置
async function loadDefaults() {
  try {
    const resp = await fetch(chrome.runtime.getURL("data/default-config.json"));
    DEFAULTS = await resp.json();
  } catch (e) {
    // 加载失败用兜底
    DEFAULTS = { theme: "flat", orb_size: 68, orb_opacity: 1.0, orb_enabled: true, chat_profiles: [] };
  }
}

async function ensureDefaults() {
  await loadDefaults();
  try {
    const got = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const patch = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (got[k] === undefined) patch[k] = DEFAULTS[k];
    }
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  } catch (e) { /* ignore */ }
}

/* 按浏览器网址匹配聊天配置（与原项目规则一致：第一条兜底，从第二条起匹配） */
function matchProfile(url, profiles) {
  if (!Array.isArray(profiles) || !profiles.length) return null;
  const def = profiles[0];
  for (let i = 1; i < profiles.length; i++) {
    const p = profiles[i] || {};
    if (!p.urlRegex) continue;
    try {
      if (new RegExp(p.urlRegex).test(url || "")) return p;
    } catch (e) { /* 非法正则，跳过 */ }
  }
  return def;
}

async function getTabUrl(tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    return t.url || "";
  } catch (e) {
    return "";
  }
}

/* 活动标签变化 → 匹配配置 → 存 active_profile_name → 通知该 tab 的聊天窗 */
/* 安全地向 tab 发送消息：只发可注入页面（http/https），并消费 lastError 避免 Unchecked 报错 */
function safeTabSend(tab, msg) {
  if (!tab || tab.id == null) return;
  if (tab.url && !/^https?:/i.test(tab.url)) return;
  try { chrome.tabs.sendMessage(tab.id, msg, () => { void chrome.runtime.lastError; }); } catch (e) { /* 忽略 */ }
}

async function refreshActiveProfile(tabId) {
  const url = tabId != null ? await getTabUrl(tabId) : await (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab && tab.url ? tab.url : "";
    } catch (e) { return ""; }
  })();
  const got = await chrome.storage.local.get("chat_profiles");
  const profile = matchProfile(url, got.chat_profiles || []);
  const name = profile ? profile.chatName : "";
  await chrome.storage.local.set({ active_profile_name: name });
  if (tabId != null && /^https?:/i.test(url)) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "llm_active_profile", name });
    } catch (e) { /* content script 尚未注入 */ }
  }
  return profile;
}

chrome.runtime.onInstalled.addListener(() => { ensureDefaults(); refreshActiveProfile(); });
chrome.runtime.onStartup.addListener(() => { ensureDefaults(); refreshActiveProfile(); });

chrome.tabs.onActivated.addListener(({ tabId }) => { refreshActiveProfile(tabId); });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) refreshActiveProfile(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;
  switch (msg.type) {
    case "llm_init": {
      // content script 注入后拉取全局配置（async 响应）
      (async () => {
        const got = await chrome.storage.local.get(["theme", "orb_size", "orb_opacity", "orb_enabled", "chat_profiles", "active_profile_name", "orb_action_left", "orb_action_right", "orb_action_wheel"]);
        sendResponse({ ok: true, data: got });
      })();
      return true;
    }
    case "llm_toggle_enabled": {
      // 工具栏 popup「开关本插件」：翻转总开关并广播到所有页面
      chrome.storage.local.get("orb_enabled", (d) => {
        const cur = d.orb_enabled !== false; // 未初始化按默认开启
        const enabled = !cur;
        chrome.storage.local.set({ orb_enabled: enabled }, () => {
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((t) => safeTabSend(t, { type: "llm_set_orb_enabled", enabled }));
            sendResponse({ ok: true, enabled });
          });
        });
      });
      return true;
    }
    case "llm_open_options":
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      break;
    case "llm_manual_profile": {
      // 用户在下拉框手动切换聊天配置
      chrome.storage.local.set({ active_profile_name: msg.name || "" }, () => sendResponse({ ok: true }));
      return true;
    }
    case "llm_config_updated": {
      // 设置页保存后：广播到所有页面（content 重拉配置）
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((t) => safeTabSend(t, { type: "llm_config_updated" }));
        sendResponse({ ok: true });
      });
      return true;
    }
    case "llm_demo": {
      // 工具栏 popup / 设置页 TTS、ASR demo：在【当前活动页面】显示字幕气泡执行
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        safeTabSend(tabs && tabs[0], { type: "llm_demo", demo: msg.demo || "tts" });
        sendResponse({ ok: true });
      });
      return true;
    }
    case "llm_open_chat": {
      // 工具栏 popup：在【当前活动页面】打开聊天窗口
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        safeTabSend(tabs && tabs[0], { type: "open_chat" });
        sendResponse({ ok: true });
      });
      return true;
    }
    case "llm_bridge": {
      // chat iframe 的 LLM agent 工具命令（page_* 等）：转发到当前活动页 content（main.js llm_bridge → callCommand）
      (async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];
        if (!tab || !/^https?:/i.test(tab.url || "")) {
          sendResponse({ ok: false, error: "no http(s) target tab" });
          return;
        }
        if (msg.cmd === "execJs") {
          // chrome.scripting 在隔离世界执行；func 内部 try/catch，无论 eval 成功或被页面 CSP 拦截都明确返回
          try {
            const out = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              args: [(msg.params && msg.params.code) || ""],
              func: (codeStr) => {
                try {
                  const v = (0, eval)(codeStr);
                  if (v === undefined || v === null) return { ok: true, value: String(v) };
                  try { return { ok: true, value: JSON.parse(JSON.stringify(v)) }; }
                  catch (e2) { return { ok: true, value: String(v) }; }
                } catch (e) {
                  const msg = String((e && e.message) || e);
                  const csp = /Content Security Policy|unsafe-eval|eval.*is not allowed|Refused to evaluate/i.test(msg);
                  return { ok: false, error: csp
                    ? "该页面 CSP 禁止执行动态 JS（unsafe-eval 被禁用）。请改用 page_read / page_get_info 等不依赖 eval 的工具"
                    : "execJs 运行错误: " + msg };
                }
              }
            });
            const r = out && out[0] && out[0].result;
            if (!r) { sendResponse({ ok: false, error: "execJs 未返回结果" }); return; }
            if (r.ok) sendResponse({ ok: true, data: { result: r.value } });
            else sendResponse({ ok: false, error: r.error });
          } catch (e) {
            sendResponse({ ok: false, error: "execJs 注入失败: " + String((e && e.message) || e) });
          }
          return;
        }
        if (msg.cmd === "navigate") {
          // 当前标签页导航到新 URL（不切标签页，悬浮窗自动重新注入）
          try {
            const url = (msg.params && msg.params.url) || "";
            if (!/^https?:/i.test(url)) { sendResponse({ ok: false, error: "url 需以 http/https 开头" }); return; }
            // navigate 前记住当前 profile，新页面沿用同一 agent（不根据新 URL 切换）
            try {
              const got = await chrome.storage.local.get(["active_profile_name", "chat_open"]);
              await chrome.storage.local.set({
                navigate_keep_profile: got.active_profile_name || "",
                navigate_keep_chat: !!got.chat_open
              });
            } catch (e) {}
            await chrome.tabs.update(tab.id, { url });
            sendResponse({ ok: true, data: { navigated: url } });
          } catch (e) {
            sendResponse({ ok: false, error: "navigate 失败: " + String((e && e.message) || e) });
          }
          return;
        }
        // web_fetch 现在在 content script 里执行（自动带当前页面 cookie）
        chrome.tabs.sendMessage(tab.id, { type: "llm_bridge", cmd: msg.cmd, params: msg.params || {} }, (resp) => {
          sendResponse(resp || { ok: false, error: "content no response" });
        });
      })();
      return true;
    }
    case "llm_bridge_event": {
      // iframe / content → Python：事件上行（转发到本地 WS 桥）
      bridgeSend({ event: msg.name, data: msg.payload });
      sendResponse({ ok: true });
      return true;
    }
    case "llm_tts_ws": {
      // WS 流式 TTS：background 建连收 PCM（不受页面 Mixed Content 限制）
      bgTtsWs(msg, sendResponse);
      return true;
    }
    case "llm_tts_ws_stop": {
      bgCloseTtsSocket();
      sendResponse({ ok: true });
      break;
    }
    case "llm_tts_http": {
      // HTTP 非流式 TTS：POST /v1/audio/speech → 完整音频（base64 回传，避免 sendMessage ArrayBuffer 损坏）
      console.log("[tts-bg] >>> POST", msg.url, JSON.stringify(msg.headers || {}), JSON.stringify(msg.body || {}).slice(0, 500));
      fetch(msg.url, { method: "POST", headers: msg.headers || {}, body: JSON.stringify(msg.body || {}) })
        .then((r) => {
          console.log("[tts-bg] <<< Status:", r.status, r.statusText, JSON.stringify(Object.fromEntries([...r.headers.entries()])));
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.arrayBuffer();
        })
        .then((buf) => {
          // 转 base64 避免 sendMessage 损坏（content 已打印 size 信息）
          const bytes = new Uint8Array(buf);
          let bin = "";
          for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          const b64 = btoa(bin);
          sendResponse({ ok: true, dataB64: b64, format: (msg.body && msg.body.response_format) || "pcm" });
        })
        .catch((e) => {
          console.error("[tts-bg] XXX 失败:", e.message);
          sendResponse({ ok: false, error: String(e) });
        });
      return true;
    }
    case "llm_asr": {

      // ASR 非流式：POST /v1/audio/transcriptions（multipart）
      // 通过 base64 接收音频（避免 sendMessage ArrayBuffer 结构化克隆损坏）
      (async () => {
        try {
          const bin = atob(msg.audioB64);
          const buf = new ArrayBuffer(bin.length);
          const view = new Uint8Array(buf);
          for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
          const blob = new Blob([buf]);
          const form = new FormData();
          form.append("file", blob, "record.wav");
          form.append("model", msg.model || "qwen3-asr");
          const fetchOpts = { method: "POST", body: form };
          if (msg.headers && Object.keys(msg.headers).length > 0) fetchOpts.headers = msg.headers;
          const resp = await fetch(msg.url, fetchOpts);
          const raw = await resp.text();
          if (!resp.ok) { sendResponse({ ok: false, error: "HTTP " + resp.status + " body=" + raw.slice(0, 200) }); return; }
          let d; try { d = JSON.parse(raw); } catch (e) { sendResponse({ ok: false, error: "JSON parse: " + raw.slice(0, 200) }); return; }
          sendResponse({ ok: true, text: (d && d.text) || "" });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true;
    }
    default:
      sendResponse({ ok: false, error: "unknown message: " + msg.type });
      return true;
  }
});

/* ============================================================
   媒体请求代理（content → background）：
   页面 Mixed Content 限制（HTTPS 页面不能请求 http 内网），
   统一挪到 background 扩展特权网络层执行（host_permissions <all_urls>）
   ============================================================ */
let bgTtsSocket = null;
let bgTtsChunks = [];

function bgCloseTtsSocket() {
  if (bgTtsSocket) {
    try { bgTtsSocket.onclose = null; bgTtsSocket.close(); } catch (e) { /* 忽略 */ }
    bgTtsSocket = null;
  }
  bgTtsChunks = [];
}

/* WS 流式 TTS：建会话收 PCM，合成完成事件后合并回传（ArrayBuffer 经消息回 content 播放） */
function bgTtsWs(msg, cb) {
  bgCloseTtsSocket();
  bgTtsChunks = [];
  let socket;
  try { socket = new WebSocket(msg.url); } catch (e) { cb({ ok: false, error: String(e) }); return; }
  socket.binaryType = "arraybuffer";
  bgTtsSocket = socket;
  let done = false;
  const finish = (res) => {
    try { socket.close(); } catch (e) { /* 忽略 */ }
    if (bgTtsSocket === socket) bgTtsSocket = null;
    cb(res);
  };
  const timeout = setTimeout(() => { if (!done) finish({ ok: false, error: "timeout" }); }, 40000);
  socket.onopen = () => {
    try {
      socket.send(JSON.stringify(msg.config || { type: "session.config" }));
      socket.send(JSON.stringify({ type: "input.text", text: String(msg.text || "") }));
      socket.send(JSON.stringify({ type: "input.done" }));
    } catch (e) { /* 忽略 */ }
  };
  socket.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      let tm = "";
      try { tm = JSON.parse(ev.data).type || ""; } catch (e) { /* 忽略 */ }
      if (tm && /done|complete|finished/i.test(tm)) {
        done = true;
        clearTimeout(timeout);
        const total = bgTtsChunks.reduce((n, c) => n + c.byteLength, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of bgTtsChunks) { merged.set(new Uint8Array(c), off); off += c.byteLength; }
        bgTtsChunks = [];
        finish({ ok: true, pcm: merged.buffer });
      }
      return;
    }
    if (ev.data instanceof ArrayBuffer) bgTtsChunks.push(ev.data);
  };
  socket.onerror = () => { /* onclose 兜底 */ };
  socket.onclose = () => {
    clearTimeout(timeout);
    if (!done) finish({ ok: false, error: "ws closed" });
  };
}

/* ============================================================
   Python 桥（可选）：background 连 Python SDK 的本地 WebSocket 服务
   - 命令（Python → 扩展）走 bridgeRoute，目标 tab 默认活动页，可用 params.tabId 指定
   - 事件（扩展 → Python）走 llm_bridge_event → bridgeSend
   - Python 不在时：扩展完全自足，仅定时尝试重连
   ============================================================ */
const PY_BRIDGE_URL = "ws://127.0.0.1:7860/bridge";
const BRIDGE_RETRY_BASE_MS = 3000;   // 重连退避基数
const BRIDGE_RETRY_MAX_MS = 5000;   // 重连退避上限：保证 SDK 重启后数秒内自动连上（失败日志仅提示一次，不刷屏）
let pyWs = null;
let bridgeReconnectTimer = null;
let bridgeFailCount = 0;             // 连续失败次数（成功连接时归零）

function bridgeSend(obj) {
  try { if (pyWs && pyWs.readyState === 1) pyWs.send(JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
}

function bridgeFail() {
  // Python SDK 未启动属预期（纯插件模式）：首次提示一次，之后静默退避
  if (bridgeFailCount === 0) console.log("[bridge] Python SDK 未启动（纯插件模式），后台退避重连中");
  bridgeFailCount++;
}
function bridgeScheduleReconnect() {
  if (bridgeReconnectTimer) return;
  const delay = Math.min(BRIDGE_RETRY_BASE_MS * Math.pow(2, bridgeFailCount), BRIDGE_RETRY_MAX_MS);
  bridgeReconnectTimer = setTimeout(() => { bridgeReconnectTimer = null; bridgeConnect(); }, delay);
}

function bridgeConnect() {
  try { if (pyWs) { pyWs.onclose = null; try { pyWs.close(); } catch (e) {} } } catch (e) { /* 忽略 */ }
  try {
    pyWs = new WebSocket(PY_BRIDGE_URL);
  } catch (e) { pyWs = null; bridgeFail(); bridgeScheduleReconnect(); return; }
  pyWs.onopen = () => { bridgeFailCount = 0; console.log("[bridge] 已连接 Python SDK"); };
  pyWs.onclose = () => { pyWs = null; bridgeFail(); bridgeScheduleReconnect(); };
  pyWs.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m && typeof m.cmd === "string") bridgeRoute(m);
  };
}

/* 确保 content script 已注入：未注入则用 chrome.scripting 动态注入（css + js）。
   扩展重载后旧页面无新脚本，SDK 命令直接操作会报 Receiving end does not exist。 */
async function ensureInjected(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "llm_bridge", cmd: "ping" });
    return true;
  } catch (e) { /* 未注入，尝试注入 */ }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content/content.css"] });
    for (const f of ["content/core.js", "content/features/chat.js", "content/features/tts.js", "content/features/asr.js", "content/main.js"]) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [f] });
    }
    return true;
  } catch (e) {
    return false;
  }
}

/* 目标 tab：params.tabId 指定，缺省活动页；只发可注入页面（http/https） */
async function targetTabs(params) {
  const tabId = params && params.tabId;
  if (tabId != null) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t && /^https?:/i.test(t.url || "")) return [t];
    } catch (e) { /* tabId 失效，兜底用活动 tab */ }
  }
  // 兜底：tabId 无效或未指定时，用当前活动 tab
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  return active.filter(t => /^https?:/i.test(t.url || ""));
}

/* 命令路由（cmd 名 = JS 函数名 / SDK 命令名，见 PYTHON-SDK.md §3.1） */
async function bridgeRoute(m) {
  const send = (ok, data, error) => bridgeSend({ id: m.id, ok, data, error });
  const params = m.params || {};
  switch (m.cmd) {
    case "ping":
      send(true, {});
      break;
    case "getTabs": {
      try {
        const tabs = await chrome.tabs.query({});
        send(true, tabs
          .filter((t) => t.id != null && /^https?:/i.test(t.url || ""))
          .map((t) => ({ id: t.id, title: t.title || "", url: t.url || "" })));
      } catch (e) { send(false, null, String(e)); }
      break;
    }
    case "setEnabled": {
      const enabled = params.enabled !== false;
      chrome.storage.local.set({ orb_enabled: enabled }, () => {
        chrome.tabs.query({}, (tabs) => tabs.forEach((t) => safeTabSend(t, { type: "llm_set_orb_enabled", enabled })));
        send(true, { enabled });
      });
      break;
    }
    case "setActiveChatProfile":
      chrome.storage.local.set({ active_profile_name: params.name || "" }, () => send(true, {}));
      break;
    case "setConfig":
      await chrome.storage.local.set(params);
      chrome.tabs.query({}, (tabs) => tabs.forEach((t) => safeTabSend(t, { type: "llm_config_updated" })));
      send(true, {});
      break;
    case "getConfig":
      send(true, await chrome.storage.local.get(["theme", "orb_size", "orb_opacity", "orb_enabled", "chat_profiles", "active_profile_name"]));
      break;
    case "runDemo": {
      const demo = (params.type === "asr") ? "asr" : "tts";
      const tabs = await targetTabs(params);
      for (const t of tabs) { if (await ensureInjected(t)) safeTabSend(t, { type: "llm_demo", demo }); }
      send(true, { tabs: tabs.map((t) => t.id) });
      break;
    }
    case "getState": {
      const tabs = await targetTabs(params);
      const cfg = await chrome.storage.local.get(["theme", "orb_size", "orb_opacity", "active_profile_name"]);
      let ui = {};
      if (tabs.length) {
        if (await ensureInjected(tabs[0])) {
          try { ui = await chrome.tabs.sendMessage(tabs[0].id, { type: "llm_bridge", cmd: "getState" }) || {}; } catch (e) { /* 忽略 */ }
        }
      }
      send(true, Object.assign({ theme: cfg.theme, orb_size: cfg.orb_size, orb_opacity: cfg.orb_opacity,
                                 active_profile_name: cfg.active_profile_name }, ui));
      break;
    }
    default: {
      // 通用控制命令：转发目标 tab 的 content（cmd 名 = content.bridgeHandle 的 case 名）
      const tabs = await targetTabs(params);
      if (!tabs.length) { send(false, null, "no target tab"); break; }
      if (!(await ensureInjected(tabs[0]))) {
        send(false, null, "目标页面未注入悬浮助手且自动注入失败：请刷新该页面后重试（tabId=" + tabs[0].id + "）");
        break;
      }
      try {
        const resp = await chrome.tabs.sendMessage(tabs[0].id, { type: "llm_bridge", cmd: m.cmd, params });
        send(!!(resp && resp.ok), resp && resp.data, resp && resp.error);
      } catch (e) {
        send(false, null, String(e));
      }
    }
  }
}

/* MV3 SW 休眠保护：alarm 唤醒后若无连接则重连，有连接则 ping */
chrome.alarms.create("py-bridge-keepalive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "py-bridge-keepalive") return;
  // OPEN(1)/CONNECTING(0) 视为正在处理中不打扰；CLOSING(2)/CLOSED(3)/null 才重连
  if (!pyWs || (pyWs.readyState !== 0 && pyWs.readyState !== 1)) {
    if (!bridgeReconnectTimer) bridgeConnect(); // 退避等待中不抢跑
  } else if (pyWs.readyState === 1) bridgeSend({ event: "ping" });
});

bridgeConnect();
