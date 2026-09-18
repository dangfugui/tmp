# LLM Float 悬浮助手（Chrome 扩展版 v0.6.5）

从 PySide6 桌面悬浮窗迁移的浏览器插件版。**核心 UI 不依赖 Python**：QwenPaw 聊天请求/SSE 解析、TTS 朗读、ASR 识别全部在扩展内完成；Python 仅作为可选增强服务（已实现本地 WebSocket 桥 + SDK，断线自动降级为纯 UI 自足）。

## 目录结构

```
chrome/
├─ manifest.json            # MV3 清单 v0.6.5（<all_urls> 内网自用）
├─ background.js            # 全局配置 / URL 匹配 / 总开关广播 / demo 路由 + Python 桥客户端（WS 自动重连 + alarm 保活）
├─ popup/                   # 工具栏图标弹窗菜单：开关本插件 / TTS demo / ASR demo
├─ content/                 # 内容脚本（6 模块，按序注入，共享 isolated world 全局）
│  ├─ ui.js                 # iframe 容器（悬浮球/聊天窗/字幕气泡）/ 定位 / 显隐 / 配置推送 / 初始化
│  ├─ drag.js               # 悬浮球拖动（Pointer Capture）+ 聊天窗遮罩拖动
│  ├─ tts.js                # TTS 朗读 + ttsTarget 自动朗读
│  ├─ asr.js                # ASR 真实识别（Web Speech API）/ mock 驱动
│  ├─ bridge.js             # Python 桥 / 控制台通道：uiState 聚合 + bridgeHandle 统一命令入口
│  ├─ main.js               # 事件入口（iframe postMessage + background 消息）+ 注入守卫
│  └─ content.css           # 容器样式
├─ ui/                      # 三个 iframe 页面（复用 PySide6 项目的 web 资产，桥接已改造）
│  ├─ button.html/css/js    # 悬浮球（五态）：单击开聊天 / 右键 ASR / 左键拖动
│  ├─ chat.html/css/js      # 聊天窗：QwenPaw SSE 直连（AbortController 停止）+ Markdown 渲染
│  ├─ bubble.html/css/js    # 字幕气泡：TTS 字幕（speechSynthesis + 扫入动画）/ ASR 识别
│  └─ theme.css             # 8 主题（flat/neon/synthwave/glass/macaron/dark/blue/light）
├─ options/                 # 设置页：基础 / 聊天（网址匹配）/ 聊天（Agent）/ 未启用（默认折叠）
└─ PYTHON-SDK.md            # Python SDK 完整文档（本仓库）
```

Python SDK（独立目录，**不要放回 chrome/ 内**，否则 `__pycache__` 会导致 Chrome 拒载）：

```
py-sdk/
├─ api.py            # FloatSDK：一行初始化，方法名 = JS 命令名
├─ demo.py           # 一键演示：每页依次 showChat→speakText→ASR→hideChat→getConfig
└─ PYTHON-SDK.md     # SDK 使用文档
```

## 工作原理

- **内容脚本模块化**：`content/` 6 个模块按 manifest 顺序注入，共享 isolated world 全局（顶层 `var` 声明跨文件可见）。副作用初始化（创建 iframe / 注册事件 / 拉配置）收敛到 `initUi()` / `initMain()`，由 `main.js` 的注入守卫 `if (!window.__llmFloatInjected)` 统一执行一次——重复注入（动态注入竞态）不会产生双份 iframe。
- **悬浮球**：`ui/button.html` iframe（fixed 右下角），**每页独立**。左键拖动（Pointer Capture）、单击开聊天、右键开始 ASR。
- **聊天**：`ui/chat.html` iframe 为扩展页，`fetch` 受 `host_permissions` 豁免**无 CORS**，直接请求 QwenPaw `/api/console/chat`，SSE 解析（`object/content` 增量、`delta` 校准、`response.completed` 兜底）。**停止 = AbortController 断开连接**；等待回复时发送按钮变「停止」。
- **网址匹配**：background 监听 `tabs.onActivated/onUpdated`，按活动标签 URL 匹配 `chat_profiles`（**第一条默认兜底，从第二条起正则**），写入 `active_profile_name` 并通知聊天窗切换标题。聊天页标题下拉框可**手动切换**配置（下次打开仍按网址自动匹配）。
- **三窗互斥**：聊天窗 / TTS 字幕 / ASR 气泡三者互斥，打开其中一个自动关闭其他已打开的。
- **总开关**：`orb_enabled`（默认开启，新开页面默认显示）。工具栏 popup「开关本插件」→ 翻转并广播 `llm_set_orb_enabled` 到所有页面。
- **工具栏 popup 菜单**（单击插件 logo）：① 开关本插件 ② TTS 朗读 demo ③ ASR 识别 demo。demo 在**当前活动页面**执行：
  - TTS：`speechSynthesis` 逐句朗读 + 字幕逐句推进（无需 Python）
  - ASR：`webkitSpeechRecognition` 实时识别（interim 中间结果 / final 定稿）
- **ttsTarget 自动朗读**：若当前聊天配置填了 TTS 定位（网页元素 id），content script 用 MutationObserver 监听该元素，出现新增文本自动朗读 + 气泡字幕。
- **Python 桥（方案 A：本地 WebSocket 桥，已实现）**：
  - 扩展 background 主动连接 `ws://127.0.0.1:7860/bridge`（连不上则纯 UI 自足），3s 自动重连 + alarm 保活
  - 命令三端同名：**SDK 方法名 = 页面控制台 `llm-ctrl` 命令 = 源码 `bridgeHandle` case 名**（`ping` / `getTabs` / `showChat(send=)` / `hideChat` / `sendText` / `stopChat` / `speakText` / `startAsr` / `setAsrText` / `endAsr` / `stopAsr` / `setTheme` / `setOrbSize` / `setOrbOpacity` / `getState` / `getConfig` / `setConfig` 等，均支持 `tabId=`，缺省活动页）
  - 事件上行：`uiState` / `orbState` / `chatOpened` / `chatClosed` / `bubbleShown` / `bubbleHidden` / `onChatMessage` / `onTtsSentence` / `onTtsIdle` / `onAsrPartial` / `onAsrFinal` / `onAsrState` / `configChanged`
  - 页面控制台通道：`window.postMessage({kind:"llm-ctrl", cmd, params, id}, "*")`，回复 `{kind:"llm-ctrl-reply", id, data}`
- **配置存储**：`chrome.storage.local`，保存后广播 `llm_config_updated` 全标签页实时生效。

## 聊天配置字段

| 字段 | 说明 |
|---|---|
| `chatName` | 配置名称（聊天页标题下拉框显示） |
| `urlRegex` | 网址匹配正则（`new RegExp().test(url)`，第一条配置不填则默认兜底） |
| `QWENPAW_BASE_URL` | QwenPaw 服务根地址（如 `http://localhost:8088`） |
| `QWENPAW_AGENT_ID` | Agent ID |
| `ttsTarget` | TTS 定位：网页该元素 id 出现新文本 → 自动朗读 + 字幕 |
| `token` | QwenPaw Web 认证 Bearer token（本地可留空） |

会话标记 `QWENPAW_SESSION_ID` 自动取**本机 IP**，无需手动配置。

## Python SDK

```python
from api import FloatSDK

sdk = FloatSDK()                 # 自动连接 ws://127.0.0.1:7860/bridge
await sdk.showChat(send="你好", tabId=tid)   # 打开指定页面聊天窗并发送
await sdk.speakText("你好，这是 TTS 播报")
await sdk.startAsr(tabId=tid)                # 打开识别气泡
await sdk.setAsrText("流式中间结果", tabId=tid)  # 可多次调用展示流式效果
await sdk.endAsr(tabId=tid)
await sdk.getConfig()            # 读取设置页全部参数
```

一键演示：`python demo.py`（逐页自动执行全流程，每步停顿数秒便于观察）。

## 安装（内网 / 加载已解压）

1. `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选本目录（**chrome/ 目录下不要出现 `__pycache__` 等 `_` 开头目录**）
2. 打开任意网页 → 右下角出现悬浮球
3. 已加载后改代码：`chrome://extensions` 刷新扩展 → **刷新已打开的页面**（新代码才会注入）

## 使用

- **悬浮球**：左键拖动；**单击 → 聊天窗**；**右键 → 开始语音识别（ASR）**
- **工具栏图标**：单击弹出菜单——① 开关本插件 ② TTS demo ③ ASR demo
- **聊天窗**：标题下拉框手动切换配置（下次按网址自动重新匹配）；等待回复时按钮变「停止」；流式回复 Markdown 渲染
- **设置页**：主题/大小/透明度/聊天配置表格（6 字段）；TTS / ASR demo 按钮；「未启用」分组默认折叠。入口：`chrome://extensions` → LLM Float → 详情 → 扩展程序选项
- **TTS 定位**：配置表填网页元素 id（如 `chat-content`），该元素新增文本自动朗读并显示字幕

## 打包（内网分发）

`chrome://extensions` → 「打包扩展程序」→ 生成 `.crx` + `.pem`，内网机器拖入安装。

## 后续规划

- 系统级热键（chrome.commands 需在 chrome://extensions 手动绑定）
