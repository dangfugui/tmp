# LLM Float Chrome 扩展・Python SDK 方案

> 目标：让外部 Python 程序（自动化脚本 / 业务系统 / 服务端）能够
>
> **双向操纵页面上的悬浮球 UI**
>
> ——
> **下行**
>
> ：打开 / 关闭聊天窗、发送消息、朗读文本、启动识别、切换主题与配置；
> **上行**
>
> ：UI 状态变化、聊天回复、
>
> **TTS 逐句内容**
>
> 、
>
> **ASR 识别结果**
>
> 实时回调 Python。
> 扩展核心 UI 不依赖 Python（当前已满足），Python 只作为
>
> **可选的外部控制方**
>
> 。

***

## 0. 命名一致性原则（重要）

SDK 协议**不是另一套命名**，而是 JS 现有代码的**直接映射**：

* **命令名 = JS 桥接函数名**（能复用 content.js/chat.js 现有函数名，就直接用）；

* **事件名 = JS **`window.assistant.*`** 方法名**（iframe 层已有的推送方法名，去掉命名差异）；

* **参数名 = JS 现有字段名**（`text` / `state` / `theme` / `orb_size` / `active_profile_name` / `chat_profiles` 等）。

所以：Python 里写 `sdk.speakText("...")`，和 JS 里 `speakText()`、`window.assistant.onTtsSentence` 是同一件事，**无映射层、无二义**。

***

## 1. 总体架构

```
┌─────────────────────┐      WebSocket (JSON)       ┌──────────────────────────────┐
│   Python 程序        │ ◄─────────────────────────► │  Chrome 扩展                 │
│  ┌───────────────┐   │   ws://127.0.0.1:7860/bridge│  ┌──────────────────────┐    │
│  │ FloatSDK 客户端│   │  命令(下行) →               │  │ background.js        │    │
│  │ (本方案文档)    │   │  事件(上行) ←               │  │  · WS 客户端/重连      │    │
│  └───────────────┘   │  状态快照 ←(getState)       │  │  · 命令路由(见§5)     │    │
│  · 聊天/朗读/识别     │                            │  └─────────┬────────────┘    │
│  · 配置读写           │                            │            │ llm_\* 消息/广播    │
│  · 订阅事件回调       │                            │  ┌─────────▼────────────┐    │
│  · 拉取 UI 状态快照   │                            │  │ content.js (每页面)    │    │
└─────────────────────┘                            │  │  · showChat/hideBubble │    │
                                                    │  │  · speakText/startAsr  │    │
                                                    │  │  · 维护 uiState 并上报  │    │
                                                    │  └─────────┬────────────┘    │
                                                    │            │ postMessage     │
                                                    │  ┌─────────▼────────────┐    │
                                                    │  │ iframe: orb/chat/     │    │
                                                    │  │ bubble（纯 UI，无感知）│    │
                                                    │  └──────────────────────┘    │
                                                    └──────────────────────────────┘
```

* **方向**：Python 起本地 WS 服务（SDK 内置），扩展 background 主动连接。MV3 的 service worker 不能监听端口，所以只能由 Python 当服务端。

* **双向**：Python → 扩展发命令（控制 UI）；扩展 → Python 推事件（UI 状态变化、TTS 逐句内容、ASR 识别结果、聊天回复），并支持 `getState` 随时拉取**全量状态快照**。

* **不依赖 Python**：Python 进程不在时，扩展照常工作（悬浮球、聊天直连 QwenPaw 全部自足）。

***

## 2. 方案对比

| 方案                                | 优点                                                   | 缺点                                                    | 适用           |
| --------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- | ------------ |
| **A. 本地 WebSocket 桥（推荐）**         | 双向实时、不暴露浏览器调试口、内网部署简单（只需 pip 一个库）、与现有 `llm_*` 消息架构一致 | MV3 SW 有休眠，需 alarm 保活 + 自动重连；同一时刻一个 Python 客户端        | 本需求          |
| B. Native Messaging               | 双向、可靠、无端口暴露                                          | 要写 native host 清单 + Windows 注册表，部署步骤多；只服务于本机进程        | 有严格安全要求的本机控制 |
| C. Chrome DevTools Protocol (CDP) | **完全不用改扩展**，直接操纵 DOM                                 | 浏览器必须以 `--remote-debugging-port` 启动；绕开扩展内部状态，耦合页面 DOM | 调试 / 一次性自动化  |

推荐 **A**：改动集中在扩展侧一个桥接模块，SDK 侧一个 Python 文件，内网无外部依赖问题（`websockets` 库拷贝 wheel 即可）。

***

## 3. 通信协议（JSON over WebSocket）

端点：`ws://127.0.0.1:7860/bridge`

### 3.1 命令（Python → 扩展）

> **目标页面**：所有命令支持 `params.tabId` 指定页面（缺省 = 当前活动页）；`getTabs` 先列出全部页面再逐个操作（`demo.py` 演示模式依赖）。

```
{ "id": 1, "cmd": "sendText", "params": { "text": "你好" } }
```

| cmd                    | params                                    | 对应 JS 实现（命名一致）                                                                                 |
| ---------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `setEnabled`           | `{ "enabled": true }`                     | `content.setEnabled()` / 广播 `llm_set_orb_enabled`                                              |
| `showChat`             | `{ "send": "你好" }`（可选）                    | `content.showChat()`；`send` 非空 → `chat.sendText(text)`                                         |
| `hideChat`             | `{}`                                      | `content.hideChat()`                                                                           |
| `sendText`             | `{ "text": "你好" }`                        | `chat.sendText(text)`（新增：显示用户气泡 + `qwenChat`）                                                  |
| `stopChat`             | `{}`                                      | `chat.stopChat()`（新增：等效 `stopSend()`/AbortController）                                          |
| `setActiveChatProfile` | `{ "name": "Qwen" }`                      | 消息 `llm_manual_profile` / `assistant.setActiveChatProfile`                                     |
| `speakText`            | `{ "text": "..." }`                       | `content.speakText(text)`                                                                      |
| `stopSpeak`            | `{}`                                      | `content.stopContentTts()` + `hideBubble()`                                                    |
| `runDemo`              | `{ "type": "tts"\|"asr", "text": "..." }` | `assistant.runDemo(payload)` / 消息 `llm_demo`                                                   |
| `startAsr`             | `{}`                                      | 打开识别气泡并进入聆听（SDK 驱动模式；页面右键仍走真实识别）                                                    |
| `setAsrText`           | `{ "text": "..." }`                      | 驱动流式识别：推送 `onAsrPartial`（多次调用展示中间结果，自动打开气泡）                                              |
| `endAsr`               | `{ "text": "..." }`（可选）                | 结束识别：推送 `onAsrFinal`（缺省用最后一次 setAsrText 文本）+ 收起气泡                                      |
| `stopAsr`              | `{}`                                      | `content.stopAsr()`                                                                            |
| `setTheme`             | `{ "theme": "neon" }`                     | `assistant.setTheme` / storage `theme`                                                         |
| `setOrbSize`           | `{ "orb_size": 72 }`                      | `assistant.setOrbSize` / storage `orb_size`                                                    |
| `setOrbOpacity`        | `{ "orb_opacity": 0.8 }`                  | `assistant.setOpacity` / storage `orb_opacity`                                                 |
| `getState`             | `{}`                                      | 返回 `uiState` 快照（见 §3.3）                                                                        |
| `getConfig`            | `{}`                                      | 读 storage 全部配置（theme/orb_size/orb_opacity/orb_enabled/chat_profiles/active_profile_name） |
| `setConfig`            | `{ "theme": "neon", "orb_size": 72 }`     | 写 storage + 广播 `llm_config_updated`（等效设置页保存）                                                   |
| `ping`                 | `{}`                                      | 保活 / 连通性检查
| `getTabs`             | `{}`                                      | 列出全部可注入页面（http/https）`[{id,title,url}]`，供多页面演示遍历                                                                                     |

**响应**（扩展 → Python，`id` 回填）：

```
{ "id": 1, "ok": true,  "data": { } }
{ "id": 1, "ok": false, "error": "..." }
```

### 3.2 事件（扩展 → Python，主动推送）

```
{ "event": "onChatMessage", "data": { "role": "bot", "text": "...", "done": false } }
```

| event                          | data                                   | 对应 JS 推送点（命名一致）                                                    |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------ |
| `uiState`                      | 见 §3.3 状态快照                            | content 维护的 `uiState` 每次变化                                         |
| `onChatMessage`                | `{ role, text, done }`                 | `chat.js window.assistant.onChatMessage(payload)`（流式 / 结束）         |
| `chatOpened` / `chatClosed`    | `{}`                                   | `content.showChat()` / `hideChat()` 处                              |
| `onTtsSentence`                | `{ text, index, total }`               | `speakText()` 每句 → `pushBubble("onTtsSentence")` 处（新增 index/total） |
| `onTtsIdle`                    | `{}`                                   | 朗读结束（等效 `onTtsIdle`）                                               |
| `onAsrPartial`                 | `{ text }`                             | `content.startAsr()` → `pushBubble("onAsrPartial")` 处              |
| `onAsrFinal`                   | `{ text }`                             | `content.startAsr()` → `pushBubble("onAsrFinal")` 处                |
| `onAsrState`                   | `{ state: "listening"/"idle" }`        | `content.startAsr()/stopAsr()` → `pushBubble("onAsrState")` 处      |
| `orbState`                     | `{ state: "idle"/"chat"/"tts"/"asr" }` | `pushOrb("setOrbState")` 处                                         |
| `bubbleShown` / `bubbleHidden` | `{ mode: "subtitle"/"asr" }`           | `content.showBubble()` / `hideBubble()` 处                          |
| `configChanged`                | `{ keys: ["theme", ...] }`             | 设置页保存 / `setConfig` 后                                              |

> 事件名 = JS 
>
> `window.assistant.*`
>
>  方法名（
>
> `onChatMessage`
>
> /
>
> `onTtsSentence`
>
> /
>
> `onTtsIdle`
>
> /
>
> `onAsrPartial`
>
> /
>
> `onAsrFinal`
>
> /
>
> `onAsrState`
>
>  是
>
> **真实存在的 JS 方法**
>
> ）；
> 新增事件（
>
> `uiState`
>
> /
>
> `orbState`
>
> /
>
> `chatOpened`
>
> /
>
> `bubbleShown`
>
> /
>
> `configChanged`
>
> ）按 JS 驼峰风格命名。

### 3.3 状态模型（双向同步的核心）

**权威源**：扩展侧维护单一 `uiState`（content 每页面一份 + background 合并全局配置），Python 无需自己记状态 ——**随时可拉快照，也可订阅增量事件**。

```
// getState 响应 data / uiState 事件 data（结构一致）
{
  "orb":    { "enabled": true, "state": "idle" },        // idle|chat|tts|asr（与 JS 一致）
  "chat":   { "open": false, "busy": false },            // busy=正在等待回复
  "bubble": { "show": false, "mode": "subtitle" },       // subtitle|asr（与 JS 一致）
  "tts":    { "speaking": false, "current": "" },        // 当前朗读句
  "asr":    { "listening": false },
  // ↓ 以下字段名 = storage key，与 JS 完全一致
  "theme": "flat", "orb_size": 68, "orb_opacity": 1.0,
  "active_profile_name": "Qwen"
}
```

| 字段来源                                                                                 | 说明                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------- |
| 全局配置（theme/orb_size/orb_opacity/orb_enabled/chat_profiles/active_profile_name） | background 直接读 `chrome.storage.local` |
| 页面运行态（orb 状态 / 聊天开合 /busy/ 气泡 / TTS/ASR）                                             | content 维护 `uiState`，每次变化即上报          |

**刷新时机**：任何 UI 状态变化（打开聊天、开始朗读、识别结束、悬浮球切态、设置保存）→ 推送 `uiState`；Python 侧也可随时 `getState` 拉取，保证拿到的一定是当前真实状态。

***

## 4. Python SDK（正式实现，已随实施交付）

**已交付两个文件**（`llm_float\py-sdk\` 目录下）：

| 文件 | 作用 |
| --- | --- |
| `api.py` | SDK 正式实现（顶层 `FloatSDK` 类）——**服务端**：Python 起本地 WS 服务，扩展 background 主动连接 |
| `demo.py` | 演示模式：遍历每个页面，依次展示聊天 / TTS / ASR 效果，每步停留数秒后自动进入下一个页面 |

依赖：仅 `websockets`（`pip install websockets`，内网可拷贝 wheel 离线安装）。

**方法名与 §3.1 命令一一对应**（即与 JS 函数名一致）；所有方法支持 `tabId=` 指定目标页面（缺省 = 当前活动页）。

### 4.1 快速上手

```python
import asyncio
from api import FloatSDK   # 或 sys.path.insert(0, "…/py-sdk") 后 import

async def main():
    sdk = FloatSDK()                       # 默认 ws://127.0.0.1:7860/bridge
    await sdk.start()                      # 起服务并等待扩展连接（30s 超时）

    # 订阅事件（事件名 = JS assistant 方法名，见 §3.2）
    @sdk.on("onTtsSentence")
    async def on_tts(d):
        print("[TTS %s/%s]" % (d.get("index"), d.get("total")), d.get("text"))

    @sdk.on("uiState")
    async def on_state(d):
        print("[UI]", d.get("orb"), d.get("chat"))

    await sdk.setTheme("neon")                       # 全局：所有页面悬浮球变色
    await sdk.showChat(send="你好", tabId=123)        # 指定页面：打开聊天窗并发送
    await sdk.speakText("这是一段语音播报。", tabId=123)
    print(await sdk.getState())                      # 读当前 UI 状态
    await sdk.close()

asyncio.run(main())
```

### 4.2 完整方法清单（= §3.1 命令）

`ping` / `getTabs` / `setEnabled` / `showChat(send=)` / `hideChat` / `sendText` / `stopChat` / `setActiveChatProfile` / `speakText` / `stopSpeak` / `runDemo(type, text=)` / `startAsr` / `setAsrText` / `endAsr` / `stopAsr` / `setTheme` / `setOrbSize` / `setOrbOpacity` / `getState` / `getConfig` / `setConfig(**kw)`

事件：`uiState` / `onChatMessage` / `chatOpened` / `chatClosed` / `onTtsSentence` / `onTtsIdle` / `onAsrPartial` / `onAsrFinal` / `onAsrState` / `orbState` / `bubbleShown` / `bubbleHidden` / `configChanged`

## 5. 扩展侧接入层（已实施 · v0.6.1）

> **自动注入**（v0.6.1 起）：命令到达未注入页面时，background 自动用 `chrome.scripting` 注入 content script（需 `scripting` 权限），演示模式无需手动刷新每个页面；注入失败才会报错。

### 5.1 `background.js` 增加 WS 客户端 + 命令路由

```
// ---- Python 桥（可选：Python 进程不在时扩展完全自足） ----
const PY_BRIDGE_URL = "ws://127.0.0.1:7860/bridge";
let pyWs = null;
function bridgeConnect() {
  try { pyWs = new WebSocket(PY_BRIDGE_URL); } catch (e) { return; }
  pyWs.onopen = () => console.log("[bridge] connected");
  pyWs.onclose = () => setTimeout(bridgeConnect, 3000);   // 自动重连
  pyWs.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; }
    bridgeRoute(m);                                        // 见 5.2
  };
}
function bridgeSend(obj) { if (pyWs && pyWs.readyState === 1) pyWs.send(JSON.stringify(obj)); }
// MV3 SW 休眠保护：每 25s 唤醒一次并 ping，保持桥连接
chrome.alarms.create("py-bridge-keepalive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "py-bridge-keepalive") bridgeSend({ event: "ping" }); });
bridgeConnect();
```

### 5.2 命令路由（cmd 名 = JS 函数名，无需映射表）

```
// background.js bridgeRoute：cmd → 现有机制
async function bridgeRoute(m) {
  const send = (ok, data, error) => bridgeSend({ id: m.id, ok, data, error });
  switch (m.cmd) {
    case "setEnabled": {
      const enabled = m.params.enabled !== false;
      chrome.storage.local.set({ orb_enabled: enabled }, () => {
        chrome.tabs.query({}, (tabs) => tabs.forEach((t) => safeTabSend(t, { type: "llm_set_orb_enabled", enabled })));
        send(true, { enabled });
      });
      break;
    }
    case "setActiveChatProfile":
      chrome.storage.local.set({ active_profile_name: m.params.name || "" }, () => send(true, {}));
      break;
    case "setConfig":
      await chrome.storage.local.set(m.params);
      chrome.tabs.query({}, (tabs) => tabs.forEach((t) => safeTabSend(t, { type: "llm_config_updated" })));
      send(true, {});
      break;
    case "getConfig":
      send(true, await chrome.storage.local.get(["theme", "orb_size", "orb_opacity", "orb_enabled", "chat_profiles", "active_profile_name"]));
      break;
    case "runDemo": {
      const demo = (m.params || {}).type === "asr" ? "asr" : "tts";
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        safeTabSend(tabs && tabs[0], { type: "llm_demo", demo });
        send(true, {});
      });
      break;
    }
    case "getState": {
      // 活动页 content 返回 uiState，合并全局配置
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const cfg = await chrome.storage.local.get(["theme", "orb_size", "orb_opacity", "active_profile_name"]);
      let ui = {};
      if (tab) { try { ui = await chrome.tabs.sendMessage(tab.id, { type: "llm_bridge", cmd: "getState" }); } catch (e) {} }
      send(true, Object.assign({ theme: cfg.theme, orb_size: cfg.orb_size, orb_opacity: cfg.orb_opacity,
                                 active_profile_name: cfg.active_profile_name }, ui));
      break;
    }
    default:
      // 其余命令：转发活动页 content（cmd 名 = content 处理函数名）
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return send(false, null, "no active tab");
        chrome.tabs.sendMessage(tabs[0].id, { type: "llm_bridge", cmd: m.cmd, params: m.params || {} },
          (resp) => send(!!(resp && resp.ok), resp && resp.data, resp && resp.error));
      });
  }
}
```

content.js 新增统一入口（**case 名就是现有函数名**，多个入口共用）：

```
function bridgeHandle(cmd, p = {}) {
  let ok = true, data = null, error = "";
  switch (cmd) {
    case "showChat":   showChat(); if (p.send) pushChat("sendText", { text: p.send }); break;
    case "hideChat":   hideChat(); break;
    case "sendText":   pushChat("sendText", { text: p.text }); break;
    case "stopChat":   pushChat("stopChat", {}); break;
    case "speakText":  speakText(p.text || ""); break;
    case "stopSpeak":  stopContentTts(); hideBubble(); break;
    case "startAsr":   pushOrb("setOrbState", { state: "asr" }); showBubble(); startAsr(); break;
    case "stopAsr":    stopAsr(); hideBubble(); break;
    case "setTheme":   currentTheme = p.theme || currentTheme; pushThemeAll(); break;
    case "setOrbSize": orbSize = p.orb_size || orbSize; pushOrb("setOrbSize", { size: orbSize }); break;
    case "setOrbOpacity": pushOrb("setOpacity", { opacity: p.orb_opacity }); pushBubble("setOpacity", { opacity: p.orb_opacity }); break;
    case "getState":   data = uiState; break;
    default: ok = false; error = "unknown cmd: " + cmd;
  }
  return { ok, data, error };
}
// 入口 1：Python 桥（background 转发 llm_bridge）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "llm_bridge") return;
  sendResponse(bridgeHandle(msg.cmd, msg.params || {}));
});
// 入口 2：页面控制台 / 页面脚本（window.postMessage，见 §5.4）
window.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.kind !== "llm-ctrl") return;
  const r = bridgeHandle(d.cmd, d.params || {});
  window.postMessage({ kind: "llm-ctrl-reply", id: d.id, data: r }, "\*");
});
```

> 注：
>
> `onUserMessage`
>
> /
>
> `onChatBusy`
>
>  在 A 档清理中已从 
>
> `chat.js`
>
>  移除（原 Python 桥死代码）。
> 实施 Python 桥时以
>
> **新活接口**
>
> 加回，命名与命令一致：
> `window.assistant.sendText(text)`
>
> （显示用户气泡 + 
>
> `qwenChat(text)`
>
> ）、
>
> `window.assistant.stopChat()`
>
> （
>
> `stopSend()`
>
> ）。

### 5.3 事件回流（iframe → content → background → Python）

content 已有的 `pushOrb/pushChat/pushBubble` 处同步向 background 转发一次（**事件名 = assistant 方法名**）：

```
function reportToBridge(name, payload) {
  try { chrome.runtime.sendMessage({ type: "llm_bridge_event", name, payload }); } catch (e) {}
}
// background: bridgeSend({ event: name, data: payload });
```

接入点示例（事件名与 iframe 层一致）：

```
// chat.js window.assistant.onChatMessage 内部 → reportToBridge("onChatMessage", payload)
// content speakText() 每句处：
//   reportToBridge("onTtsSentence", { text: 句子, index, total })
// content startAsr() 的 onresult / onend / onerror → reportToBridge("onAsrPartial"|"onAsrFinal"|"onAsrState", ...)
```

**状态快照聚合**（`getState` / `uiState` 的数据来源）：

```
// content.js 侧维护页面运行态（字段与 JS/storage 一致）
let uiState = {
  orb:    { enabled: true, state: "idle" },
  chat:   { open: false, busy: false },
  bubble: { show: false, mode: "subtitle" },
  tts:    { speaking: false, current: "" },
  asr:    { listening: false },
};
function setUi(patch) {
  Object.assign(uiState, patch);
  reportToBridge("uiState", uiState);   // 每次变化推送快照
}
// 例：showChat() 时 setUi({ chat: { open: true, busy: false } })
//     setEnabled() 时 setUi({ orb: { enabled: on } })
//     speakText() 每句：setUi({ tts: { speaking: true, current: 句子 } })
```

### 5.4 页面控制台通道（浏览器 DevTools 直接操作 UI）

不需要 Python、不需要 WS—— 任意页面按 F12 打开控制台即可操作本页悬浮 UI。

content script 监听页面 `window.postMessage`（跨隔离世界可收到），**命令名与 SDK 完全一致**：

```
// 控制台示例（fire-and-forget；getState 结果经 llm-ctrl-reply 回传）
window.postMessage({ kind: "llm-ctrl", cmd: "showChat", params: { send: "你好" } }, "\*");
window.postMessage({ kind: "llm-ctrl", cmd: "speakText", params: { text: "朗读这句" } }, "\*");
window.postMessage({ kind: "llm-ctrl", cmd: "startAsr", params: {} }, "\*");
window.postMessage({ kind: "llm-ctrl", cmd: "getState", params: {} }, "\*");
```

监听代码见 §5.2「入口 2」（与 Python 桥共用 `bridgeHandle`，约 6 行）。

**不装桥也能用的既有通道**（content script 一直在监听，无需任何新代码）：

```
window.postMessage({ kind: "orb", action: "open_chat" }, "\*");   // 打开聊天窗
window.postMessage({ kind: "chat", action: "hide" }, "\*");      // 关闭聊天窗
window.postMessage({ kind: "bubble", action: "demo_done" }, "\*"); // 气泡结束
// 直接给悬浮球 iframe 推配置（assistant 方法名 = 事件名）
document.querySelector(".llm-float-orb-frame").contentWindow
  .postMessage({ kind: "assistant", name: "setTheme", payload: { theme: "neon" } }, "\*");
```

> 边界说明：控制台（页面 main world）与 content script 是隔离 JS 世界，
>
> **不能直接调用 **
>
> `showChat()`
>
> ** 等内部函数**
>
> ；
> 但 
>
> `window.postMessage`
>
>  事件跨世界可达 —— 这就是控制台通道的原理，与 Python SDK 殊途同归（同一组 cmd）。

***

## 6. 部署与运行

1. **Python 侧**：`pip install websockets`（内网：把 `websockets` wheel 拷入内网后 `pip install ./websockets-*.whl`）。

2. **扩展侧**：加载 `chrome/` 目录（`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序，v0.6.0+）。扩展启动后自动尝试连接桥（`ws://127.0.0.1:7860/bridge`），连不上则纯 UI 模式运行，不影响任何功能。

3. **跑起来**（在 `llm_float\py-sdk\` 目录下执行）：
   - `python api.py`：仅起桥服务（SDK 侧；扩展连接后打印当前状态即退出）
   - `python demo.py`：演示模式——切换主题后遍历每个页面，依次展示聊天 / TTS / ASR，每步停留数秒自动进入下一个页面

4. **验证**：Python 端 `await sdk.ping()` 返回 `{ok:true}` 即桥通；随后 `await sdk.getState()` 应能读到当前 UI 真实状态。

## 7. 后续可选

* **多客户端**：扩展端改为 `chrome.sockets` 或本地 UDP 广播，支持多 Python 进程 —— 当前单客户端足够，不做。

* **安全**：桥仅监听 `127.0.0.1`；如需鉴权可加 `token` 首包握手（`chat_profiles` 已有 token 字段可复用）。

* **统一事件源**：现 iframe 事件在 content 层转发即可，不必重构现有消息协议。