"""LLM Float Chrome 扩展 Python SDK（本地 WebSocket 桥 · 服务端）

按 PYTHON-SDK.md 方案 A 实现：Python 起本地 WebSocket 服务，扩展 background 主动连接。
- 命令名 / 事件名 / 参数名与扩展 JS 完全一致（见 PYTHON-SDK.md §0 / §3）
- 用法：FloatSDK().start() 起服务并等待扩展连接，然后调用高层 API / 用 on() 订阅事件

依赖：pip install websockets（内网可拷贝 wheel 离线安装）
"""
import asyncio
import json
import logging

import websockets

log = logging.getLogger("llm_float_sdk")


class FloatSDK:
    """本地 WebSocket 桥服务端：被扩展 background 连接，双向收发 JSON。"""

    def __init__(self, host="127.0.0.1", port=7860):
        self.host = host
        self.port = port
        self._server = None
        self._ext = None                 # 扩展连接（WebSocket）
        self._connected = asyncio.Event()
        self._seq = 0
        self._pending = {}               # 命令 id -> asyncio.Future
        self.handlers = {}               # 事件名 -> [async callback]

    # ---------- 事件订阅（事件名 = JS assistant 方法名，见 PYTHON-SDK.md §3.2） ----------
    def on(self, event):
        def deco(fn):
            self.handlers.setdefault(event, []).append(fn)
            return fn
        return deco

    # ---------- 服务生命周期 ----------
    async def start(self, wait_extension=True, timeout=30):
        async def handler(ws):
            self._ext = ws
            self._connected.set()
            log.info("扩展已连接")
            try:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    if "id" in msg:                     # 响应（命令回执）
                        fut = self._pending.pop(msg["id"], None)
                        if fut and not fut.done():
                            fut.set_result(msg)
                    else:                                # 事件（扩展主动推送）
                        ev = msg.get("event")
                        for fn in self.handlers.get(ev, []):
                            try:
                                await fn(msg.get("data") or {})
                            except Exception as e:
                                log.warning("事件 %s 处理异常: %s", ev, e)
            finally:
                # 仅当仍是本连接时才清理：避免旧连接断开误清新连接的 _ext / _connected 状态（重连竞态）
                if self._ext is ws:
                    self._ext = None
                    self._connected.clear()
                    log.warning("扩展断开连接")

        self._server = await websockets.serve(handler, self.host, self.port)
        log.info("SDK 桥已监听 ws://%s:%s/bridge（等待扩展连接…）", self.host, self.port)
        if wait_extension:
            try:
                await asyncio.wait_for(self._connected.wait(), timeout)
            except asyncio.TimeoutError:
                raise RuntimeError("等待扩展连接超时（请确认扩展已加载并刷新页面）")

    async def close(self):
        if self._ext:
            try:
                await self._ext.close()
            except Exception:
                pass
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    # ---------- 命令（命令名 = JS 函数名 / bridgeHandle case 名） ----------
    async def _call(self, cmd, params=None, timeout=8):
        if not self._ext:
            raise RuntimeError("扩展未连接")
        self._seq += 1
        fut = asyncio.get_event_loop().create_future()
        self._pending[self._seq] = fut
        await self._ext.send(json.dumps({"id": self._seq, "cmd": cmd, "params": params or {}}))
        try:
            resp = await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise TimeoutError("命令 %s 超时" % cmd)
        if not resp.get("ok"):
            raise RuntimeError(resp.get("error") or "unknown error")
        return resp.get("data")

    @staticmethod
    def _params(tabId=None, **kw):
        params = {k: v for k, v in kw.items() if v is not None}
        if tabId is not None:
            params["tabId"] = tabId
        return params

    # ---------- 高层 API（tabId 缺省 = 当前活动页） ----------
    async def ping(self):
        return await self._call("ping")

    async def getTabs(self):
        """列出全部可注入页面 [{id,title,url}]，供多页面演示遍历。"""
        return await self._call("getTabs")

    async def setEnabled(self, enabled=True):
        return await self._call("setEnabled", {"enabled": enabled})

    async def showChat(self, send=None, tabId=None):
        """打开聊天窗；send 非空则在打开的同时发送该消息（并显示在聊天窗内）。"""
        return await self._call("showChat", self._params(tabId, send=send))

    async def hideChat(self, tabId=None):
        return await self._call("hideChat", self._params(tabId))

    async def hideAll(self, tabId=None):
        """一键收起全部弹窗（聊天窗/字幕气泡），只留悬浮球。"""
        return await self._call("hideAll", self._params(tabId))

    async def sendText(self, text, tabId=None):
        return await self._call("sendText", self._params(tabId, text=text))

    async def stopChat(self, tabId=None):
        return await self._call("stopChat", self._params(tabId))

    async def setActiveChatProfile(self, name, tabId=None):
        return await self._call("setActiveChatProfile", self._params(tabId, name=name))

    async def speakText(self, text, tabId=None):
        return await self._call("speakText", self._params(tabId, text=text))

    async def stopSpeak(self, tabId=None):
        return await self._call("stopSpeak", self._params(tabId))

    async def runDemo(self, type, text=None, tabId=None):
        return await self._call("runDemo", self._params(tabId, type=type, text=text))

    async def startAsr(self, tabId=None):
        return await self._call("startAsr", self._params(tabId))

    async def stopAsr(self, tabId=None):
        return await self._call("stopAsr", self._params(tabId))

    async def setAsrText(self, text, tabId=None):
        """驱动流式识别：设置一段中间识别文本（多次调用展示流式效果，自动打开识别气泡）。"""
        return await self._call("setAsrText", self._params(tabId, text=text))

    async def endAsr(self, text=None, tabId=None):
        """结束识别：展示最终识别文本（缺省用最后一次 setAsrText 的文本）并收起气泡。"""
        return await self._call("endAsr", self._params(tabId, text=text))

    async def setTheme(self, theme, tabId=None):
        return await self._call("setTheme", self._params(tabId, theme=theme))

    async def setOrbSize(self, orb_size, tabId=None):
        return await self._call("setOrbSize", self._params(tabId, orb_size=orb_size))

    async def setOrbOpacity(self, orb_opacity, tabId=None):
        return await self._call("setOrbOpacity", self._params(tabId, orb_opacity=orb_opacity))

    async def getState(self, tabId=None):
        """当前 UI 状态快照（字段与 JS/storage 一致，见 PYTHON-SDK.md §3.3）。"""
        return await self._call("getState", self._params(tabId))

    async def getConfig(self):
        return await self._call("getConfig")

    async def setConfig(self, **kw):
        return await self._call("setConfig", kw)


async def _smoke():
    """最小示例：连接后打印当前状态。"""
    sdk = FloatSDK()

    @sdk.on("uiState")
    async def on_state(data):
        print("[UI]", data.get("orb"), data.get("chat"))

    await sdk.start()
    print("当前状态:", await sdk.getState())
    await sdk.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(_smoke())