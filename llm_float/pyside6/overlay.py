import os
import math
import multiprocessing
import sys

from PySide6.QtCore import QTimer, Qt
from PySide6.QtWidgets import QApplication, QMenu

try:
    from .overlay_log import logger
except ImportError:
    from overlay_log import logger

try:
    from .overlay_process import run_overlay_process
except ImportError:
    from overlay_process import run_overlay_process

try:
    from .overlay_windows import WebWindow, UiScheduler, work_area
    from .settings_store import SettingsStore
except ImportError:
    from overlay_windows import WebWindow, UiScheduler, work_area
    from settings_store import SettingsStore

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
ORB_SIZE, BUTTON_WIN, MARGIN = 68, 120, 22
CHAT_W, CHAT_H = 400, 620
SETTINGS_W, SETTINGS_H = 420, 760
BUBBLE_W, BUBBLE_H = 340, 88
CHAT_RADIUS, SETTINGS_RADIUS, BUBBLE_RADIUS = 20, 18, 22
GAP, TAIL_H = 4, 12
PALETTE = [
    {"title": "主色调", "colors": ["#49BCCF", "#5BC2D3", "#45C1D6", "#00BCDC", "#40A8BD", "#AEF3FF"]},
    {"title": "点缀色", "colors": ["#2C3E50", "#3373B8"]},
    {"title": "中性色", "colors": ["#FFFFFF", "#AFAFAF", "#848383", "#656565", "#555555", "#525252", "#474747", "#313131", "#282828"]},
]

VALID_THEMES = ("flat", "neon", "synthwave", "glass", "macaron")


def page(name):
    return os.path.join(WEB_DIR, name)


class OverlayHost:
    def __init__(self, chat_handler=None, on_subtitle=None, on_asr=None, on_bubble_hide=None):
        self.orb = self.chat = self.settings = self.bubble = None
        self._active = None
        self._bubble_mode = None
        self._active_chat_profile = None
        self.settings_store = SettingsStore(BASE_DIR)
        self._ui_scheduler = UiScheduler()
        # chat_handler 为 None 时，聊天自动走内置 QwenPaw 对接（见 chat_send）
        self.chat_handler = chat_handler
        self.on_subtitle = on_subtitle
        self.on_asr = on_asr
        self.on_bubble_hide = on_bubble_hide
        self._orb_size = int(self.settings_store.value("orb_size", ORB_SIZE))

    def start(self):
        if self.orb is not None:
            return self.orb
        geo = work_area()
        inset = (BUTTON_WIN - self._orb_size) // 2
        self.orb = WebWindow(self, "float-button", page("button.html"), BUTTON_WIN, BUTTON_WIN, shape="ellipse", size=self._orb_size)
        self.orb.move(geo.x() + geo.width() - BUTTON_WIN - MARGIN + inset, geo.y() + geo.height() - BUTTON_WIN - MARGIN + inset)
        self.orb.setWindowOpacity(1.0)
        self.orb.show()
        QTimer.singleShot(200, lambda: self.apply_theme(self.current_theme()))
        QTimer.singleShot(250, lambda: self.apply_opacity(self.settings_store.value("orb_opacity", 1.0)))
        return self.orb

    def _orb_origin(self):
        if self.orb is not None:
            return int(self.orb.x()), int(self.orb.y())
        geo = work_area()
        inset = (BUTTON_WIN - self._orb_size) // 2
        return geo.x() + geo.width() - BUTTON_WIN - MARGIN + inset, geo.y() + geo.height() - BUTTON_WIN - MARGIN + inset

    def _anchor_above(self, width, height):
        ox, oy = self._orb_origin()
        inset = (BUTTON_WIN - self._orb_size) // 2
        geo = work_area()
        return min(ox + inset + self._orb_size - width, geo.x() + geo.width() - width - 4), max(8, oy + inset - GAP - height - TAIL_H)

    def _hide_others(self, keep):
        if keep != "chat" and self.chat is not None: self.chat.hide()
        if keep != "settings" and self.settings is not None: self.settings.hide()
        if keep != "bubble" and self.bubble is not None: self.bubble.hide()
        if keep != "bubble": self._bubble_mode = None

    def _set_active(self, value):
        self._active = value
        if self.orb is not None:
            self.orb.send_js("setActive", {"active": value is not None})
            # Map panel -> orb visual state (four animated states)
            state_map = {
                "chat": "chat",
                "settings": "settings",
                "bubble": "tts" if self._bubble_mode == "subtitle" else "asr",
                None: "idle",
            }
            self.orb.send_js("setOrbState", {"state": state_map.get(value, "idle")})

    def _ensure_chat(self):
        x, y = self._anchor_above(CHAT_W, CHAT_H + TAIL_H)
        if self.chat is None:
            self.chat = WebWindow(self, "ai-chat", page("chat.html"), CHAT_W, CHAT_H + TAIL_H, radius=CHAT_RADIUS)
        self.chat.show()
        self.chat.move(x, y)
        self.chat.send_js("setTheme", {"theme": self.current_theme()})
        profile = self._active_chat_profile or {}
        self.chat.send_js("setChatTitle", {"chatName": profile.get("chatName") or ""})

    def _ensure_settings(self):
        height = min(SETTINGS_H, max(420, work_area().height() - 32))
        x, y = self._anchor_above(SETTINGS_W, height + TAIL_H)
        if self.settings is None:
            self.settings = WebWindow(self, "assistant-settings", page("settings.html"), SETTINGS_W, height + TAIL_H, radius=SETTINGS_RADIUS)
        else: self.settings.resize(SETTINGS_W, height + TAIL_H)
        self.settings.show()
        self.settings.move(x, y)
        self.settings.send_js("renderSettings", {"data": self.get_settings()})
        self.settings.send_js("setTheme", {"theme": self.current_theme()})

    def _ensure_bubble(self):
        x, y = self._anchor_above(BUBBLE_W, BUBBLE_H + TAIL_H)
        if self.bubble is None:
            self.bubble = WebWindow(self, "assistant-bubble", page("bubble.html"), BUBBLE_W, BUBBLE_H + TAIL_H, radius=BUBBLE_RADIUS)
        self.bubble.show()
        self.bubble.move(x, y)
        self.bubble.send_js("setMode", {"mode": self._bubble_mode or "subtitle"})
        self.bubble.send_js("setTheme", {"theme": self.current_theme()})

    def open_chat(self):
        self._refresh_chat_profile()
        self._hide_others("chat")
        self._ensure_chat()
        self._set_active("chat")

    def _refresh_chat_profile(self):
        """打开聊天页时，按当前浏览器 URL（Mock）匹配聊天配置并缓存；无匹配则用第一条。"""
        try:
            from qwenpaw_chat import get_active_chat_profile
            self._active_chat_profile = get_active_chat_profile(self)
            logger.info("active chat profile: %s",
                        (self._active_chat_profile or {}).get("chatName"))
        except Exception as exc:
            logger.warning("refresh chat profile failed: %s", exc)
            self._active_chat_profile = None
    def hide_chat(self):
        if self.chat is not None: self.chat.hide()
        if self._active == "chat": self._set_active(None)
    def open_settings(self): self._hide_others("settings"); self._ensure_settings(); self._set_active("settings")
    def hide_settings(self):
        if self.settings is not None: self.settings.hide()
        if self._active == "settings": self._set_active(None)
    def open_subtitle(self):
        self._hide_others("bubble"); self._bubble_mode = "subtitle"; self._ensure_bubble(); self._set_active("bubble")
        if self.on_subtitle: self.on_subtitle()
    def open_asr(self):
        self._hide_others("bubble"); self._bubble_mode = "asr"; self._ensure_bubble(); self._set_active("bubble")
        if self.on_asr: self.on_asr()
    def hide_bubble(self):
        self._bubble_mode = None
        if self.bubble is not None: self.bubble.hide()
        if self._active == "bubble": self._set_active(None)
        if self.on_bubble_hide: self.on_bubble_hide()
    def hide_all(self):
        """隐藏所有弹窗（聊天/设置/气泡），只保留悬浮球，悬浮球回到静默态。"""
        self._hide_others(None)
        if self._active is not None:
            self._set_active(None)
        if self.on_bubble_hide:
            self.on_bubble_hide()

    def tts_demo(self):
        """打开字幕气泡并推送一条演示字幕。
        分两步执行：先隐藏设置窗（当前 WebChannel IPC 所在窗口），延迟一帧后再显示气泡，
        避免两个 WebEngine 窗口在同一事件循环迭代内同时一隐一显导致渲染进程死锁（null texture）。"""
        self._hide_others(None)
        QTimer.singleShot(80, self._do_tts_demo)

    def _do_tts_demo(self):
        self.open_subtitle()
        self._push_tts_text("这是一条 TTS 演示字幕，文字过长时会自动换行。", index=0)

    def asr_demo(self):
        """打开识别气泡并推送演示识别状态与文本（分步执行，原因同上）。"""
        self._hide_others(None)
        QTimer.singleShot(80, self._do_asr_demo)

    def _do_asr_demo(self):
        self.open_asr()
        self._set_asr_state("listening")
        self._push_asr_partial("正在识别演示语音…")
    def show_menu(self):
        menu = QMenu(); menu.addAction("退出"); menu.exec()
    def orb_action(self, direction):
        actions = {"up": self.open_chat, "down": self.open_settings, "left": self.open_subtitle, "right": self.open_asr}
        if direction in actions: actions[direction]()

    def current_theme(self):
        value = self.settings_store.value("theme", "flat")
        return value if value in VALID_THEMES else "flat"
    def get_settings(self): return self.settings_store.get()
    def save_settings(self, values):
        if not self.settings_store.save(values): return False
        if "theme" in values: self.apply_theme(values["theme"])
        if "orb_opacity" in values: self.apply_opacity(values["orb_opacity"])
        if "orb_size" in values: self.apply_orb_size(values["orb_size"])
        return True
    def reset_settings(self):
        data = self.settings_store.reset(); self.apply_theme("flat"); self.apply_opacity(1.0); self.apply_orb_size(ORB_SIZE); return data
    def apply_theme(self, theme):
        theme = theme.get("theme", "flat") if isinstance(theme, dict) else theme
        theme = theme if theme in VALID_THEMES else "flat"
        for window in (self.orb, self.chat, self.settings, self.bubble):
            if window is not None: window.send_js("setTheme", {"theme": theme})
    def apply_opacity(self, opacity):
        opacity = opacity.get("opacity", 1.0) if isinstance(opacity, dict) else opacity
        opacity = max(0.2, min(1.0, float(opacity)))
        for window in (self.orb, self.chat, self.settings, self.bubble):
            if window is not None:
                window.setWindowOpacity(opacity)

    def apply_orb_size(self, size):
        """按设置重建悬浮球窗口（大小 40-96px），并保持右下角贴边与主题/透明度。"""
        try:
            size = max(40, min(96, int(size)))
        except (TypeError, ValueError):
            size = ORB_SIZE
        self._orb_size = size
        if self.orb is None:
            return
        old = self.orb
        geo = work_area()
        inset = (BUTTON_WIN - self._orb_size) // 2
        self.orb = WebWindow(self, "float-button", page("button.html"), BUTTON_WIN, BUTTON_WIN, shape="ellipse", size=self._orb_size)
        self.orb.move(geo.x() + geo.width() - BUTTON_WIN - MARGIN + inset, geo.y() + geo.height() - BUTTON_WIN - MARGIN + inset)
        self.orb.show()
        self.orb.send_js("setOrbSize", {"size": self._orb_size})
        self.apply_theme(self.current_theme())
        self.apply_opacity(self.settings_store.value("orb_opacity", 1.0))
        if self._active:
            self._set_active(self._active)
        old.deleteLater()
    def chat_send(self, text):
        """聊天消息入口。传入 chat_handler 时交给它处理；否则走内置 QwenPaw 对接。"""
        if self.chat_handler is not None:
            return self.chat_handler(text)
        try:
            from qwenpaw_chat import start_chat
        except Exception as exc:  # 模块加载失败时把错误推给聊天窗，避免静默无响应
            self._safe_send(self.chat, "onChatMessage", {"role": "bot", "error": "加载 QwenPaw 对接模块失败: {}".format(exc), "done": True})
            return None
        start_chat(self, text)
        return None
    def _safe_send(self, window, name, payload):
        if window is not None: self._ui_scheduler.schedule(window, name, payload)

    # ---------- 气泡内容推送（自动换行 + 高度自适应） ----------
    def _measure_text_width(self, text, font_px=17):
        """估算文本在气泡内的渲染宽度（px）。优先 QFontMetrics，失败时按全角/半角估算。"""
        text = str(text)
        try:
            from PySide6.QtGui import QFont, QFontMetrics
            font = QFont("Microsoft YaHei UI", 10)
            font.setPixelSize(font_px)
            return QFontMetrics(font).horizontalAdvance(text)
        except Exception:
            return sum(font_px if ord(c) > 0x2E7F else font_px * 0.5 for c in text)

    def _fit_bubble_height(self, text, max_lines=2):
        """按文本估算行数，自适应调整气泡窗口高度（最多 max_lines 行，超出由 CSS 裁剪）。
        窗口几何调整调度到主线程执行，避免从业务线程或 WebChannel 槽直接操作 QWidget。"""
        if self.bubble is None:
            return
        avail_w = BUBBLE_W - 40                     # 左右 padding 各 20
        advance = self._measure_text_width(text)
        lines = max(1, math.ceil(advance / max(1, avail_w - 8)))
        lines = min(lines, max(1, max_lines))
        target = BUBBLE_H + (lines - 1) * 24 + TAIL_H
        bubble = self.bubble

        def apply_geometry():
            if bubble is None:
                return
            x, y = self._anchor_above(BUBBLE_W, target)
            if (bubble.x(), bubble.y(), bubble.width(), bubble.height()) != (x, y, BUBBLE_W, target):
                bubble.resize(BUBBLE_W, target)
                bubble.move(x, y)

        self._ui_scheduler.schedule_call(apply_geometry)

    def _push_tts_text(self, text, index=None):
        text = str(text)
        # 整个执行体调度到主线程：窗口开合/几何操作不允许在业务线程执行（会导致 Qt 崩溃）
        self._ui_scheduler.schedule_call(lambda: self._push_tts_text_main(text, index))

    def _push_tts_text_main(self, text, index):
        if self.bubble is None or self._bubble_mode != "subtitle":
            self._hide_others("bubble")
            self._bubble_mode = "subtitle"
            self._ensure_bubble()
        try:
            max_lines = int(self.settings_store.value("tts_lines", 2) or 2)
        except (TypeError, ValueError):
            max_lines = 2
        self._fit_bubble_height(text, max_lines=max_lines)
        self._safe_send(self.bubble, "onTtsSentence", {"text": text, "index": index})

    def _set_asr_state(self, state):
        state = str(state)
        self._ui_scheduler.schedule_call(lambda: self._set_asr_state_main(state))

    def _set_asr_state_main(self, state):
        if self.bubble is None or self._bubble_mode != "asr":
            self._hide_others("bubble")
            self._bubble_mode = "asr"
            self._ensure_bubble()
        self._safe_send(self.bubble, "onAsrState", {"state": state})

    def _push_asr_partial(self, text):
        text = str(text)
        self._ui_scheduler.schedule_call(lambda: self._push_asr_partial_main(text))

    def _push_asr_partial_main(self, text):
        if self.bubble is None or self._bubble_mode != "asr":
            self._hide_others("bubble")
            self._bubble_mode = "asr"
            self._ensure_bubble()
        self._fit_bubble_height(text, max_lines=3)
        self._safe_send(self.bubble, "onAsrPartial", {"text": text})

    def _push_asr_final(self, text):
        text = str(text)
        self._ui_scheduler.schedule_call(lambda: self._push_asr_final_main(text))

    def _push_asr_final_main(self, text):
        if self.bubble is None or self._bubble_mode != "asr":
            self._hide_others("bubble")
            self._bubble_mode = "asr"
            self._ensure_bubble()
        self._fit_bubble_height(text, max_lines=3)
        self._safe_send(self.bubble, "onAsrFinal", {"text": text})


class Overlay:
    """Standalone facade for the desktop overlay UI."""

    def __init__(self, host=None, chat_handler=None, on_subtitle=None, on_asr=None, on_bubble_hide=None, start=True):
        self._process = None
        self._commands = None
        self._responses = None
        self._request_id = 0
        self._process_mode = host is None and not any((chat_handler, on_subtitle, on_asr, on_bubble_hide))
        if self._process_mode:
            context = multiprocessing.get_context("spawn")
            self._commands = context.Queue()
            self._responses = context.Queue()
            self._process = context.Process(target=run_overlay_process, args=(self._commands, self._responses))
            self._process.start()
            self._qt_app = None
            return

        self._qt_app = QApplication.instance()
        if host is None:
            if self._qt_app is None:
                QApplication.setAttribute(Qt.AA_ShareOpenGLContexts, True)
                self._qt_app = QApplication(sys.argv)
            self._host = OverlayHost(chat_handler=chat_handler, on_subtitle=on_subtitle, on_asr=on_asr, on_bubble_hide=on_bubble_hide)
            if start:
                self._host.start()
        else:
            self._host = host

    @property
    def host(self):
        return self._host

    def exec(self):
        if self._process_mode:
            self._process.join()
            return self._process.exitcode or 0
        app = self._qt_app or QApplication.instance()
        if app is None:
            raise RuntimeError("QApplication is not available")
        return app.exec()

    def open_chat(self):
        if self._process_mode:
            return self._process_call("open_chat")
        self._host.open_chat()

    def hide_chat(self):
        if self._process_mode:
            return self._process_call("hide_chat")
        self._host.hide_chat()

    def open_settings(self):
        if self._process_mode:
            return self._process_call("open_settings")
        self._host.open_settings()

    def hide_settings(self):
        if self._process_mode:
            return self._process_call("hide_settings")
        self._host.hide_settings()

    def open_subtitle(self):
        if self._process_mode:
            return self._process_call("open_subtitle")
        self._host.open_subtitle()

    def open_asr(self):
        if self._process_mode:
            return self._process_call("open_asr")
        self._host.open_asr()

    def hide_bubble(self):
        if self._process_mode:
            return self._process_call("hide_bubble")
        self._host.hide_bubble()

    def hide_all(self):
        if self._process_mode:
            return self._process_call("hide_all")
        self._host.hide_all()

    def tts_demo(self):
        if self._process_mode:
            return self._process_call("tts_demo")
        self._host.tts_demo()

    def asr_demo(self):
        if self._process_mode:
            return self._process_call("asr_demo")
        self._host.asr_demo()

    def get_settings(self):
        if self._process_mode:
            return self._process_call("get_settings", wait=True)
        return self._host.get_settings()

    def save_settings(self, values):
        if self._process_mode:
            return self._process_call("save_settings", values, wait=True)
        return self._host.save_settings(values)

    def reset_settings(self):
        if self._process_mode:
            return self._process_call("reset_settings", wait=True)
        return self._host.reset_settings()

    def chat_send(self, text):
        if self._process_mode:
            return self._process_call("chat_send", text, wait=True)
        return self._host.chat_send(text)

    def current_theme(self):
        if self._process_mode:
            return self._process_call("current_theme", wait=True)
        return self._host.current_theme()

    def quit(self):
        if self._process_mode:
            self._process_call("quit")
            return
        app = self._qt_app or QApplication.instance()
        if app is not None:
            app.quit()

    def push_tts_text(self, text, index=None):
        if self._process_mode:
            return self._process_call("_push_tts_text", str(text), index)
        self._host._push_tts_text(str(text), index)

    def finish_tts(self):
        if self._process_mode:
            return self._process_call("_finish_tts")
        self._host._safe_send(self._host.bubble, "onTtsIdle", {})

    def set_asr_state(self, state):
        if self._process_mode:
            return self._process_call("_set_asr_state", str(state))
        self._host._set_asr_state(str(state))

    def push_asr_partial(self, text):
        if self._process_mode:
            return self._process_call("_push_asr_partial", str(text))
        self._host._push_asr_partial(str(text))

    def push_asr_final(self, text):
        if self._process_mode:
            return self._process_call("_push_asr_final", str(text))
        self._host._push_asr_final(str(text))

    def set_theme(self, theme):
        if self._process_mode:
            return self._process_call("apply_theme", theme)
        self._host.apply_theme(theme)

    def set_opacity(self, opacity):
        if self._process_mode:
            return self._process_call("apply_opacity", opacity)
        self._host.apply_opacity(opacity)

    def start(self): self._host.start()

    def _process_call(self, name, *args, wait=False):
        self._request_id += 1
        request_id = self._request_id
        self._commands.put((request_id, name, args))
        if not wait:
            return None
        while True:
            response_id, error, result = self._responses.get()
            if response_id != request_id:
                continue
            if error:
                raise RuntimeError(error)
            return result

    def show_pages(self, pages, dwell_ms=2000):
        """Display named pages in a standalone UI process."""
        if self._process_mode:
            self._process_call("show_pages", list(pages), int(dwell_ms))
            return self.exec()
        raise RuntimeError("show_pages requires standalone Overlay()")

    def run_demo(self):
        """Run the built-in visual TTS/ASR demo and exit automatically."""
        QTimer.singleShot(0, self._demo_start)
        return self.exec()

    def _demo_start(self):
        self.open_subtitle()
        self.push_tts_text("Hello, world!", 0)
        QTimer.singleShot(1000, self._demo_second_tts)

    def _demo_second_tts(self):
        self.push_tts_text("你好啊", 1)
        QTimer.singleShot(1000, self._demo_start_asr)

    def _demo_start_asr(self):
        self.open_asr()
        self.set_asr_state("listening")
        QTimer.singleShot(1000, self._demo_push_asr)

    def _demo_push_asr(self):
        self.push_asr_partial("Hello, ")
        QTimer.singleShot(1000, self._demo_open_settings)

    def _demo_open_settings(self):
        self.set_asr_state("idle")
        self.open_settings()
        QTimer.singleShot(3000, self.quit)
