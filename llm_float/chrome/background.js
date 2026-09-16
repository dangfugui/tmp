// background.js - service worker for MV3
console.log('[LLM Float] Background service worker started');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[LLM Float] Background received message:', msg);
  if (msg.action === 'openChat') {
    const chatURL = chrome.runtime.getURL('chat.html');
    console.log('[LLM Float] Looking for existing chat window:', chatURL);
    // Find existing window with our chat URL
    chrome.windows.getAll({ populate: true }, (windows) => {
      let existing = null;
      for (const w of windows) {
        if (w.tabs && w.tabs.length > 0) {
          // Check if any tab matches our chat URL
          for (const tab of w.tabs) {
            if (tab.url && tab.url.includes(chatURL)) {
              existing = w;
              break;
            }
          }
          if (existing) break;
        }
      }
      if (existing) {
        console.log('[LLM Float] Found existing chat window, focusing:', existing.id);
        chrome.windows.update(existing.id, { focused: true });
        // Optionally restore if minimized
        chrome.windows.update(existing.id, { state: 'normal' });
      } else {
        console.log('[LLM Float] No existing chat window, creating new');
        const createData = {
          url: chatURL,
          type: 'popup',
          width: msg.width || 400,
          height: msg.height || 500,
          left: Math.round(msg.left),
          top: Math.round(msg.top)
        };
        console.log('[LLM Float] Creating window with data:', createData);
        chrome.windows.create(createData, (window) => {
          console.log('[LLM Float] Created window:', window);
        });
      }
    });
  }
});