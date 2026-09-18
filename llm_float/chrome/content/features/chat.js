// LLM Float content script — 功能单元：chat.js（聊天窗）
// 注册 chat 面板（大小/定位/互斥/加载与开关回调）+ 聊天相关命令 + 聊天面板页面消息处理。
registerPanel({
  name: "chat", url: "ui/chat.html", w: 400, h: 620, place: "top-left",
  cls: "llm-float-chat-frame", exclusive: true,
  init: { right: (MARGIN + ORB_WIN) + "px", bottom: (MARGIN + ORB_WIN + 12) + "px", left: "auto", top: "auto" },
  onLoad: () => { pushThemeAll(); pushProfiles(); },
  onOpen: () => { pushChat("onChatFocus", {}); setUi({ chat: { open: true, busy: false } }); reportToBridge("chatOpened", {}); try { chrome.storage.local.set({ chat_open: true }); } catch (e) {} },
  onClose: () => { setUi({ chat: { open: false, busy: false } }); reportToBridge("chatClosed", {}); try { chrome.storage.local.set({ chat_open: false }); } catch (e) {} },
});

/* 导航后自动恢复 chat 窗口（页面刷新后 content 重新注入） */
try {
  chrome.storage.local.get({ chat_open: false }, (d) => {
    if (d.chat_open) openPanel("chat");
  });
} catch (e) { /* 忽略 */ }

registerCommand("showChat", (p) => {
  openPanel("chat");
  if (p && p.send) pushChat("sendText", { text: p.send });
  return { ok: true };
});
registerCommand("hideChat", () => { closePanel("chat"); pushOrbState("idle"); return { ok: true }; });
registerCommand("sendText", (p) => { pushChat("sendText", { text: p && p.text }); return { ok: true }; });
registerCommand("stopChat", () => { pushChat("stopChat", {}); return { ok: true }; });

registerPanelMessage("chat", (kind, data) => {
  if (data.action === "hide") { closePanel("chat"); pushOrbState("idle"); }
  else if (data.action === "chat_busy") setUi({ chat: { open: true, busy: !!data.busy } });
});
