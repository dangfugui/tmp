# llm\_float UI 项目 API 文档

> 桌面悬浮 AI 助手 UI（PySide6 + Qt WebEngine + QWebChannel）。
> 本文档面向 
>
> **Python 调用方**
>
> ：如何启动 UI、读取设置、推送字幕 / 识别 / 聊天内容、切换主题与外观。
> 最近更新：2026-09-17（同步至当前代码）



***

## 1. 架构总览



```
┌─────────────────────────── Python 层 ───────────────────────────┐

│  Overlay（门面，推荐入口）                                        │

│    ├── 宿主模式：与你的 QApplication 共享事件循环                  │

│    └── 独立进程模式：multiprocessing spawn，命令队列通信           │

│  OverlayHost（实际宿主：管理 4 个窗口）                            │

│    ├── WebWindow × 4（悬浮球 / 聊天 / 设置 / 气泡）               │

│    └── SettingsStore（设置读写，持久化到 data/settings.json）      │

└─────────────────────────── 前端层 ────────────────────────────┘

&#x20; web/button.html  悬浮球（五态）      ← window.api.\* 调 Python

&#x20; web/chat.html    聊天窗              → window.assistant.\* 收推送

&#x20; web/settings.html 设置窗

&#x20; web/bubble.html  字幕/识别气泡
```



* **前端 → Python**：前端通过 Qt WebChannel 调用注册为 `api` 的 Backend 槽函数。

* **Python → 前端**：`WebWindow.send_js(name, payload)` 调用页面里的 `window.assistant.<name>(payload)`。

> ⚠️ 
>
> **WebChannel 返回值通道不可靠**
>
> ：本项目实测本版本 PySide6 下槽函数返回值传到 JS 侧一律为 
>
> `{}`
>
> （
>
> `get_settings`
>
>  为唯一仍在使用的返回值槽，其余新接口全部改为「请求 - 推送」模式）。
>
> **外部对接不要依赖 JS 侧调用 Python 获取返回值**
>
> ，需要数据时由 Python 主动 
>
> `send_js`
>
>  推送。



***

## 2. 快速开始

### 2.1 独立进程模式（最简单，自建事件循环）



```
from overlay import Overlay

overlay = Overlay()          # 无参 = 独立进程模式，自动 spawn UI 进程

overlay.open\_chat()          # 弹出聊天窗

overlay.exec()               # 阻塞直到 UI 退出
```

### 2.2 宿主模式（嵌入你自己的 QApplication）



```
import sys

from PySide6.QtWidgets import QApplication

from overlay import Overlay

app = QApplication(sys.argv)

overlay = Overlay(chat\_handler=my\_handler)   # 传 host 或任一回调 = 宿主模式

app.exec()
```

> 模式判定：
>
> `Overlay(host=None, chat_handler=None, on_subtitle=None, on_asr=None, on_bubble_hide=None)`
>
>  全为 None → 独立进程模式；提供任一 → 宿主模式。
>
> `start=True`
>
>  只控制是否立即显示悬浮球，不改变模式。



***

## 3. 设置存储：`SettingsStore`

文件：`settings_store.py`。直接读写 `data/settings.json`。



```
from settings\_store import SettingsStore

store = SettingsStore(r"C:\Users\admin\Downloads\tmp\llm\_float\pyside6")

store.value("theme")              # 当前主题，如 "neon"

store.value("orb\_size")           # 悬浮球大小 40\~96

store.value("orb\_opacity")        # 透明度 0.2\~1.0

store.value("不存在的key", 42)     # 带默认值

store.get()                       # 完整结构（分区 + 字段 + 当前值）

store.save({"theme": "macaron"})  # 保存并落盘

store.reset()                     # 恢复默认（仅内存，不落盘，需点保存）
```

### 3.1 统一接口：读取全部设置（推荐外部对接用）



```
from settings\_store import get\_all\_settings

settings = get\_all\_settings()

\# 返回分组结构：\[{"section": "基础", "items": \[{key,label,type,value,...}]}, ...]

\# 共 4 组 34 项：基础 / 聊天（网址匹配）/ 字幕（TTS）/ 未启用
```

宿主模式下想读内存最新值（含未保存修改），直接用 `host.settings_store.get()`（同结构）。

### 3.2 全部设置项

**✅ 真实生效的选项（有代码消费）：**



| key             | 说明         | 类型             | 范围 / 选项                                   | 默认   | 生效链路                                 |
| --------------- | ---------- | -------------- | ----------------------------------------- | ---- | ------------------------------------ |
| `theme`         | 主题         | select         | flat / neon / synthwave / glass / macaron | flat | 4 个窗口同步换装（`setTheme` 推送）             |
| `orb_size`      | 悬浮球大小      | number         | 40 \~ 96 (step 1)                         | 68   | 复用窗口改遮罩直径 + `setOrbSize` 推送          |
| `orb_opacity`   | 悬浮球透明度     | number         | 0.2 \~ 1.0 (step 0.05)                    | 1.0  | 4 个窗口 `setWindowOpacity` 统一          |
| `chat_profiles` | 聊天（网址匹配）配置 | chat\_profiles | 列表（见 §9.5）                                | -    | 打开聊天按 URL 匹配 → 驱动 QwenPaw 请求 + 标题下拉框 |
| `tts_lines`     | 字幕显示行数     | select         | 1 / 2 / 3 / 5                             | 2    | 字幕气泡高度自适应                            |

**⚪ 未启用（仅显示 / 预留，无代码消费）**—— 设置页收在「未启用」折叠分组内：



| 分组（原）                              | key                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 基础                                 | `language`、`autostart`、`default_mode`                                                                         |
| 聊天（Agent，已废弃，真实对接走 chat\_profiles） | `base_url`、`api_key`、`model`、`system_prompt`、`temperature`、`max_tokens`、`context_turns`、`stream`              |
| 字幕（TTS）                            | `tts_font_size`、`tts_max_chars`、`tts_align`、`tts_hold`、`tts_auto_hide`                                        |
| 语音识别（ASR）                          | `asr_language`、`asr_engine`、`asr_sample_rate`、`asr_show_interim`、`asr_silence`、`asr_auto_punct`、`asr_devices` |
| 快捷键                                | `hotkey_chat`、`hotkey_asr`                                                                                    |
| 高级                                 | `log_level`、`data_dir`、`proxy`、`features`                                                                     |

> 想真启用某项时：从「未启用」移回对应分组 + 补消费逻辑（如让 
>
> `tts_font_size`
>
>  驱动气泡样式）。



***

## 4. `Overlay` 门面（推荐入口）

文件：`overlay.py`。

### 4.1 构造



```
Overlay(

&#x20;   host=None,                    # 复用已有 OverlayHost（进阶）

&#x20;   chat\_handler=None,            # 聊天回调 fn(text) -> dict|None

&#x20;   on\_subtitle=None,             # 打开字幕时回调 fn()

&#x20;   on\_asr=None,                  # 打开识别时回调 fn()

&#x20;   on\_bubble\_hide=None,          # 气泡隐藏时回调 fn()

&#x20;   start=True,                   # 是否立即显示悬浮球

)
```



* 所有参数均为 `None` → **独立进程模式**（自动 spawn）。

* 提供任一回调或 host → **宿主模式**（与你的 Qt 应用同进程）。

* 公开方法（open\_chat/get\_settings/push\_tts\_text 等）统一代理：进程模式经管道转发，宿主模式直调 host，**调用方式两种模式一致**。

### 4.2 窗口控制



| 方法                                    | 作用                                       |
| ------------------------------------- | ---------------------------------------- |
| `open_chat(send=None)` / `hide_chat()` | 打开 / 关闭聊天窗；`send` 非空时打开同时发送该消息，用户消息会显示在聊天窗（如 `open_chat("你好")`） |
| `open_settings()` / `hide_settings()` | 打开 / 关闭设置窗                               |
| `open_subtitle()`                     | 打开字幕（TTS）气泡                              |
| `open_asr()`                          | 打开识别（ASR）气泡                              |
| `hide_bubble()`                       | 隐藏气泡                                     |
| `hide_all()`                          | **隐藏所有弹窗（聊天 / 设置 / 气泡），只保留悬浮球**，悬浮球回到静默态 |
| `tts_demo()`                          | 打开字幕气泡并推送一条演示字幕（设置页「TTS」按钮）              |
| `asr_demo()`                          | 打开识别气泡并推送演示状态与文本（设置页「ASR」按钮）             |
| `start()`                             | 显示悬浮球（宿主模式；进程模式安全返回 None）                |

**悬浮球交互**：单击 → 打开聊天窗；右击 → 打开设置窗；拖动 → 移动位置。字幕 / 识别气泡通过设置页「TTS / ASR」按钮或 Python 侧 `open_subtitle()` / `open_asr()` / `tts_demo()` / `asr_demo()` 打开。

**窗口回收**：聊天 / 设置 / 气泡窗隐藏超过 5 分钟自动销毁（释放 WebEngine 渲染进程内存），下次打开时懒重建；悬浮球常驻不回收。

打开任意面板时，悬浮球会同步切换为对应状态（idle/chat/settings/tts/asr），其他窗口自动隐藏。

### 4.3 设置相关



| 方法                      | 作用                                |
| ----------------------- | --------------------------------- |
| `get_settings()`        | 返回完整设置结构（同 `SettingsStore.get()`） |
| `save_settings(values)` | 保存设置并**立即应用**（主题 / 透明度 / 悬浮球大小）   |
| `reset_settings()`      | 恢复默认（仅内存，不落盘）                     |
| `current_theme()`       | 当前主题 key                          |
| `set_theme(theme)`      | 切换主题（四个窗口全部换装）                    |
| `set_opacity(opacity)`  | 设置窗口透明度（0.2\~1.0，四个窗口统一）          |

### 4.4 内容推送



| 方法                                | 作用                                    |
| --------------------------------- | ------------------------------------- |
| `chat_send(text)`                 | 交给 `chat_handler` 处理，返回其返回值           |
| `stop_chat()` | 停止当前 QwenPaw 回复（自定义 chat_handler 模式下无效果，返回 False） |
| `push_tts_text(text, index=None)` | 在字幕气泡显示一句文本（自动打开气泡）                   |
| `finish_tts()`                    | 字幕播报结束（隐藏 / 复位）                       |
| `set_asr_state(state)`            | 识别状态："listening" / "idle" / "error" 等 |
| `push_asr_partial(text)`          | 识别中间结果                                |
| `push_asr_final(text)`            | 识别最终结果                                |
| `quit()`                          | 退出 UI                                 |

> 气泡推送是线程安全的：内部经 
>
> `UiScheduler`
>
>  调度到 UI 线程，可从后台线程直接调用。

### 4.5 演示模式（仅独立进程）



```
overlay.show\_pages(\["chat", "settings", "subtitle", "asr"], dwell\_ms=2500)
```

依次展示各页面后退出，用于快速预览。



***

## 5. 前端双向桥接

### 5.1 前端调用 Python（`window.api.*`）

页面加载后经 `bridge.js` 的 `window.qtReady` 拿到 `api` 对象：



```
window.qtReady.then((api) => {

&#x20; const settings = api.get\_settings();       // 同步返回（唯一仍走返回值通道的接口）

&#x20; api.save\_settings({ theme: "neon" });

&#x20; api.apply\_theme({ theme: "neon" });

&#x20; api.apply\_opacity(0.8);

&#x20; api.chat\_send("你好");

&#x20; api.open\_chat(); / api.hide\_bubble(); ...

&#x20; api.start\_drag();                          // 拖动窗口

&#x20; api.orb\_action("up");                      // 悬浮球方向动作

&#x20; api.quit();

});
```

可用方法（Backend 槽函数，`overlay_windows.py`）：



| 方法                                                                                                                                                  | 参数                         | 返回                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------- |
| `get_settings()`                                                                                                                                    | -                          | 设置结构                                          |
| `save_settings(values)`                                                                                                                             | dict                       | bool                                          |
| `reset_settings()`                                                                                                                                  | -                          | 设置结构                                          |
| `apply_theme(theme)`                                                                                                                                | str/dict                   | -                                             |
| `apply_opacity(opacity)`                                                                                                                            | number/dict                | -                                             |
| `chat_send(text)`                                                                                                                                   | str                        | 任意（chat\_handler 返回值）                         |
| `stop_chat()` | - | -（等待回复时发送按钮变「停止」，点击调用） |
| `start_drag()`                                                                                                                                      | -                          | -                                             |
| `orb_action(direction)`                                                                                                                             | "up"/"down"/"left"/"right" | -                                             |
| `show_menu()`                                                                                                                                       | -                          | -                                             |
| `open_chat` / `hide_chat` / `open_settings` / `hide_settings` / `open_subtitle` / `open_asr` / `hide_bubble` / `hide_all` / `tts_demo` / `asr_demo` | -                          | -                                             |
| `js_log(message)`                                                                                                                                   | str                        | -（JS console 转发到日志，`[JS]` 前缀）                 |
| `request_chat_profiles()`                                                                                                                           | -                          | -（**请求 - 推送**：触发 Python 推送 `setChatProfiles`） |
| `request_active_chat_profile()`                                                                                                                     | -                          | -（触发 Python 推送 `setActiveChatProfile`）        |
| `set_chat_profile(name)`                                                                                                                            | str                        | -（手动切换当前聊天配置，标题下拉框用）                          |
| `quit()`                                                                                                                                            | -                          | -                                             |

> ⚠️ 新接口一律走「请求 - 推送」模式：JS 调用无返回值槽，Python 用 
>
> `send_js`
>
>  推送结果回来。

### 5.2 Python 推送前端（`window.assistant.*`）

前端页面注册的接收方法（由 `send_js` 调用，参数为 JSON payload）：



| 页面              | 方法                                                       | payload 关键字段                                                        |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| button（悬浮球）     | `setTheme`                                               | `{theme}`                                                           |
|                 | `setOrbState`                                            | `{state}`：idle/chat/settings/tts/asr                                |
|                 | `setOrbSize`                                             | `{size}`                                                            |
|                 | `setOrbGradient`                                         | `{start,mid,end}`（自定义渐变，运行时覆盖主题）                                    |
|                 | `setActive`                                              | `{active}`                                                          |
| chat            | `setTheme`                                               | `{theme}`                                                           |
|                 | `onChatMessage`                                          | `{role:"bot", text, done}` / `{role:"bot", error}`（流式增量，text 为累计文本） |
|                 | `onUserMessage`                                             | `{text}`（open_chat(send) 等入口推送的用户消息，显示为用户气泡） |
|                 | `onChatBusy`                                              | `{busy}`（回复期间按钮切换为「停止」，Python 侧入口推送） |
|                 | `setChatTitle`                                           | `{chatName}`                                                        |
|                 | `setChatProfiles`                                        | `{profiles:[{chatName,...}]}`（标题下拉框选项）                              |
|                 | `setActiveChatProfile`                                   | `{chatName}`                                                        |
| settings        | `renderSettings`                                         | `{data}`（设置结构）                                                      |
|                 | `loadSettings` / `setTheme` / `setOpacity` / `setActive` | -                                                                   |
| bubble（字幕 / 识别） | `setMode`                                                | `{mode}`：subtitle/asr                                               |
|                 | `onTtsSentence`                                          | `{text,index}`                                                      |
|                 | `onTtsIdle`                                              | -                                                                   |
|                 | `onAsrState`                                             | `{state}`                                                           |
|                 | `onAsrPartial`                                           | `{text}`                                                            |
|                 | `onAsrFinal`                                             | `{text}`                                                            |
|                 | `setTheme` / `setOpacity`                                | -                                                                   |

> 推送约定：
>
> `send_js(name, payload)`
>
>  会先检查 
>
> `window.assistant.<name>`
>
>  是否为函数，不是则静默跳过。



***

## 6. 实战示例

### 6.1 展示一条字幕（TTS）



```
from overlay import Overlay

overlay = Overlay()

overlay.push\_tts\_text("你好，这是第一条播报", index=0)   # 自动打开字幕气泡

overlay.push\_tts\_text("第二条播报", index=1)

overlay.finish\_tts()                                     # 播报结束

overlay.exec()
```

### 6.2 展示语音识别（ASR）



```
overlay = Overlay()

overlay.set\_asr\_state("listening")      # 红点呼吸 + 波形动效

overlay.push\_asr\_partial("正在识别…")    # 中间结果

overlay.push\_asr\_partial("正在识别…今天")

overlay.push\_asr\_final("今天天气不错")    # 最终结果

overlay.hide\_bubble()

overlay.exec()
```

### 6.3 聊天：接入你自己的 LLM（自定义 chat\_handler）



```
def my\_chat(text):

&#x20;   \# 在这里调用你的 LLM / API，返回 dict 或 None

&#x20;   return {"text": f"你说的是：{text}"}

overlay = Overlay(chat\_handler=my\_chat)

overlay.open\_chat()

overlay.exec()
```

> 不传 
>
> `chat_handler`
>
>  时自动走内置 QwenPaw 对接（见 §9），无需自己实现。

### 6.4 切换主题与外观



```
overlay = Overlay()

overlay.set\_theme("neon")        # flat / neon / synthwave / glass / macaron

overlay.set\_opacity(0.8)         # 四个窗口统一

overlay.save\_settings({"orb\_size": 88})   # 悬浮球大小，立即生效并落盘

overlay.exec()
```

### 6.5 完整 TTS 流程（后台线程推送）



```
import threading, time

from overlay import Overlay

def tts\_worker():

&#x20;   for i, line in enumerate(\["第一句", "第二句", "第三句"]):

&#x20;       overlay.push\_tts\_text(line, index=i)

&#x20;       time.sleep(2)

&#x20;   overlay.finish\_tts()

overlay = Overlay()

threading.Thread(target=tts\_worker, daemon=True).start()   # 线程安全，可后台推送

overlay.open\_subtitle()

overlay.exec()
```

### 6.6 读取设置后展示对应内容



```
from settings\_store import get\_all\_settings

settings = get\_all\_settings()          # 全部设置（分组结构）

theme = settings\[0]\["items"]\[1]\["value"]   # 或按 key 查找

\# 按 key 取：next(i for s in settings for i in s\["items"] if i\["key"] == "theme")\["value"]
```



***

## 7. 常量与范围



| 常量             | 值                                 | 说明                   |
| -------------- | --------------------------------- | -------------------- |
| `ORB_SIZE`     | 68                                | 悬浮球默认直径（设置范围 40\~96） |
| `BUTTON_WIN`   | 120                               | 悬浮球承载窗口（含手势区）        |
| `MARGIN`       | 22                                | 悬浮球距屏幕边缘             |
| `CHAT_W/H`     | 400/620                           | 聊天窗尺寸                |
| `SETTINGS_W/H` | 420/760                           | 设置窗尺寸                |
| `BUBBLE_W/H`   | 340/88                            | 气泡尺寸                 |
| `VALID_THEMES` | flat/neon/synthwave/glass/macaron | 合法主题集合               |



***

## 8. 扩展点



* **聊天消息推送（已实现）**：`web/chat.js` 注册 `window.assistant.onChatMessage`，支持流式增量，payload：


  * `{ role: "bot", text, done: false }`：流式增量（text 为当前累计文本）

  * `{ role: "bot", text, done: true }`：回复结束

  * `{ role: "bot", error }`：出错（等价 done，前端显示错误）

* **聊天标题下拉框（已实现）**：`setChatProfiles` / `setActiveChatProfile` / `setChatTitle`，手动切换当前聊天配置。

* **浏览器 URL 回调（已实现）**：`set_browser_url_provider(fn)` 注册「当前活动页面 URL」获取函数，打开聊天时自动按 URL 匹配聊天配置（见 §9.5）。

* **统一设置接口（已实现）**：`settings_store.get_all_settings()` 一行读取全部设置。

* `setOrbGradient`：悬浮球支持运行时自定义渐变（覆盖主题），适合做 "跟随语音情绪变色" 等效果。

* **窗口回收（已实现）**：弹窗隐藏超 5 分钟自动销毁，省 Chromium 内存；进程调用带 5s 超时防卡死。



***

## 9. QwenPaw 聊天对接（简单聊天）

文件：`qwenpaw_chat.py`。只做简单聊天：`POST /api/console/chat` + SSE 流式，忽略认证 / 多 Agent / Token 管理等复杂功能。

### 9.1 开箱即用（推荐）

`OverlayHost` 未传 `chat_handler` 时自动走内置 QwenPaw 对接，独立进程模式直接可用：



```
from overlay import Overlay

overlay = Overlay()      # 无参 = 独立进程，聊天自动对接 QwenPaw

overlay.open\_chat()

overlay.exec()
```

### 9.2 宿主模式显式接入



```
from overlay import Overlay

from qwenpaw\_chat import create\_chat\_handler

overlay = Overlay(chat\_handler=create\_chat\_handler(lambda: overlay.host))

overlay.open\_chat()

overlay.exec()
```

### 9.3 手动触发



```
from qwenpaw\_chat import start\_chat

start\_chat(overlay.host, "你好")   # 启动后台线程，流式回复推送到聊天窗
```

### 9.4 配置（环境变量，均可省略）



| 变量                   | 默认值                                        | 说明                 |
| -------------------- | ------------------------------------------ | ------------------ |
| `QWENPAW_BASE_URL`   | `http://localhost:8088`                    | QwenPaw 服务根地址      |
| `QWENPAW_AGENT_ID`   | `default`                                  | Agent ID           |
| `QWENPAW_SESSION_ID` | `overlay-<本机IP>`（如 overlay-10.117.116.112） | 会话 ID（固定即可保持多轮上下文） |
| `QWENPAW_USER_ID`    | `overlay-user`                             | 用户 ID              |
| `QWENPAW_TIMEOUT`    | `60`                                       | 单次请求超时秒数           |

> 本地（127.0.0.1）请求自动绕过认证；远程访问需先在实例上启用并配置认证，细节见 
>
> `qwenpaw-API.md`
>
> 。

### 9.5 按浏览器网址匹配聊天配置

设置页「聊天（网址匹配）」可配置多条聊天配置，每条含 6 个字段：



| 字段          | 说明                                         |
| ----------- | ------------------------------------------ |
| `chatName`  | 配置名称（聊天页标题下拉框显示此名）                         |
| `urlRegex`  | 网址匹配正则（`re.search` 匹配当前浏览器活动标签 URL）        |
| `baseUrl`   | 该配置使用的 QwenPaw 服务根地址                       |
| `agentId`   | 该配置使用的 Agent ID                            |
| `ttsTarget` | TTS 定位（预留：页面中该 id 元素出现文本时直接朗读；当前仅配置，未实现朗读） |
| `token`      | QwenPaw Web 认证 Bearer token（`QWENPAW_AUTH_ENABLED=true` 时必填；本地 localhost 可留空） |

**匹配规则：**



* 第一条配置视为默认兜底，不参与匹配；从第二条起按 `urlRegex` 依次匹配

* 命中第一条匹配的配置 → 聊天用该配置的 `baseUrl` / `agentId` 调用 QwenPaw

* 全部未命中 → 使用第一条（默认）配置

* 非法正则自动跳过

**浏览器 URL 来源（可注册回调）：**



```
import qwenpaw\_chat

\# 注册「当前活动页面 URL」获取函数（对接 Chrome 扩展/浏览器接口时用）

qwenpaw\_chat.set\_browser\_url\_provider(lambda: "https://www.baidu.com/s?wd=hello")

url = qwenpaw\_chat.get\_active\_browser\_url()   # 未注册时默认 Mock：https://www.baidu.com/
```

调用链：`open_chat()` → `_refresh_chat_profile()` 按 URL 匹配并缓存 → `chat_send()` → `start_chat()` 使用缓存配置请求 QwenPaw。

**手动切换**：聊天页标题处为下拉框（列出全部 `chatName`），打开时按 URL 自动选中匹配项，用户可手动切换（`set_chat_profile(name)`）。



***

## 10. 外部对接速查（test.py 案例）



```
\# 1) 获取全部设置（含聊天配置列表）

from settings\_store import get\_all\_settings

all\_settings = get\_all\_settings()

\# 2) 注册浏览器 URL 回调（每次打开聊天时触发，按 URL 自动匹配聊天配置）

import qwenpaw\_chat

qwenpaw\_chat.set\_browser\_url\_provider(lambda: "https://www.baidu.com/s?wd=hello")

print("当前页面 URL:", qwenpaw\_chat.get\_active\_browser\_url())
```



***

*生成于 2026-09-16，更新于 2026-09-17・与项目&#x20;*`overlay.py`*&#x20;/&#x20;*`overlay_windows.py`*&#x20;/&#x20;*`overlay_process.py`*&#x20;/&#x20;*`settings_store.py`*&#x20;/&#x20;*`qwenpaw_chat.py`*&#x20;及&#x20;*`web/`*&#x20;前端实现同步。*