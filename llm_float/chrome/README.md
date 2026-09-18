# LLM Float 悬浮助手（Chrome 扩展版 v0.3）

从 PySide6 桌面悬浮窗迁移的浏览器插件版。**核心 UI 不依赖 Python**：QwenPaw 聊天请求/SSE 解析、TTS 朗读、ASR 识别全部在扩展内完成；Python 仅作可选增强服务（后续接入）。

## 目录结构

```
chrome/
├─ manifest.json            # MV3 清单（<all_urls> 内网自用）
├─ background.js            # URL 匹配聊天配置 / 全局配置 / demo 广播 / 消息路由
├─ content/
│  ├─ content.js            # 注入 悬浮球 + 聊天 + 字幕气泡 三个 iframe；拖动/显隐/ttsTarget 自动朗读
│  └─ content.css           # 容器样式
├─ ui/                      # 复用 PySide6 项目的 web 资产（桥接已改造）
│  ├─ button.html/css/js    # 悬浮球（五态）：单击开聊天 / 右键开设置 / 左键拖动
│  ├─ chat.html/css/js      # 聊天窗：QwenPaw SSE 直连（AbortController 停止）+ Markdown
│  ├─ bubble.html/css/js    # 字幕气泡：TTS 字幕（speechSynthesis）/ ASR 识别（Web Speech API）
│  └─ theme.css             # 8 主题（flat/neon/synthwave/glass/macaron/dark/blue/light）
└─ options/                 # 设置页（完整版）：基础 / 聊天（网址匹配）/ 字幕 / 未启用
```

## 工作原理

- **悬浮球**：content script 注入 `ui/button.html` iframe（fixed 右下角）。左键拖动、单击开聊天、右键开设置。
- **聊天**：`ui/chat.html` iframe 为扩展页，`fetch` 受 `host_permissions` 豁免 **无 CORS**，直接请求 QwenPaw `/api/console/chat`，SSE 解析与 Python 版一致（`object/content` 增量、`msg_types` 区分 reasoning、`delta` 校准、`response.completed` 兜底）。**停止 = AbortController 断开连接**。
- **网址匹配**：background 监听 `tabs.onActivated/onUpdated`，按活动标签 URL 匹配 `chat_profiles`（**第一条默认兜底，从第二条起正则**），写入 `active_profile_name` 并通知聊天窗切换标题下拉框。
- **字幕气泡**：设置页「TTS / ASR」demo 按钮 → 广播 `llm_demo` → 当前标签页显示气泡并执行：
  - TTS：`speechSynthesis` 逐句朗读 + 字幕逐句推进（无需 Python）
  - ASR：`webkitSpeechRecognition` 实时识别（interim 中间结果 / final 定稿）
- **ttsTarget 自动朗读**：若当前聊天配置填了 TTS 定位（网页元素 id），content script 用 MutationObserver 监听该元素，出现新增文本自动朗读 + 气泡字幕。
- **配置存储**：`chrome.storage.local`，保存后广播 `llm_config_updated` 全标签页实时生效。

## 聊天配置字段

| 字段 | 说明 |
|---|---|
| `chatName` | 配置名称（标题下拉框显示） |
| `urlRegex` | 网址匹配正则（`new RegExp().test(url)`） |
| `baseUrl` | QwenPaw 服务根地址（如 `http://localhost:8088`） |
| `agentId` | Agent ID |
| `ttsTarget` | TTS 定位：网页该元素 id 出现新文本 → 自动朗读 + 字幕 |
| `token` | QwenPaw Web 认证 Bearer token（本地可留空） |

## 安装（内网 / 加载已解压）

1. `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选本目录
2. 打开任意网页 → 右下角出现悬浮球

## 使用

- **悬浮球**：左键拖动；单击 → 聊天窗；右键 → 设置页
- **聊天窗**：标题下拉框手动切换配置（下次按网址自动重新匹配）；等待回复时按钮变「停止」；流式回复 Markdown 渲染
- **设置页**：主题/大小/透明度/聊天配置表格（6 字段）；TTS / ASR demo 按钮；「未启用」分组默认折叠
- **TTS 定位**：在配置表填网页元素 id（如 `chat-content`），该元素新增文本自动朗读并显示字幕

## 打包（内网分发）

`chrome://extensions` → 「打包扩展程序」→ 生成 `.crx` + `.pem`，内网机器拖入安装。

## 后续规划

- Python 可选桥（WS 127.0.0.1:8765）：高级 ASR（Whisper/讯飞）/ 外部业务接口，断线自动降级
- 系统级热键（chrome.commands 需在 chrome://extensions 手动绑定）
