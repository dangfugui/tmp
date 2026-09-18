// LLM Float background
// 职责：URL 匹配聊天配置、全局配置读写、消息路由（悬浮助手开关、TTS/ASR demo、options 打开、配置广播）
const DEFAULTS = {
  theme: "flat",
  orb_size: 68,
  orb_opacity: 1.0,
  orb_enabled: true, // 悬浮助手总开关（工具栏 popup 切换）；新开页面默认开启
  chat_profiles: [
    { chatName: "默认", urlRegex: ".*", baseUrl: "http://localhost:8088", agentId: "default", ttsTarget: "", token: "" }
  ]
};

async function ensureDefaults() {
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
        const got = await chrome.storage.local.get(["theme", "orb_size", "orb_opacity", "orb_enabled", "chat_profiles", "active_profile_name"]);
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
    case "llm_bridge_event": {
      // iframe / content → Python：事件上行（转发到本地 WS 桥）
      bridgeSend({ event: msg.name, data: msg.payload });
      sendResponse({ ok: true });
      return true;
    }
    default:
      sendResponse({ ok: false, error: "unknown message: " + msg.type });
      return true;
  }
});

/* ============================================================
   Python 桥（可选）：background 连 Python SDK 的本地 WebSocket 服务
   - 命令（Python → 扩展）走 bridgeRoute，目标 tab 默认活动页，可用 params.tabId 指定
   - 事件（扩展 → Python）走 llm_bridge_event → bridgeSend
   - Python 不在时：扩展完全自足，仅定时尝试重连
   ============================================================ */
const PY_BRIDGE_URL = "ws://127.0.0.1:7860/bridge";
let pyWs = null;
let bridgeReconnectTimer = null;

function bridgeSend(obj) {
  try { if (pyWs && pyWs.readyState === 1) pyWs.send(JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
}

function bridgeScheduleReconnect() {
  if (bridgeReconnectTimer) return;
  bridgeReconnectTimer = setTimeout(() => { bridgeReconnectTimer = null; bridgeConnect(); }, 3000);
}

function bridgeConnect() {
  try { if (pyWs) { pyWs.onclose = null; try { pyWs.close(); } catch (e) {} } } catch (e) { /* 忽略 */ }
  try {
    pyWs = new WebSocket(PY_BRIDGE_URL);
  } catch (e) { pyWs = null; bridgeScheduleReconnect(); return; }
  pyWs.onopen = () => console.log("[bridge] 已连接 Python SDK");
  pyWs.onclose = () => { pyWs = null; bridgeScheduleReconnect(); };
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
    for (const f of ["content/ui.js", "content/drag.js", "content/tts.js", "content/asr.js", "content/bridge.js", "content/main.js"]) {
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
      return t && /^https?:/i.test(t.url || "") ? [t] : [];
    } catch (e) { return []; }
  }
  return chrome.tabs.query({ active: true, currentWindow: true });
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
  if (!pyWs || pyWs.readyState !== 1) bridgeConnect();
  else bridgeSend({ event: "ping" });
});

bridgeConnect();
