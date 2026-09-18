# LLM Float 悬浮助手（Chrome 扩展版 v0.6.32）

从 PySide6 桌面悬浮窗迁移的浏览器插件版。**核心 UI 不依赖 Python**：QwenPaw 聊天请求/SSE 解析、TTS 朗读、ASR 识别全部在扩展内完成；Python 仅作为可选增强服务（已实现本地 WebSocket 桥 + SDK，断线自动降级为纯 UI 自足）。

## 目录结构

```
chrome/
├─ manifest.json            # MV3 清单 v0.6.32（<all_urls> 内网自用）
├─ background.js            # 全局配置 / URL 匹配 / 总开关广播 / demo 路由 + Python 桥客户端（WS 自动重连 + alarm 保活）
├─ design_preview.html      # 11 组悬浮球风格预览页（设置 → 主题 → 「预览主题」按钮打开）
├─ design-preview.js        # 预览页渲染脚本（外部化以通过 MV3 CSP）
├─ popup/                   # 工具栏图标弹窗菜单：开关本插件 / TTS demo / ASR demo
├─ content/                 # 内容脚本（方案③：内核 + 功能单元，按 manifest 顺序注入，共享 isolated world）
│  ├─ core.js               # 内核：面板注册表 registerPanel / 定位 / 互斥 / 拖动 / 命令表 registerCommand / 状态上报 / 内置 orb、bubble 面板
│  ├─ features/chat.js      # 聊天单元：chat 面板 + showChat/hideChat/sendText/stopChat 命令
│  ├─ features/tts.js       # 播报单元：TTS 朗读 + ttsTarget 自动朗读 + speakText/stopSpeak/startTtsTarget 命令
│  ├─ features/asr.js       # 识别单元：ASR 识别 + startAsr/setAsrText/endAsr/stopAsr/startAsrDemo 命令
│  ├─ main.js               # 事件入口：消息路由（orb→内核、panel→feature、llm_bridge→命令表）+ 注入守卫 __llmFloatInjected
│  └─ content.css           # 容器样式
├─ ui/                      # 三个 iframe 页面 + 统一主题
│  ├─ common.js             # 三页面公共：assistant 消息分发 + 默认主题 + 兜底读 storage 主题
│  ├─ button.html/css/js    # 悬浮球（四态 idle/chat/tts/asr）：单击开聊天 / 右键 ASR / 左键拖动
│  ├─ chat.html/css/js      # 聊天窗：QwenPaw SSE 直连 或 LLM 模式（OpenAI 兼容 + agent 工具循环），AbortController 停止，Markdown 渲染
│  ├─ bubble.html/css/js    # 字幕气泡：TTS 字幕（扫入动画）/ ASR 识别
│  └─ theme.css             # 11 主题（G1~G11，与预览页一一对应）+ dark/blue/light 兼容保留
├─ options/                 # 设置页：基础 / 聊天（网址匹配）/ 字幕（TTS）/ 识别（ASR）/ 未启用（默认折叠）
└─ PYTHON-SDK.md            # Python SDK 完整文档
```

Python SDK（独立目录，**不要放回 chrome/ 内**，否则 `__pycache__` 会导致 Chrome 拒载）：

```
py-sdk/
├─ api.py            # FloatSDK：一行初始化，方法名 = JS 命令名
├─ demo.py           # 一键演示：遍历每页依次 showChat→speakText→ASR→hideAll→getConfig
└─ PYTHON-SDK.md     # SDK 使用文档
```

## 主题（11 组，与预览页一一对应）

设置 → 主题下拉可切换 11 组主题；下拉旁「预览主题」按钮新开标签页打开 `design_preview.html` 对比效果。

| 主题 key | 名称 | 预览页编号 |
|---|---|---|
| `glass` | 液态玻璃 | G1 |
| `flat` | 极简扁平 | G2 |
| `neon` | 霓虹赛博 | G3 |
| `macaron` | 马卡龙奶油 | G4 |
| `metal` | 金属质感 | G5 |
| `candy` | 活力糖果 | G6 |
| `morandi` | 莫兰迪雅致 | G7 |
| `synthwave` | 复古合成波 | G8 |
| `green` | 自然绿意 | G9 |
| `mono` | 黑白极简 | G10 |
| `brand` | 品牌蓝 | G11 |

- **预览页与 theme.css 同源联动**：theme.css 选择器为 `[data-theme="…"]`（body 或任意容器均可），预览页每张卡片挂各自 `data-theme` 实时渲染；改 theme.css 的 `--orb-*` 变量 → 插件悬浮球与预览页同步变化（重新加载扩展后生效）。
- 悬浮球五态配色变量：`--orb-{idle,chat,settings,tts,asr}-{bg,color,glow,shadow}` + `--orb-glass-bg` / `--orb-border`。
- 旧版 `dark` / `blue` / `light` 已从下拉移除（CSS 保留兼容，旧存储值自动映射到 `flat`）。

## 工作原理

- **方案③架构（内核 + 功能单元）**：`content/core.js` 是唯一内核（面板注册表、定位、互斥、拖动、命令表、状态上报、悬浮球交互），各业务（聊天 / TTS / ASR）是独立 feature 单元，各自 `registerPanel()` + `registerCommand()` + `registerPanelMessage()` 挂载。**加新功能 = 新建 `content/features/xxx.js` + manifest 加 1 行，核心零改动**。
- **悬浮球**：`ui/button.html` iframe（fixed 右下角），**每页独立**。左键拖动（Pointer Capture）、单击开聊天、右键开始 ASR。
- **聊天**：`ui/chat.html` iframe 为扩展页，`fetch` 受 `host_permissions` 豁免**无 CORS**，直接请求 QwenPaw `/api/console/chat`，SSE 解析（`object/content` 增量、`delta` 校准、`response.completed` 兜底）。**停止 = AbortController 断开连接**；等待回复时发送按钮变「停止」。
- **网址匹配**：background 监听 `tabs.onActivated/onUpdated`，按活动标签 URL 匹配 `chat_profiles`（第一条默认兜底，从第二条起正则），写入 `active_profile_name` 并通知聊天窗切换标题。聊天页标题下拉框可**手动切换**配置（下次打开仍按网址自动匹配）。
- **三窗互斥**：聊天窗 / TTS 字幕 / ASR 气泡三者互斥，打开其中一个自动关闭其他已打开的。
- **总开关**：`orb_enabled`（默认开启，新开页面默认显示）。工具栏 popup「开关本插件」→ 翻转并广播 `llm_set_orb_enabled` 到所有页面。
- **工具栏 popup 菜单**（单击插件 logo）：① 开关本插件 ② TTS 朗读 demo ③ ASR 识别 demo。demo 在**当前活动页面**执行。
- **ttsTarget 自动朗读**：若当前聊天配置填了 TTS 定位（网页元素 **id 或 CSS 选择器**，如 `#normalSugSearchUl li:first-child`），content script **每 1s 轮询**该元素文本，与上次一致不触发；追加播增量、整体重写播全文——自动朗读 + 气泡字幕。
- **Python 桥（方案 A：本地 WebSocket 桥，已实现）**：
  - 扩展 background 主动连接 `ws://127.0.0.1:7860/bridge`（连不上则纯 UI 自足），3s 自动重连 + alarm 保活
  - 命令三端同名：**SDK 方法名 = 页面控制台 `llm-ctrl` 命令 = 源码命令表**（`ping` / `getTabs` / `setEnabled` / `showChat(send=)` / `hideChat` / `hideAll` / `sendText` / `stopChat` / `setActiveChatProfile` / `speakText` / `stopSpeak` / `runDemo` / `startAsr` / `setAsrText` / `endAsr` / `stopAsr` / `setTheme` / `setOrbSize` / `setOrbOpacity` / `getState` / `getConfig` / `setConfig`，均支持 `tabId=`，缺省活动页）
  - 事件上行：`uiState` / `orbState` / `chatOpened` / `chatClosed` / `bubbleShown` / `bubbleHidden` / `onChatMessage` / `onTtsSentence` / `onTtsIdle` / `onAsrPartial` / `onAsrFinal` / `onAsrState` / `configChanged`
  - 页面控制台通道：`window.postMessage({kind:"llm-ctrl", cmd, params, id}, "*")`，回复 `{kind:"llm-ctrl-reply", id, data}`
- **配置存储**：`chrome.storage.local`，保存后广播 `llm_config_updated` 全标签页实时生效。

## 新增功能 / 页面（扩展指南）

架构是**内核 + 功能单元（注册表）**：`content/core.js` 是唯一内核（面板注册表 `registerPanel` / 命令表 `registerCommand` / 定位 / 互斥 / 拖动 / 状态上报），每个业务（聊天 / TTS / ASR）是独立 `content/features/xxx.js` 单元。**加新功能只碰自己的文件，核心零改动**。

### 内核提供的原语（feature 里直接可用）

| 原语 | 作用 |
|---|---|
| `registerPanel(def)` | 注册一个 iframe 面板：`{name, url, w, h, place, exclusive, cls, init, onLoad, onOpen, onClose}` |
| `registerCommand(name, fn)` | 注册命令：`fn(params) → {ok}` 或 `{ok, data}`；命令名即 SDK 方法名 / 控制台 `llm-ctrl` 命令名（三端同名） |
| `registerPanelMessage(kind, fn)` | 处理面板 iframe 上报的 postMessage（`{kind, action, ...}`） |
| `openPanel(name)` / `closePanel(name)` | 打开 / 关闭面板；`exclusive: true` 的面板自动互斥（打开时关闭其他已开 exclusive 面板） |
| `placePanel(frame, w, h, mode)` | 弹窗贴靠悬浮球：`"top-left"` 右下角贴球左上角（聊天窗）、`"left"` 贴球左侧垂直居中（气泡） |
| `pushOrb / pushChat / pushBubble(name, payload)` | 给内置面板 iframe 推 `assistant` 消息（主题/尺寸/状态） |
| `pushOrbState(state)` | 悬浮球状态：`idle` / `chat` / `tts` / `asr` |
| `setUi(patch)` + `reportToBridge(name, payload)` | 更新 `uiState` 快照 / 上报事件给 Python SDK |
| `callCommand(name, params)` | 调用其他功能单元的命令（未注册返回 `unknown cmd`，无副作用——跨功能解耦的入口） |
| `currentTheme` / `orbSize` / `PANEL_FRAMES` / `MARGIN` | 共享状态与常量 |

### 新增一个页面（面板）——只动 2 个文件

以新增「便签」面板为例：

1. **新建 `ui/note.html/css/js`**（iframe 页面，页面脚本用 `common.js` 的 `assistant` 消息分发）
2. **新建 `content/features/note.js`**（模板照抄 `features/chat.js`）：

```js
// ① 注册面板（大小/定位/互斥/生命周期钩子）
registerPanel({
  name: "note", url: "ui/note.html", w: 360, h: 240, place: "top-left",
  cls: "llm-float-note-frame", exclusive: true,          // exclusive: 与聊天/气泡互斥
  init: { right: (MARGIN + ORB_WIN) + "px", bottom: (MARGIN + ORB_WIN + 12) + "px", left: "auto", top: "auto" },
  onLoad: () => { pushThemeAll(); },                     // iframe 加载完成：推主题等
  onOpen: () => { setUi({ note: { open: true } }); reportToBridge("noteOpened", {}); },
  onClose: () => { setUi({ note: { open: false } }); reportToBridge("noteClosed", {}); },
});

// ② 注册命令（命令名 = SDK 方法名 = 控制台 cmd）
registerCommand("showNote", (p) => { openPanel("note"); return { ok: true }; });
registerCommand("hideNote", () => { closePanel("note"); pushOrbState("idle"); return { ok: true }; });

// ③ 可选：处理面板 iframe 上报（如拖动、按钮点击）
registerPanelMessage("note", (kind, data) => {
  if (data.action === "hide") { closePanel("note"); pushOrbState("idle"); }
});
```

3. **`manifest.json`** 的 `content_scripts.js` 数组加 1 行：`"content/features/note.js"`（放在 `content/main.js` **之前**）

**不需要动**：`core.js` / `main.js` / `background.js`（Python 桥 default 分支会把任意命令转发到命令表）/ 其他 feature / 现有 ui 页面。

### 新增一个纯功能（无页面，如定时器）

只写 `content/features/timer.js` 并 `registerCommand("startTimer", ...)`，加 manifest 1 行。SDK / 控制台 / Python 桥**自动可用**（无需改 background）；需要 Python 侧方便调用时，在 `py-sdk/api.py` 加同名方法（或直接用 `await sdk._call("startTimer", params)`）。

### 新增设置项 / 主题

- **设置项**：`options/options.js` 的 `STORAGE_SCHEMA` 加字段 + `background.js` 的 `DEFAULTS` 加默认值；若 SDK 的 `getConfig` 需要读到，同步 `background.js` 中 `llm_init` / `getConfig` 的 keys 列表
- **主题**：`ui/theme.css` 加 `[data-theme="xxx"]` 块（定义 `--orb-{idle,chat,settings,tts,asr}-*` 等变量）+ `options/options.js` 主题下拉加一项；预览页卡片挂 `data-theme="xxx"` 即自动联动

### 新增功能时的调用约定

- 命令间互调：`callCommand("stopSpeak", {})`（而不是直接调用别的 feature 内部函数——解耦，未注册时静默失败）
- 状态/事件上报：`setUi(...)` 更新快照，`reportToBridge("事件名", payload)` 上行 Python（事件名保持驼峰）
- 悬浮球交互：默认单击 = `showChat`、右键 = `startAsr`（`handleOrbAction`），如需给悬浮球加新动作，在 `core.js` 的 `handleOrbAction` 加分支

## 聊天配置字段

| 字段 | 说明 |
|---|---|
| `chatName` | 配置名称（聊天页标题下拉框显示） |
| `urlRegex` | 网址匹配正则（`new RegExp().test(url)`，第一条配置不填则默认兜底） |
| `baseUrl` | QwenPaw 服务根地址（如 `http://localhost:8088`）；**LLM 模式**直接填完整接口地址（如 `https://api.deepseek.com/chat/completions`），不做拼接 |
| `agentId` | QwenPaw 的 Agent ID；**LLM 模式**下作模型名（如 `qwen-plus`） |
| `ttsTarget` | TTS 定位：网页元素 **id 或 CSS 选择器**（如 `chat-content`、`.msg`、`#sug li:first-child`），该元素新增文本 → 自动朗读 + 字幕 |
| `token` | QwenPaw Web 认证 Bearer token（本地可留空）；**LLM 模式**下为 OpenAI API Key（必填） |
| `mode` | **`qwenpaw`（默认）** / `llm`——两种接入并列二选一，按域名匹配到的配置决定聊天窗走哪套协议 |

会话标记 `QWENPAW_SESSION_ID` 自动取**本机 IP**，无需手动配置（仅 QwenPaw 模式）。

## LLM 模式（轻量 Agent，mode='llm'）

配置模式列选「LLM(Agent)」后，该域名下聊天窗走 **OpenAI 兼容接口**（`{baseUrl}/chat/completions`，流式 + function calling），并启用内置工具循环：

| 工具 | 能力 | 执行方 |
|---|---|---|
| `page_get_info` | 当前网页 URL / 标题 / 文本摘要 | 扩展内（content） |
| `page_read` | 按 CSS 选择器读取页面元素文本 | 扩展内（content） |
| `page_exec_js` | 在当前网页执行 JS（点击/填表/读取） | 扩展内（content） |
| `fs_read` | 读已授权工作目录内文件 | 扩展内（File System Access，**免 Python**） |
| `fs_write` | 写已授权工作目录内文件 | 同上 |
| `fs_find` | 在授权目录内递归查找（glob） | 同上 |

- **授权目录**：设置 → 基础 → Agent 工作目录 →「选择目录」（首次需手动选一次，句柄存 IndexedDB 持久化；授权失效时到设置页重选）。文件工具只能访问该目录树，不能任意路径
- **工具循环**：LLM 返回 tool_calls → 执行 → 结果回填 → 继续，最多 8 轮；工具执行过程显示「🔧」气泡
- **无 Python 依赖**：一期全部工具纯浏览器实现；`shell.exec`（执行命令行）仍需 Python 桥，二期接入
- 消息历史：LLM 模式前端维护 `messages` 数组（切换配置即清空，避免不同 agent 串上下文）

## Python SDK

```python
from api import FloatSDK

sdk = FloatSDK()                 # 自动连接 ws://127.0.0.1:7860/bridge
await sdk.showChat(send="你好", tabId=tid)   # 打开指定页面聊天窗并发送
await sdk.speakText("你好，这是 TTS 播报")
await sdk.startAsr(tabId=tid)                # 打开识别气泡
await sdk.setAsrText("流式中间结果", tabId=tid)  # 可多次调用展示流式效果
await sdk.endAsr(tabId=tid)
await sdk.hideAll(tabId=tid)     # 一键收起全部弹窗，只留悬浮球
await sdk.getConfig()            # 读取设置页全部参数
```

一键演示：`python demo.py`（逐页自动执行全流程，每步停顿数秒便于观察；只读不改用户设置）。

## 安装（内网 / 加载已解压）

1. `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选本目录（**chrome/ 目录下不要出现 `__pycache__` 等 `_` 开头目录**）
2. 打开任意网页 → 右下角出现悬浮球
3. 已加载后改代码：`chrome://extensions` 刷新扩展 → **刷新已打开的页面**（新代码才会注入）

## 使用

- **悬浮球**：左键拖动；**单击 → 聊天窗**；**右键 → 开始语音识别（ASR）**
- **工具栏图标**：单击弹出菜单——① 开关本插件 ② TTS demo ③ ASR demo
- **聊天窗**：标题下拉框手动切换配置（下次按网址自动重新匹配）；等待回复时按钮变「停止」；流式回复 Markdown 渲染
- **设置页**：主题（11 组 + 预览按钮）/ 大小 / 透明度 / Agent 工作目录（授权目录）/ 聊天配置表格（7 字段，含模式）/ TTS 接口配置 / ASR 接口配置；「未启用」分组默认折叠。入口：`chrome://extensions` → LLM Float → 详情 → 扩展程序选项
- **TTS 定位**：配置表填网页元素 id 或 CSS 选择器（如 `#normalSugSearchUl li:first-child`），该元素新增文本自动朗读并显示字幕

## 打包（内网分发）

`chrome://extensions` → 「打包扩展程序」→ 生成 `.crx` + `.pem`，内网机器拖入安装。

## 后续规划

- 系统级热键（chrome.commands 需在 chrome://extensions 手动绑定）
