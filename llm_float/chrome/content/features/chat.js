// LLM Float content script — 功能单元：chat.js（聊天窗）
// 注册 chat 面板（大小/定位/互斥/加载与开关回调）+ 聊天相关命令 + 聊天面板页面消息处理。
registerPanel({
  name: "chat", url: "ui/chat.html", w: 400, h: 620, place: "top-left",
  cls: "llm-float-chat-frame", exclusive: true,
  init: { right: (MARGIN + ORB_WIN) + "px", bottom: (MARGIN + ORB_WIN + 12) + "px", left: "auto", top: "auto" },
  onLoad: () => { pushThemeAll(); pushProfiles(); },
  onOpen: () => { pushChat("onChatFocus", {}); setUi({ chat: { open: true, busy: false } }); reportToBridge("chatOpened", {}); },
  onClose: () => { setUi({ chat: { open: false, busy: false } }); reportToBridge("chatClosed", {}); },
});

/* 只有 navigate 跳转过来才自动打开 chat 窗口（普通刷新/手动打开不自动开） */
try {
  chrome.storage.local.get({ navigate_keep_chat: false }, (d) => {
    if (d.navigate_keep_chat) {
      openPanel("chat");
      // 用完清掉，下次刷新不再自动开
      try { chrome.storage.local.set({ navigate_keep_chat: false }); } catch (e) {}
    }
  });
} catch (e) { /* 忽略 */ }

registerCommand("showChat", (p) => {
  openPanel("chat");
  if (p && p.send) pushChat("sendText", { text: p.send });
  return { ok: true };
});
registerCommand("hideChat", () => { closePanel("chat"); pushOrbState("idle"); return { ok: true }; });
registerCommand("sendText", (p) => { pushChat("sendText", { text: p && p.text }); return { ok: true }; });
registerCommand("stopChat", () => {
  try { pushChat("stopChat", {}); } catch (e) { console.warn("[chat] stopChat pushChat 失败:", e); }
  return { ok: true };
});

registerPanelMessage("chat", (kind, data) => {
  if (data.action === "hide") { closePanel("chat"); pushOrbState("idle"); }
  else if (data.action === "maximize") {
    const f = PANEL_FRAMES.chat;
    if (!f) return;
    const maximized = f.dataset.maximized === "1";
    if (maximized) {
      f.style.width = "400px"; f.style.height = "620px";
      placePanel(f, 400, 620, "top-left");
      f.dataset.maximized = "0";
      pushChat("setMaximized", { maximized: false });
    } else {
      const m = 60;
      f.style.left = m + "px"; f.style.top = m + "px";
      f.style.right = "auto"; f.style.bottom = "auto";
      f.style.width = (window.innerWidth - m * 2) + "px";
      f.style.height = (window.innerHeight - m * 2) + "px";
      f.dataset.maximized = "1";
      pushChat("setMaximized", { maximized: true });
    }
  }
  else if (data.action === "chat_busy") setUi({ chat: { open: true, busy: !!data.busy } });
  else if (data.action === "tts_speak_bg") {
    // 后台朗读，不弹 TTS 气泡
    if (data.text) callCommand("speakText", { text: data.text, background: true });
  }
});
