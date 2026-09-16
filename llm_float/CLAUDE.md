# LLM Float Orb Chrome Extension

A simple Chrome extension that displays a floating AI assistant orb in the browser toolbar. The extension uses Manifest V3 and provides a settings page for user preferences.

## Files
- `manifest.json` – extension metadata
- `orb.html` – popup/orb UI
- `orb.css` – styling for the orb
- `orb.js` – optional interaction logic
- `options.html` – settings page
- `options.js` – handles saving/loading settings via chrome.storage

## Usage
1. Load the extension in Chrome via `chrome://extensions` → Load unpacked → select the `chrome` folder.
2. Click the extension icon to see the orb.
3. Access settings via the extension’s Details → Extension options.

## Notes
- No external dependencies; all code is inline or local.
- Settings are stored using `chrome.storage.sync`.