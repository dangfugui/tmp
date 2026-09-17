"""QwenPaw REST API 简单聊天对接（仅聊天，忽略认证 / 多 Agent / Token 管理等复杂功能）。

对接方式
--------
1. 独立进程模式（最简单）：`Overlay()` 无参创建时，聊天自动走 QwenPaw。
2. 宿主模式：把 `create_chat_handler(host)` 的返回值传给 `Overlay(chat_handler=...)`。
3. 手动触发：`start_chat(host, text)` 启动后台线程请求并流式推送到聊天窗。

配置（环境变量，均可省略）
--------------------------
QWENPAW_BASE_URL   QwenPaw 服务根地址，默认 http://localhost:8088
QWENPAW_AGENT_ID   Agent ID，默认 default
QWENPAW_SESSION_ID 会话 ID，默认 overlay-<本机IP>（固定即可保持多轮上下文）
QWENPAW_USER_ID    用户 ID，默认 overlay-user
QWENPAW_TIMEOUT    单次请求超时秒数，默认 60

线程安全：推送经 host._safe_send（UiScheduler 调度到 UI 线程），可从后台线程直接调用。
"""
import json
import os
import re
import socket
import threading
import urllib.error
import urllib.request

try:
    from .overlay_log import logger
except ImportError:
    from overlay_log import logger

def get_local_ip():
    """获取本机局域网 IP（用于会话标记）；失败时回退 127.0.0.1。"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        return "127.0.0.1"


QWENPAW_BASE_URL = os.environ.get("QWENPAW_BASE_URL", "http://localhost:8088")
QWENPAW_AGENT_ID = os.environ.get("QWENPAW_AGENT_ID", "default")
# 启用 Web 认证时（QWENPAW_AUTH_ENABLED=true，远程访问必填）：
# Authorization: Bearer <token>；本地 localhost 自动跳过认证，可留空
QWENPAW_TOKEN = os.environ.get("QWENPAW_TOKEN", "")
QWENPAW_SESSION_ID = os.environ.get("QWENPAW_SESSION_ID", "overlay-" + get_local_ip())
QWENPAW_USER_ID = os.environ.get("QWENPAW_USER_ID", "overlay-user")
QWENPAW_TIMEOUT = float(os.environ.get("QWENPAW_TIMEOUT", "60"))


def chat_endpoint():
    """主聊天接口地址：POST /api/console/chat（注意 /api 前缀）。"""
    return QWENPAW_BASE_URL.rstrip("/") + "/api/console/chat"


# ---------------------------------------------------------------------------
# 聊天配置（按浏览器网址匹配）
# ---------------------------------------------------------------------------
_browser_url_provider = None  # 可注册的「当前活动页面 URL」回调


def set_browser_url_provider(fn):
    """注册「获取当前浏览器活动标签 URL」的回调函数（如对接 Chrome 扩展）。

    回调约定：无参数，返回字符串 URL；异常时回退 Mock。
    传 None 恢复默认 Mock（https://www.baidu.com/）。
    示例：set_browser_url_provider(lambda: chrome_active_url())  # 后续接真实接口
    """
    global _browser_url_provider
    _browser_url_provider = fn
    logger.info("browser url provider set: %s", getattr(fn, "__name__", "None"))


def get_active_browser_url():
    """获取当前浏览器活动标签的 URL。

    已注册回调则调用回调；未注册（默认）返回 Mock：https://www.baidu.com/。
    """
    provider = _browser_url_provider
    if provider is None:
        return "https://www.baidu.com/"
    try:
        url = provider()
        if isinstance(url, str) and url.strip():
            return url.strip()
        return "https://www.baidu.com/"
    except Exception as exc:
        logger.warning("browser url provider failed: %s", exc)
        return "https://www.baidu.com/"


def match_chat_profile(profiles, url):
    """按 urlRegex 匹配 URL。

    规则：第一条配置视为默认兜底、不参与匹配；从第二条开始依次匹配，
    命中第一个返回；全部未命中返回第一条（默认）；列表为空返回 None。
    """
    if not profiles:
        return None
    default = profiles[0]
    for profile in (profiles[1:] or []):
        pattern = (profile or {}).get("urlRegex") or ""
        if not pattern:
            continue
        try:
            if re.search(pattern, url):
                return profile
        except re.error:
            continue  # 用户输入了非法正则，跳过该条
    return default


def get_active_chat_profile(host):
    """组合：取当前浏览器 URL → 匹配设置里的聊天配置。host 需提供 settings_store。"""
    profiles = host.settings_store.value("chat_profiles") or []
    return match_chat_profile(profiles, get_active_browser_url())


def _response_text(event):
    """从 response 事件的 output 数组提取最终回答文本（跳过 reasoning 消息）。"""
    out = event.get("output")
    items = out if isinstance(out, list) else ([out] if isinstance(out, dict) else [])
    parts = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("object") == "message" and item.get("type") != "reasoning":
            for content in item.get("content") or []:
                if isinstance(content, dict) and content.get("type") == "text" and content.get("text"):
                    parts.append(content["text"])
    return "".join(parts)


def stream_chat(text, on_text, on_done, on_error, base_url=None, agent_id=None, stop_event=None, token=None):
    """阻塞执行一次流式对话（请在后台线程调用）。

    回调约定：
        on_text(累计文本)  收到新的流式增量（携带的是当前累计文本）
        on_done(最终文本)  回复结束（正常完成 / 用户点击停止，按已接收内容收尾）
        on_error(错误信息) 请求失败 / 模型失败

    base_url / agent_id / token：按网址匹配的聊天配置（可省略，省略用模块默认常量）。
    token：启用 QwenPaw Web 认证时的 Bearer token；为空则不携带 Authorization 头（本地可免认证）。
    stop_event：可选 threading.Event；置位后断开 SSE 连接并停止接收（点击「停止」按钮）。
    """
    base_url = (base_url or QWENPAW_BASE_URL).rstrip("/")
    agent_id = agent_id or QWENPAW_AGENT_ID
    token = token or QWENPAW_TOKEN  # 配置留空时回退环境变量
    payload = {
        "input": [{"role": "user", "content": [{"type": "text", "text": text}]}],
        "session_id": QWENPAW_SESSION_ID,
        "user_id": QWENPAW_USER_ID,
        "channel": "console",
    }
    headers = {"Content-Type": "application/json", "X-Agent-Id": agent_id}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(
        base_url + "/api/console/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    # QwenPaw 真实协议：文本以 object="content" 的增量事件下发
    #   delta=true  该片段是新生成部分，需要拼接
    #   delta=false 该 content 的完整文本，直接校准
    # 推理过程（object="message", type="reasoning"）与最终回答共用 content 事件，
    # 通过 msg_id -> message type 映射区分，只显示最终回答，跳过推理。
    accumulated = ""
    msg_types = {}  # msg_id -> "reasoning" | "message"
    try:
        with urllib.request.urlopen(request, timeout=QWENPAW_TIMEOUT) as response:
            for raw in response:
                if stop_event is not None and stop_event.is_set():
                    break  # 用户点击「停止」：断开连接，按已接收内容收尾
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data:
                    continue
                try:
                    event = json.loads(data)
                except ValueError:
                    continue

                if event.get("error"):
                    error = event["error"]
                    message = error.get("message") if isinstance(error, dict) else str(error)
                    logger.error("qwenpaw chat error event: %s", message)
                    on_error(message or "未知错误")
                    return

                obj = event.get("object")
                if obj == "message":
                    mid = event.get("id")
                    if mid:
                        msg_types[mid] = event.get("type") or "message"
                elif obj == "content" and event.get("type") == "text":
                    if msg_types.get(event.get("msg_id")) == "message":
                        text = event.get("text") or ""
                        if event.get("delta") is False:
                            accumulated = text  # 完整文本，校准
                        else:
                            accumulated += text  # 增量片段，拼接
                        on_text(accumulated)
                elif obj == "response" and event.get("status") == "completed":
                    final_text = _response_text(event)
                    if final_text:
                        accumulated = final_text
                    on_done(accumulated)
                    return

        # 流正常结束但未收到 completed（例如服务端直接断开），把已收到的内容交付
        on_done(accumulated)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        logger.error("qwenpaw chat HTTP error: %s %s", exc.code, body[:200])
        on_error("HTTP {}: {}".format(exc.code, body[:200]))
    except Exception as exc:
        logger.exception("qwenpaw chat request failed")
        on_error("连接失败: {}".format(exc))


def start_chat(host, text):
    """启动后台线程向 QwenPaw 请求，并把流式回复推送到聊天窗。

    host: OverlayHost 实例。推送走 host._safe_send（线程安全，自动调度到 UI 线程）。
    """
    def push(payload):
        host._safe_send(host.chat, "onChatMessage", payload)

    def on_text(part):
        push({"role": "bot", "text": part, "done": False})

    def on_done(final_text):
        push({"role": "bot", "text": final_text, "done": True})

    def on_error(message):
        logger.error("qwenpaw chat failed: %s", message)
        push({"role": "bot", "error": message, "done": True})

    # 聊天窗必须已存在才能推送；若尚未创建（极端情况）先补建
    if host.chat is None:
        host.open_chat()
    # 取当前生效的聊天配置（按浏览器网址匹配；无匹配用第一条）
    profile = getattr(host, "_active_chat_profile", None)
    if not profile:
        try:
            profile = get_active_chat_profile(host)
        except Exception:
            profile = None
    base_url = (profile or {}).get("baseUrl") or QWENPAW_BASE_URL
    agent_id = (profile or {}).get("agentId") or QWENPAW_AGENT_ID
    token = (profile or {}).get("token") or QWENPAW_TOKEN
    if profile:
        logger.info("qwenpaw chat profile: %s (%s) -> %s / %s",
                    (profile.get("chatName") or "?"), (profile.get("urlRegex") or "?"), base_url, agent_id)
    logger.info("qwenpaw chat start: %s", text[:50])
    # 停止句柄：前端点「停止」时置位，SSE 循环下一行检测后断开连接
    stop_event = threading.Event()
    host._chat_stop_event = stop_event
    threading.Thread(
        target=stream_chat,
        args=(text, on_text, on_done, on_error, base_url, agent_id, stop_event, token),
        daemon=True,
    ).start()


def stop_chat(host):
    """停止当前正在进行的 QwenPaw 回复（线程安全，幂等）。

    返回 True 表示已请求停止；无进行中的请求或非 QwenPaw 模式返回 False。
    """
    event = getattr(host, "_chat_stop_event", None)
    if event is None:
        logger.info("stop_chat: no active request")
        return False
    event.set()
    logger.info("stop_chat: stop event set")
    return True


def create_chat_handler(host_provider):
    """返回兼容 Overlay(chat_handler=...) 的同步函数。

    host_provider: 可调用对象（返回 OverlayHost），或 OverlayHost 实例。
    handler 只负责启动后台线程并立即返回，不阻塞 WebChannel 调用。
    """
    def handler(text):
        host = host_provider() if callable(host_provider) else host_provider
        if host is None:
            return {"text": ""}
        start_chat(host, text)
        return None
    return handler
