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
  else if (data.action === "chat_busy") setUi({ chat: { open: true, busy: !!data.busy } });
});
