// LLM Float background
// 职责：URL 匹配聊天配置、全局配置读写、消息路由（options 打开、配置广播）
const DEFAULTS = {
  theme: "flat",
  orb_size: 68,
  orb_opacity: 1.0,
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
  if (tabId != null) {
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
        const got = await chrome.storage.local.get(["theme", "orb_size", "orb_opacity", "chat_profiles", "active_profile_name"]);
        sendResponse({ ok: true, data: got });
      })();
      return true;
    }
    case "llm_open_options":
      chrome.runtime.openOptionsPage();
      break;
    case "llm_manual_profile": {
      // 用户在下拉框手动切换聊天配置
      chrome.storage.local.set({ active_profile_name: msg.name || "" });
      break;
    }
    case "llm_demo": {
      // 设置页 TTS / ASR demo：广播到所有标签页，由 content script 显示字幕气泡执行
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((t) => {
          if (t.id == null) return;
          try { chrome.tabs.sendMessage(t.id, { type: "llm_demo", demo: msg.demo || "tts" }); } catch (e) { /* 忽略 */ }
        });
      });
      break;
    }
  }
});
