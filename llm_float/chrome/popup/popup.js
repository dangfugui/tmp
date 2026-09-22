// 工具栏 popup 菜单：开关本插件 / 聊天页 / 设置 / 常用地址 / TTS demo / ASR demo
const toggleBtn = document.getElementById("btn-toggle");
const stateEl = document.getElementById("state");
const dotToggle = document.getElementById("dot-toggle");
const labelToggle = document.getElementById("label-toggle");
const chatBtn = document.getElementById("btn-chat");
const ttsBtn = document.getElementById("btn-tts");
const asrBtn = document.getElementById("btn-asr");

function send(type, payload) {
  // fire-and-forget：不期望响应，避免 popup 关闭引发 "port closed" 报错
  try { chrome.runtime.sendMessage({ type, ...(payload || {}) }); } catch (e) { /* 忽略 */ }
  window.close();
}

// 读取主题并应用
chrome.storage.local.get(["orb_enabled", "theme", "quick_links", "language"], (d) => {
  I18N_LANG = d.language || "zh";
  document.getElementById("popup-title").textContent = t("popup.title");
  document.getElementById("label-settings").textContent = t("popup.settings");
  document.getElementById("label-chat").textContent = t("popup.chat");
  const theme = d.theme || "glass";
  document.body.setAttribute("data-theme", theme);

  const enabled = d.orb_enabled !== false; // 默认开启
  stateEl.textContent = enabled ? t("popup.status_on") : t("popup.status_off");
  stateEl.style.color = enabled ? "#4ade80" : "#f87171";
  dotToggle.style.background = enabled ? "#4ade80" : "#f87171";
  labelToggle.textContent = enabled ? t("popup.toggle_on") : t("popup.toggle_off");

  // 插件关闭时，聊天页和 demo 按钮置灰
  if (!enabled) {
    chatBtn.classList.add("disabled");
    ttsBtn.classList.add("disabled");
    asrBtn.classList.add("disabled");
    chatBtn.onclick = (e) => { e.preventDefault(); };
    ttsBtn.onclick = (e) => { e.preventDefault(); };
    asrBtn.onclick = (e) => { e.preventDefault(); };
  }

  // 渲染常用地址（两个一行）
  const quickLinksEl = document.getElementById("quick-links");
  const links = d.quick_links || [];
  for (let i = 0; i < links.length; i += 2) {
    const row = document.createElement("div");
    row.className = "quick-links-row";
    for (let j = i; j < Math.min(i + 2, links.length); j++) {
      const link = links[j];
      if (!link.url) continue;
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.innerHTML = '<span class="dot" style="background:#39b6ff"></span>' + (link.name || link.url);
      btn.addEventListener("click", () => {
        chrome.tabs.update({ url: link.url });
        window.close();
      });
      row.appendChild(btn);
    }
    if (row.children.length > 0) quickLinksEl.appendChild(row);
  }
});

toggleBtn.addEventListener("click", () => send("llm_toggle_enabled"));

// 打开聊天页面
chatBtn.addEventListener("click", () => {
  send("llm_open_chat");
});

// 打开设置
document.getElementById("btn-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

ttsBtn.addEventListener("click", () => send("llm_demo", { demo: "tts" }));
asrBtn.addEventListener("click", () => send("llm_demo", { demo: "asr" }));
