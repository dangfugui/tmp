# LLM Float 悬浮助手（Chrome 扩展版 v0.8.1）

从 PySide6 桌面悬浮窗迁移的浏览器插件版。**核心 UI 不依赖 Python**：QwenPaw 聊天请求/SSE 解析、TTS 朗读、ASR 识别全部在扩展内完成；Python 仅作为可选增强服务（已实现本地 WebSocket 桥 + SDK，断线自动降级为纯 UI 自足）。

## 目录结构

```
chrome/
├─ manifest.json            # MV3 清单（<all_urls> 内网自用）
├─ background.js            # 全局配置 / URL 匹配 / 总开关广播 / demo 路由 + Python 桥客户端（WS 自动重连 + alarm 保活）+ web_fetch 代理（CORS 绕过）
├─ data/
│  ├─ agent-prompt.md       # LLM 模式 system prompt（工具速查表 + 重试规则 + navigate 注意事项）
│  ├─ default-config.json   # 默认配置（首次安装自动写入）
│  ├─ design_preview.html   # 主题预览页（设置 → 主题 → 「预览主题」按钮打开）
│  └─ design-preview.js     # 预览页渲染脚本
├─ popup/                   # 工具栏图标弹窗菜单：开关本插件 / TTS demo / ASR demo / 聊天页 / 设置 / 常用地址
├─ content/                 # 内容脚本（内核 + 功能单元，按 manifest 顺序注入，共享 isolated world）
│  ├─ core.js               # 内核：面板注册表 / 定位 / 互斥 / 拖动 / 命令表 / 状态上报 / 内置 orb、bubble 面板
│  ├─ utils.js              # 公共方法（matchProfile 网址匹配等）
│  ├─ features/agent.js     # LLM agent 工具命令（page_* 操作当前网页）
│  ├─ features/chat.js     # 聊天单元：chat 面板 + showChat/hideChat/sendText/stopChat 命令
│  ├─ features/tts.js      # 播报单元：TTS 朗读 + ttsTarget 自动朗读 + speakText/stopSpeak/startTtsTarget 命令
│  ├─ features/asr.js       # 识别单元：ASR 识别 + startAsr/setAsrText/endAsr/stopAsr/startAsrDemo 命令
│  ├─ main.js               # 事件入口：消息路由 + 注入守卫 __llmFloatInjected
│  └─ content.css          # 容器样式
├─ ui/                      # 三个 iframe 页面 + 统一主题
│  ├─ common.js             # 三页面公共：assistant 消息分发 + 默认主题 + 兜底读 storage 主题
│  ├─ actions.js             # 悬浮球动作配置（单击/右击/滚轮 × 上下左右）
│  ├─ button.html/css/js    # 悬浮球（四态 idle/chat/tts/asr）
│  ├─ chat.html/css/js      # 聊天窗：QwenPaw SSE 直连 或 LLM 模式（OpenAI 兼容 + agent 工具循环）
│  ├─ bubble.html/css/js   # 字幕气泡：TTS 字幕 / ASR 识别
│  └─ theme.css             # 12 主题（G1~G12，与预览页一一对应）
├─ options/                 # 设置页：基础 / 聊天（网址匹配）/ 字幕（TTS）/ 识别（ASR）/ 按键配置 / 常用地址
└─ PYTHON-SDK.md            # Python SDK 完整文档
```

Python SDK（独立目录，**不要放回 chrome/ 内**，否则 `__pycache__` 会导致 Chrome 拒载）：

```
py-sdk/
├─ api.py            # FloatSDK：一行初始化，方法名 = JS 命令名
├─ demo.py           # 一键演示
└─ PYTHON-SDK.md     # SDK 使用文档
```

## 主题（12 组，与预览页一一对应）

设置 → 主题下拉可切换 12 组主题；下拉旁「预览主题」按钮新开标签页打开 `design_preview.html` 对比效果。

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
| `pageagent` | PageAgent 霓虹渐变 | G12 |

- **预览页与 theme.css 同源联动**：改 theme.css 的 `--orb-*` 变量 → 插件悬浮球与预览页同步变化
- 悬浮球五态配色变量：`--orb-{idle,chat,settings,tts,asr}-{bg,color,glow,shadow}`
- PageAgent 主题特点：蓝紫渐变边框（#39b6ff → #bd45fb）+ 流动动画 + 发光阴影，TTS/ASR 弹窗同样应用

## 工作原理

- **内核 + 功能单元**：`content/core.js` 是唯一内核，各业务（聊天/TTS/ASR）是独立 feature 单元。**加新功能 = 新建 `content/features/xxx.js` + manifest 加 1 行，核心零改动**
- **悬浮球**：`ui/button.html` iframe（fixed 右下角），**每页独立**。左键拖动，单击/右击/滚轮 × 上下左右均可配置动作（设置 → 按键配置）
- **聊天**：`ui/chat.html` iframe 为扩展页，`fetch` 受 `host_permissions` 豁免**无 CORS**，直接请求 QwenPaw 或 OpenAI 兼容接口，SSE 流式解析
- **网址匹配**：background 监听活动标签 URL 匹配 `chat_profiles`，**越往后优先级越高**（支持通配符 `*`，无需默认配置）
- **三窗互斥**：聊天窗 / TTS 字幕 / ASR 气泡三者互斥
- **总开关**：`orb_enabled`（默认开启），popup「开关本插件」→ 翻转并广播

## LLM Agent 工具链（mode='llm'）

配置模式列选「LLM(Agent)」后，该域名下聊天窗走 **OpenAI 兼容接口**（流式 + function calling），内置工具循环：

### 页面观察
| 工具 | 能力 |
|---|---|
| `page_get_info` | URL/标题/文本 + 可交互元素列表（含 selector、label/val、isLink/isSubmit、contenteditable） |
| `page_read` | 按选择器读元素文本 |
| `page_get_links` | 只抓链接列表（绝对路径 + 去重 + isExternal 标注） |
| `web_fetch` | 后台抓任意 URL（走 background，**跨域不受 CORS 限制**，支持 maxChars 截断） |
| `page_get_html` | 读元素 outerHTML |

### 页面操作
| 工具 | 能力 |
|---|---|
| `page_click` | 点击元素（回读 checked/aria-expanded 状态） |
| `page_set_input` | 填输入框（表单 + contenteditable/ProseMirror，回读校验，disabled/readonly 返回 skipped） |
| `page_press_key` | 按键盘键（Enter 自动 requestSubmit 提交表单，回传焦点元素） |
| `page_select` | 选下拉框选项 |
| `page_hover` | 悬停触发下拉/浮层 |
| `page_scroll` | 滚动页面（等滚动稳定后回读 scrollTop/atBottom/scrollPercent） |
| `page_wait` | 等待毫秒（真支持 0，超界返回 clamped 标记） |
| `page_wait_for` | 条件等待（等元素出现/消失，比固定毫秒稳） |
| `navigate` | 跳转新 URL（跳转前自动 flushState 保存会话，可带 chatText 续聊） |

### 文件操作
| 工具 | 能力 |
|---|---|
| `fs_read` | 读授权目录文件（支持按行读 startLine/endLine） |
| `fs_write` | 写授权目录文件（自动创建父目录 mkdir -p） |
| `fs_find` | 递归查找文件（自动跳过 .git/node_modules/.next/dist 等） |

### 工具链特性
- **失败自动重观察**：page_* 工具失败时自动调 getPageInfo，把元素列表附在错误信息里
- **统一返回结构**：写操作返回 `{ok, action, selector, ...}`
- **错误分类**：web_fetch 失败返回 `category: network/cors/dns/timeout`
- **会话持久化**：跳转前 flushState 保存完整 llmMessages（含 tool_calls），新页面恢复；不完整 tool_calls 自动清理
- **多会话**：每个 profile 下可多个会话，下拉框切换，标题为 `mm-dd hh:mm + 首个提问`，上限可配（默认 20，最大 999）
- **prompt 字段**：chat_profiles 表格加 `prompt` 字段，每个会话第一次对话自动拼接

## 聊天配置字段

| 字段 | 说明 |
|---|---|
| `chatName` | 配置名称 |
| `urlRegex` | 网址匹配正则（越往后优先级越高，支持 `*` 通配符） |
| `baseUrl` | LLM 接口地址（完整 `/chat/completions` URL） |
| `agentId` | 模型名（如 `deepseek-chat`） |
| `ttsTarget` | TTS 定位：网页元素 id 或 CSS 选择器 |
| `inputSelector` | ASR 识别结果输入定位（为空则发到聊天页） |
| `prompt` | 会话首次对话自动拼接的提示词 |
| `token` | OpenAI API Key |
| `mode` | `qwenpaw` / `llm` |

## 悬浮球动作配置

设置 → 按键配置：单击/右击/滚轮 × 上下左右，每个方向可独立配置触发动作（动态从 popup 按钮列表加载）。默认：单击全方向=聊天页，右击全方向=语音识别。

## Python SDK

```python
from api import FloatSDK

sdk = FloatSDK()
await sdk.showChat(send="你好", tabId=tid)
await sdk.speakText("你好")
await sdk.startAsr(tabId=tid)
await sdk.hideAll(tabId=tid)
await sdk.getConfig()
```

## 安装

1. `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选 `chrome/` 目录
2. 打开任意网页 → 右下角出现悬浮球
3. 改代码后：刷新扩展 → **刷新已打开的页面**

## 使用

- **悬浮球**：左键拖动；单击/右击/滚轮方向触发配置的动作
- **工具栏 popup**：开关本插件 / TTS demo / ASR demo / 聊天页 / 设置 / 常用地址
- **聊天窗**：标题栏双下拉框（配置 + 会话切换）；最大化按钮近全屏显示（四周留 60px 边距）
- **设置页**：主题（12 组 + 预览）/ 大小 / 透明度 / Agent 工作目录 / 聊天配置表格（8 字段）/ TTS / ASR / 按键配置 / 常用地址（两列网格）
