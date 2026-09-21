# LLM Float 悬浮助手

浏览器悬浮球 AI 助手：在任意网页右下角常驻悬浮球，支持聊天对话、TTS 播报字幕、ASR 语音识别，内置轻量 Agent 工具链可操作当前页面。

> **当前主版本：Chrome 扩展版**（`chrome/` 目录），核心 UI 不依赖 Python。
> 早期 PySide6/pywebview 桌面版代码保留在 `pyside6/` 目录，已停止维护。

## 快速开始

```
chrome://extensions → 开发者模式 → 加载已解压 → 选 chrome/ 目录
```

打开任意网页，右下角出现悬浮球。

## 核心功能

- **悬浮球**：四态（idle/chat/tts/asr），12 组主题，动作可配置（单击/右击/滚轮 × 方向）
- **聊天窗**：QwenPaw SSE 直连 或 OpenAI 兼容 LLM（function calling + 工具循环），多会话管理
- **TTS 字幕**：流式/非流式独立配置，真实音量波形图
- **ASR 识别**：流式/非流式独立配置，识别结果自动输入到当前页面或聊天窗
- **Agent 工具链**：页面观察（getPageInfo/getLinks/web_fetch）+ 页面操作（click/setInput/pressKey/scroll/waitFor）+ 文件读写（fs_read/fs_write/fs_find）
- **Python SDK**：可选，WebSocket 桥接，断线自动降级纯 UI 模式

详细文档见 [chrome/README.md](chrome/README.md) 和 [py-sdk/PYTHON-SDK.md](py-sdk/PYTHON-SDK.md)。
