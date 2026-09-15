# 桌面悬浮 AI 助手（llm_float）

一个常驻桌面右下角的悬浮球，作为 AI 助手的统一入口。围绕它有三种显示模式：**Agent 聊天**、**TTS 播报字幕**、**ASR 实时识别**；右键悬浮球可进入设置页配置常用项。

> 当前阶段：**只做 UI + 交互，业务数据全部 Mock**；真实 LLM / TTS / ASR 后续对接。

---

## 1. 运行环境与启动

- 环境：conda 虚拟环境 `py310`（Python 3.10）
- 依赖：`PySide6`（含 QtWebEngine）、`pywebview`（均已安装）

本项目用**两套方案**实现同一套 UI，便于对比，各自独立、可单独运行：

```powershell
conda activate py310
cd C:\Users\admin\Downloads\tmp

# 方案 A：pywebview + Edge WebView2
python llm_float\pywebview\app.py

# 方案 B：PySide6 + QtWebEngine
python llm_float\pyside6\app.py
```

> Linux（银河麒麟 V10 SP1）用 `python3 llm_float/pywebview/app.py`，依赖安装与注意事项见 **第 11 节**。

---

## 2. 目录结构

```
llm_float/
├─ pywebview/                 # 方案 A：pywebview（已实现 3 形态 + 设置）
│  ├─ app.py                 # 多窗口管理 / 定位 / 形状 / JS-Python API / 后台推流
│  └─ web/
│     ├─ button.html/css/js   # 悬浮球（四扇区点击）
│     ├─ chat.html/css/js     # 聊天窗口
│     ├─ settings.html/css/js # 设置窗口
│     └─ bubble.html/css/js   # 字幕 / 识别的悬浮气泡
├─ pyside6/                   # 方案 B：PySide6 QWebEngineView（当前仅聊天+悬浮球）
│  ├─ app.py
│  └─ web/
│     ├─ bridge.js            # QWebChannel 初始化（window.qtReady / qtApi）
│     └─ ...
└─ README.md
```

两者功能对等：右下角悬浮球（透明圆形、拖动、左键打开、右键菜单）、聊天窗口（圆角、透明、Mock 内容、标题栏拖动、清空/收起/关闭）。

### 两套方案的差异（对比要点）

| | pywebview（`pywebview/`） | PySide6（`pyside6/`） |
|---|---|---|
| Web 内核 | Edge WebView2 | QtWebEngine（Chromium） |
| 窗口/事件循环 | pywebview 封装（WinForms） | Qt 原生 `QWidget` |
| JS ↔ Python | `window.pywebview.api.*` + `pywebviewready` | `QWebChannel` + `window.qtReady` |
| 透明/异形 | `Region` 裁剪（`TransparencyKey` 会鼠标穿透） | `setMask(QRegion)` + `WA_TranslucentBackground` |
| 拖动 | `pywebview-drag-region` + `pywebviewMoveWindow` | `QWindow.startSystemMove()` 原生移动 |
| 坐标/DPI | 逻辑像素 × `_scale` 换算到物理像素 | Qt6 全逻辑像素，无需换算 |
| 最小窗口限制 | Windows 强制约 120px 宽 | 无（可任意小） |
| 右键菜单 | JS `contextmenu` → Python | JS `contextmenu` → `QMenu` |
| 依赖/体积 | 轻，需系统装 WebView2 Runtime | 重（含 Qt/Chromium），无需系统运行库 |
| 打包 | 需处理 WebView2 运行库 | PyInstaller 体积大但自包含 |


---

## 3. 悬浮球（唯一入口）

| 行为 | 说明 |
|---|---|
| 位置 | 默认右下角，距离屏幕工作区边缘 `MARGIN=22px`；避开任务栏 |
| 外观 | 68px 圆形，渐变底 + 气泡图标；圆形外完全透明（点击穿透到桌面） |
| 单击上/下/左/右扇区 | 按点击的扇区触发对应功能（见下表，**临时测试用**） |
| 按住拖动 | 可拖拽到屏幕任意位置；拖动过程不触发点击 |
| 右键单击 | 直接打开 **设置** 窗口 |
| 状态提示 | 有未读 / 正在录音 / 正在播报时，球体叠加对应角标或动效 |

**点位与功能（当前为测试映射，后续由真实场景驱动）**

| 扇区 | 触发 |
|---|---|
| ↑ 上 | 打开**聊天**窗口 |
| ↓ 下 | 打开**设置**窗口 |
| ← 左 | 打开**字幕气泡**（再次点击=关闭） |
| → 右 | 打开**识别气泡**（再次点击=关闭） |

> 后期：不再依赖手动点位，而是由**语音唤醒（ASR）**、**TTS 播报**、**用户主动对话**等场景自动切换这三种展示。
>
> 注：因 Windows 对窗口有最小宽度限制（约 120px），悬浮球窗口实际为 `120×120`，内部居中显示 68px 圆；点击区域仅限圆内。

---

## 4. 三种展示形态（核心需求）

**聊天、设置是独立窗口；字幕、识别是同一个小悬浮气泡。** 四种展示**互斥**，同一时刻只出现一种（触发新的会关闭其余的）。

**位置与连接**：所有面板都**吸附在悬浮球正上方**（对齐圆的右边缘、留 4px 间隙），并带一个**指向悬浮球的小尾巴**（speech-bubble tail），视觉上像是从球上“长”出来的；面板打开时**悬浮球会高亮**（内部描边）。若拖动悬浮球，已打开的面板会**实时跟随**；重新打开时也会按球的新位置重新吸附。四种展示永远不遮挡悬浮球。

| 形态 | 载体 | 尺寸 | 说明 |
|---|---|---|---|
| 聊天（Agent） | 独立窗口 `chat.html` | 400×620 长方形 | 与 Agent 对话 |
| 设置 | 独立窗口 `settings.html` | 420×640 长方形 | 配置项表单 |
| 字幕 / 识别 | 共用小气泡 `bubble.html` | 340×88 胶囊 | 歌词式悬浮展示 |

### 形态 A — 聊天窗口（与 Agent 对话）

- 结构化聊天界面：消息气泡（用户 / 助手）、时间戳、输入框、发送按钮、清空、收起/关闭。
- **默认内容**：打开时由 Python 推送一段欢迎语 + 一张**色块表**（色块 + 十六进制编码，分「主色调 / 点缀色 / 中性色」）。
- **可复制**：正文可选中复制（`user-select: text`）；每条消息下方有「复制」按钮，点击复制该条文本（`navigator.clipboard`，不可用时回退 `execCommand`）。
- 输入：Enter 发送，Shift+Enter 换行；内容区可滚动；标题栏可拖动。
- Mock：回复由 Python `chat_send()` 返回文本。

### 形态 B — 字幕气泡（TTS 播报，歌词式）

- 一个小胶囊气泡，展示 TTS 正在播报的文本。
- 上一句淡出（小字），当前句高亮（大字），最多 2 行、超出省略。
- 内容由 Python 逐句推送（`onTtsSentence`）；播报结束显示“播报结束”。

### 形态 C — 识别气泡（ASR 实时识别）

- 同一个小气泡，切换为识别样式：左侧红点表示“聆听中”，右侧显示实时文本。
- 区分 **中间结果（interim，灰色，可被覆盖）** 与 **最终结果（final）**。
- 由 Python 推送（`onAsrState / onAsrPartial / onAsrFinal`）。

### 展示切换与优先级（后续）

- 由悬浮球扇区、右键菜单、快捷键、或外部事件（TTS/ASR 开始结束）触发。
- 建议优先级：**ASR 识别中 > TTS 播报中 > 用户主动打开的聊天**。
- 需记录“用户期望状态”，避免打断后无法恢复。

---

## 5. 设置窗口（右键 / 悬浮球下扇区）

- 入口：悬浮球 **右键**，或点击悬浮球 **下扇区**。
- 形态：**独立的长方形窗口**（与聊天窗并列，不是聊天窗里的一个页签）。
- 底部固定：**恢复默认 / 退出程序 / 保存**。
- 打开时由前端调用 `get_settings()` 从 Python 拉取 **schema + 当前值**；点“保存”调用 `save_settings(values)` 回写 Python。
- **当前所有设置项均为 Mock**（Python 侧内存态），字段类型覆盖：文本、密码、多行文本、数字、枚举（下拉）、布尔（开关）、列表（多选）。

### 5.1 设置项清单（Mock）

**基础**
| 设置项 | 类型 | 默认值 / 可选项 |
|---|---|---|
| 悬浮球大小 | 数字 (40–96) | 68 |
| 悬浮球透明度 | 数字 (0.2–1.0) | 1.0 |
| 主题 | 枚举 | 跟随系统 / 深色 / 浅色 |
| 界面语言 | 枚举 | 简体中文 / English |
| 开机自启 | 布尔 | 关 |
| 默认打开模式 | 枚举 | 聊天 / 字幕 / ASR |

**聊天（Agent）**
| 设置项 | 类型 | 默认值 / 可选项 |
|---|---|---|
| 接口地址 Base URL | 文本 | `https://api.example.com/v1` |
| API Key | 文本(密码) | 空 |
| 模型 | 枚举 | gpt-4o / gpt-4o-mini / claude-3.5 / qwen-max / 自定义 |
| System Prompt | 多行文本 | “你是一个有用的助手……” |
| temperature | 数字 (0–2) | 0.7 |
| 单次最大 tokens | 数字 | 2048 |
| 上下文轮数 | 数字 | 10 |
| 流式输出 | 布尔 | 开 |

**TTS 字幕**
| 设置项 | 类型 | 默认值 / 可选项 |
|---|---|---|
| 字号 | 数字 | 18 |
| 每行最大字数 | 数字 | 24 |
| 显示行数 | 枚举 | 1 / 2 / 3 / 5 |
| 对齐方式 | 枚举 | 左 / 居中 / 右 |
| 单句停留时长(秒) | 数字 | 3 |
| 播报结束自动隐藏 | 布尔 | 开 |

**ASR**
| 设置项 | 类型 | 默认值 / 可选项 |
|---|---|---|
| 识别语言 | 枚举 | 自动 / 中文 / 英文 |
| 识别引擎 | 枚举 | Whisper / 讯飞 / 本地模型 |
| 采样率 | 枚举 | 16000 / 44100 |
| 显示中间结果 | 布尔 | 开 |
| 静音自动结束(秒) | 数字 | 3 |
| 自动补全标点 | 布尔 | 开 |
| 设备 | 列表 | 默认麦克风 / 麦克风 A / 麦克风 B |

**快捷键**
| 设置项 | 类型 | 默认值 |
|---|---|---|
| 唤起 / 收起主窗口 | 文本(快捷键) | `Ctrl+Alt+Space` |
| 开始 / 结束识别 | 文本(快捷键) | `Ctrl+Alt+R` |

**高级**
| 设置项 | 类型 | 默认值 / 可选项 |
|---|---|---|
| 日志级别 | 枚举 | DEBUG / INFO / WARN / ERROR |
| 数据目录 | 文本(路径) | `./data` |
| 代理地址 | 文本 | 空 |
| 账号 | 文本 | 空 |

---

## 6. 交互状态机（概要）

```
        ┌──────────────┐
        │   IDLE 待机   │◄──────────────┐
        └──────┬───────┘               │
   点击/快捷键 │                       │ 结束识别/播报
        ┌──────▼───────┐               │
        │  CHAT 聊天    │               │
        └──────┬───────┘               │
 TTS 开始      │      ASR 开始          │
        ┌──────▼───────┐  ┌────────────▼──┐
        │ SUBTITLE 字幕 │  │  ASR 识别中    │
        └──────────────┘  └───────────────┘
```

- 模式切换只改主窗口内容，不销毁窗口（性能与位置保持）。
- 窗口可 `show / hide`；隐藏不等于关闭。

---

## 7. JS ↔ Python 接口约定（预留，后续对接）

两套方案暴露的能力一致，只是桥接方式不同：

| | pywebview | PySide6 |
|---|---|---|
| 调用方向 | `window.pywebview.api.<name>()` | `window.qtApi.<name>()`（`QWebChannel`） |
| 就绪事件 | `pywebviewready` | `window.qtReady`（Promise） |
| 事件推送 | `window.evaluate_js(...)` | `view.page().runJavaScript(...)` |

**前端 → Python（pywebview 版，当前已实现）**
```ts
// 悬浮球
orb_action("up" | "down" | "left" | "right"): void   # 四扇区（临时测试用）
open_chat(): void
open_settings(): void
open_subtitle(): void        # 显示气泡（字幕）并开始 Mock 推流
open_asr(): void             # 显示气泡（识别）并开始 Mock 推流
hide_chat(): void
hide_settings(): void
hide_bubble(): void          # 停止推流并隐藏气泡
quit(): void

// 数据拉取
chat_send(text): { text }              # 聊天回复（后续换真实 LLM）
get_settings(): schema[]               # 设置 schema + 当前值
save_settings(values): bool
reset_settings(): schema[]

// 流控制
tts_start() / tts_stop()
asr_start() / asr_stop()
```

**Python → 前端（事件推送）**
```ts
// 聊天窗口
window.assistant.onChatMessage({ role, text })
window.assistant.onPalette({ groups })   // 默认色块内容
// 悬浮球
window.assistant.setActive({ active })
// 气泡
window.assistant.setMode({ mode: "subtitle" | "asr" })
window.assistant.onTtsSentence({ text, index })
window.assistant.onTtsIdle()
window.assistant.onAsrState({ state: "listening" | "idle" })
window.assistant.onAsrPartial({ text })
window.assistant.onAsrFinal({ text })
```

> 约定：所有跨端数据用 JSON 可序列化结构；长文本走增量事件而非整段重绘。
> PySide6 版接口名相同，仅桥接方式不同。

---

## 8. Mock 与后续对接点

| 模块 | 当前（Mock，全部在 Python 侧） | 后续对接 |
|---|---|---|
| 聊天回复 | `Api.chat_send()` 返回固定文案 | LLM 流式接口（改成 push `onChatDelta`） |
| 字幕 | `Api._tts_loop()` 定时推句子 | TTS 播报回调 / 音频时间轴对齐 |
| 识别 | `Api._asr_loop()` 定时逐字推 partial/final | 麦克风采集 + ASR 引擎回调 |
| 设置项 | Python 内存态 `SETTINGS_SCHEMA` | 落盘（JSON/ini）+ 真正生效 |
| 扇区触发 | 手动点击上/下/左/右 | 语音唤醒 / TTS 开始 / ASR 开始等场景自动切换 |

---

## 9. 已知技术要点（避免踩坑）

**方案 A：pywebview（`pywebview/`）**

1. **透明**：`transparent=True` 只会让 WebView2 透明，WinForms 宿主仍绘制不透明背景；用 `TransparencyKey` 做键控会把窗口变成 layered，导致**鼠标全部穿透**。改用 **`Region` 裁剪**（`app.py: apply_shape`），既无矩形底色又保留输入。
2. **最小窗口宽度**：Windows 强制约 120px，悬浮球窗口须用 120 并内部居中。
3. **DPI**：系统 150% 缩放时，pywebview 的坐标/尺寸按“逻辑像素 × scale”换算；定位用工作区逻辑坐标，形状裁剪用 `_scale` 换算到物理像素。
4. **`js_api` 反射**：pywebview 会递归遍历 `js_api` 对象的公开属性并暴露给 JS；**不要**把 `Window` 等大对象挂成公开属性（会遍历 WinForms COM 树崩溃），以下划线开头可跳过。
5. **隐藏窗口**：预创建聊天窗用 `hidden=True` 会触发 pywebview 无障碍树递归报错，改为**首次需要时再创建**。
6. **拖拽**：`frameless` 窗口用 `pywebview-drag-region` class 作为拖拽区；需自行区分“拖动 vs 点击”（位移阈值 ≥4px 视为拖动）。

**方案 B：PySide6（`pyside6/`）**

1. **透明**：`setAttribute(WA_TranslucentBackground)` + `page().setBackgroundColor(QColor(0,0,0,0))` 即可让 WebEngine 背景透明，无需 pywebview 那套 Region/TransparencyKey 组合。
2. **异形窗口**：`setMask(QRegion)` 裁剪（圆 / 圆角），圆外区域不绘制且鼠标穿透；实现比 pywebview 直接。
3. **拖动**：用 `QWindow.startSystemMove()` 原生移动，平滑且光标移出窗口也不中断；JS 侧仅需在超过位移阈值时调用一次 `start_drag()`。
4. **桥接**：`QWebChannel` 注册 `api` 对象，前端由 `bridge.js` 暴露 `window.qtReady`/`window.qtApi`；页面需引入 `qrc:///qtwebchannel/qwebchannel.js`。
5. **坐标**：Qt6 全部使用逻辑像素，无需像 pywebview 那样做 DPI 换算；且无最小窗口宽度限制。
6. **打包**：QtWebEngine 体积较大，但无需目标机器预装 WebView2 Runtime。

---

## 10. 里程碑

- [x] 悬浮球：定位 / 拖动 / 透明圆 / 四扇区点击
- [x] 聊天窗口（独立长方形）与 Python Mock 回复
- [x] 设置窗口（独立长方形，schema 从 Python 拉取、保存回 Python）
- [x] 字幕 / 识别 共用的悬浮气泡（Python 推流）
- [x] 四种展示互斥（开一个自动关其余）
- [x] 面板带尾巴吸附悬浮球 + 拖动时实时跟随 + 球高亮
- [x] 窗口圆角 / 无白边
- [x] pywebview 版：3 形态 + 设置 全部完成
- [ ] pywebview 版同步到 PySide6 版
- [ ] 触发方式由“手动扇区”改为“语音唤醒 / TTS / ASR 场景”自动切换
- [ ] 设置落盘 + 生效
- [ ] 对接真实 LLM / TTS / ASR

> 说明：pywebview 版的所有 Mock 数据都走 Python（前端用 `window.pywebview.api.*` 拉取，或 Python 用 `evaluate_js` 推 `window.assistant.onXxx`），前端不硬编码任何业务数据。详见第 7 节。

---

## 11. 跨平台 / 银河麒麟 V10 兼容性

**目标运行环境**：银河麒麟桌面操作系统 **V10 SP1**，**x86_64**，UKUI 桌面（默认 **X11**）。
开发环境为 Windows，因此所有平台相关代码都必须做隔离，**不允许出现只在某一系统能跑的写法**。

### 11.1 代码里已经做的兼容处理

| 位置 | Windows | Linux（麒麟） |
|---|---|---|
| `pywebview/app.py` → `IS_WINDOWS` | `sys.platform.startswith("win")` 判定 | 同一常量，走 else 分支 |
| `get_work_area()` | `SystemParametersInfoW`（避开任务栏） | `tkinter` 读屏幕尺寸；再兜底 `1920×1080` |
| `apply_shape()` | WinForms `Region` 原生裁剪 | **直接 return**：用 `transparent=True` + CSS 圆角，不碰任何 Windows API |
| 字体（所有 `*.css`） | 首选 Segoe UI / 微软雅黑 | 回退 `Noto Sans CJK SC` / `Source Han Sans SC` / `WenQuanYi Micro Hei` |
| 等宽字体 | Cascadia Mono / Consolas | 回退 `DejaVu Sans Mono` / `Noto Sans Mono CJK SC` |
| 路径 | `os.path.join(...)` | 同一套，无盘符、无反斜杠、无大写路径 |
| 后端选择 | Edge WebView2（自动） | `LLM_FLOAT_GUI` 环境变量可强制 `qt` / `gtk` / `cef`，不设则自动探测 |

**明确没有使用**：注册表、`win32*`、pythonnet（`System.*` 仅在 Windows 分支内 import）、Windows 环境变量、Windows 专属字体、`C:\` 绝对路径、`.exe` 调用。

### 11.2 麒麟上的依赖安装

```bash
# 1) pywebview 的 Linux 后端（二选一）
#    A. 复用已有的 PySide6（推荐，QtWebEngine）
pip install "pywebview[qt]"
#    B. 或使用系统 WebKit2GTK
sudo apt install python3-gi gir1.2-webkit2-4.0

# 2) 窗口定位需要 tkinter（缺失时回退为 1920x1080）
sudo apt install python3-tk

# 3) 中文字体（否则界面字体发虚/方块）
sudo apt install fonts-noto-cjk        # 或 fonts-wqy-microhei
```

启动：

```bash
python3 pywebview/app.py
# 若自动选错后端，强制指定：
LLM_FLOAT_GUI=qt python3 pywebview/app.py
```

### 11.3 已知差异 / 注意点

1. **窗口定位 `x/y`**：X11 下正常；**Wayland** 下窗口管理器可能忽略位置（麒麟默认 X11，通常没问题）。
2. **透明窗口依赖桌面合成器（compositor）**：若关闭合成，透明区域可能显示为黑色；麒麟默认开启。
3. **圆角 / 尾巴**：Windows 用原生 `Region` 裁剪得到硬边形状（圆、圆角、向下的小尾巴）；Linux 靠 CSS `border-radius` + `body::after` 的三角尾巴 + 窗口 `transparent`，效果为平滑边缘，无需任何原生调用。
4. **面板跟随悬浮球**：通过 `orb.events.moved` 事件实时重新定位（Windows 后端会触发）；Linux 后端若不上报 move 事件，则退化为「每次打开时按球当前位置吸附」。
5. **最小窗口宽度**：Windows 强制约 120px（故悬浮球窗口用 `120×120`）；Linux 无此限制，代码仍沿用同一尺寸以保持一致外观。
6. **PySide6 版**：`QWindow.startSystemMove()` 在 X11 正常；Wayland 下可能受限（可改用 JS 上报坐标手动 `move`）。
7. **`-webkit-line-clamp`**：WebKitGTK / Chromium 均支持，无需改动。

### 11.4 编码规范（新增代码必须遵守）

- 任何平台相关调用都要用 `IS_WINDOWS` / `sys.platform` 守卫，并提供跨平台回退。
- 不新增 `win32*` / pythonnet / 注册表 / 绝对盘符路径依赖。
- 字体、图标、快捷键不要假设 Windows 习惯（如 `Ctrl` vs `Cmd`、`\` vs `/`）。
- 文件读写统一用 `os.path.join` 与 `utf-8` 编码。
- 新增依赖要同时确认麒麟可用（apt 包或纯 Python 包）。
