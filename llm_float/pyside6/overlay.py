import os
import multiprocessing
import sys

from PySide6.QtCore import QTimer, Qt
from PySide6.QtWidgets import QApplication, QMenu

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
CHAT_RADIUS, GAP, TAIL_H = 16, 4, 12
PALETTE = [
    {"title": "主色调", "colors": ["#49BCCF", "#5BC2D3", "#45C1D6", "#00BCDC", "#40A8BD", "#AEF3FF"]},
    {"title": "点缀色", "colors": ["#2C3E50", "#3373B8"]},
    {"title": "中性色", "colors": ["#FFFFFF", "#AFAFAF", "#848383", "#656565", "#555555", "#525252", "#474747", "#313131", "#282828"]},
]


def page(name):
    return os.path.join(WEB_DIR, name)


class OverlayHost:
    def __init__(self, chat_handler=None, on_subtitle=None, on_asr=None, on_bubble_hide=None):
        self.orb = self.chat = self.settings = self.bubble = None
        self._active = None
        self._bubble_mode = None
        self.settings_store = SettingsStore(BASE_DIR)
        self._ui_scheduler = UiScheduler()
        self.chat_handler = chat_handler or (lambda text: {"text": text})
        self.on_subtitle = on_subtitle
        self.on_asr = on_asr
        self.on_bubble_hide = on_bubble_hide

    def start(self):
        if self.orb is not None:
            return self.orb
        geo = work_area()
        inset = (BUTTON_WIN - ORB_SIZE) // 2
        self.orb = WebWindow(self, "float-button", page("button.html"), BUTTON_WIN, BUTTON_WIN, shape="ellipse", size=ORB_SIZE)
        self.orb.move(geo.x() + geo.width() - BUTTON_WIN - MARGIN + inset, geo.y() + geo.height() - BUTTON_WIN - MARGIN + inset)
        self.orb.setWindowOpacity(1.0)
        self.orb.show()
        QTimer.singleShot(200, lambda: self.apply_theme(self.current_theme()))
        return self.orb

    def _orb_origin(self):
        if self.orb is not None:
            return int(self.orb.x()), int(self.orb.y())
        geo = work_area()
        inset = (BUTTON_WIN - ORB_SIZE) // 2
        return geo.x() + geo.width() - BUTTON_WIN - MARGIN + inset, geo.y() + geo.height() - BUTTON_WIN - MARGIN + inset

    def _anchor_above(self, width, height):
        ox, oy = self._orb_origin()
        inset = (BUTTON_WIN - ORB_SIZE) // 2
        geo = work_area()
        return min(ox + inset + ORB_SIZE - width, geo.x() + geo.width() - width - 4), max(8, oy + inset - GAP - height - TAIL_H)

    def _hide_others(self, keep):
        if keep != "chat" and self.chat is not None: self.chat.hide()
        if keep != "settings" and self.settings is not None: self.settings.hide()
        if keep != "bubble" and self.bubble is not None: self.bubble.hide()
        if keep != "bubble": self._bubble_mode = None

    def _set_active(self, value):
        self._active = value
        if self.orb is not None: self.orb.send_js("setActive", {"active": value is not None})

    def _ensure_chat(self):
        x, y = self._anchor_above(CHAT_W, CHAT_H + TAIL_H)
        if self.chat is None:
            self.chat = WebWindow(self, "ai-chat", page("chat.html"), CHAT_W, CHAT_H + TAIL_H, radius=CHAT_RADIUS)
            QTimer.singleShot(0, lambda: self.chat.send_js("onChatMessage", {"role": "bot", "text": "你好，我是 AI 助手 👋"}))
            QTimer.singleShot(0, lambda: self.chat.send_js("onPalette", {"groups": PALETTE}))
        self.chat.show()
        self.chat.move(x, y)
        self.chat.send_js("setTheme", {"theme": self.current_theme()})

    def _ensure_settings(self):
        height = min(SETTINGS_H, max(420, work_area().height() - 32))
        x, y = self._anchor_above(SETTINGS_W, height + TAIL_H)
        if self.settings is None:
            self.settings = WebWindow(self, "assistant-settings", page("settings.html"), SETTINGS_W, height + TAIL_H, radius=CHAT_RADIUS)
        else: self.settings.resize(SETTINGS_W, height + TAIL_H)
        self.settings.show()
        self.settings.move(x, y)
        self.settings.send_js("renderSettings", {"data": self.get_settings()})
        self.settings.send_js("setTheme", {"theme": self.current_theme()})

    def _ensure_bubble(self):
        x, y = self._anchor_above(BUBBLE_W, BUBBLE_H + TAIL_H)
        if self.bubble is None:
            self.bubble = WebWindow(self, "assistant-bubble", page("bubble.html"), BUBBLE_W, BUBBLE_H + TAIL_H, radius=28)
        self.bubble.show()
        self.bubble.move(x, y)
        self.bubble.send_js("setMode", {"mode": self._bubble_mode or "subtitle"})
        self.bubble.send_js("setTheme", {"theme": self.current_theme()})

    def open_chat(self): self._hide_others("chat"); self._ensure_chat(); self._set_active("chat")
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
    def show_menu(self):
        menu = QMenu(); menu.addAction("退出"); menu.exec()
    def orb_action(self, direction):
        actions = {"up": self.open_chat, "down": self.open_settings, "left": self.open_subtitle, "right": self.open_asr}
        if direction in actions: actions[direction]()

    def current_theme(self):
        value = self.settings_store.value("theme", "dark")
        return value if value in ("dark", "light") else "dark"
    def get_settings(self): return self.settings_store.get()
    def save_settings(self, values):
        if not self.settings_store.save(values): return False
        if "theme" in values: self.apply_theme(values["theme"])
        if "orb_opacity" in values: self.apply_opacity(values["orb_opacity"])
        return True
    def reset_settings(self):
        data = self.settings_store.reset(); self.apply_theme("dark"); self.apply_opacity(1.0); return data
    def apply_theme(self, theme):
        theme = theme.get("theme", "dark") if isinstance(theme, dict) else theme
        theme = theme if theme in ("dark", "light") else "dark"
        for window in (self.orb, self.chat, self.settings, self.bubble):
            if window is not None: window.send_js("setTheme", {"theme": theme})
    def apply_opacity(self, opacity):
        opacity = opacity.get("opacity", 1.0) if isinstance(opacity, dict) else opacity
        opacity = max(0.2, min(1.0, float(opacity)))
        if self.orb is not None:
            self.orb.setWindowOpacity(opacity); self.orb.send_js("setOpacity", {"opacity": opacity})
    def chat_send(self, text): return self.chat_handler(text)
    def _safe_send(self, window, name, payload):
        if window is not None: self._ui_scheduler.schedule(window, name, payload)


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
        self._host._safe_send(self._host.bubble, "onTtsSentence", {"text": str(text), "index": index})

    def finish_tts(self):
        if self._process_mode:
            return self._process_call("_finish_tts")
        self._host._safe_send(self._host.bubble, "onTtsIdle", {})

    def set_asr_state(self, state):
        if self._process_mode:
            return self._process_call("_set_asr_state", str(state))
        self._host._safe_send(self._host.bubble, "onAsrState", {"state": str(state)})

    def push_asr_partial(self, text):
        if self._process_mode:
            return self._process_call("_push_asr_partial", str(text))
        self._host._safe_send(self._host.bubble, "onAsrPartial", {"text": str(text)})

    def push_asr_final(self, text):
        if self._process_mode:
            return self._process_call("_push_asr_final", str(text))
        self._host._safe_send(self._host.bubble, "onAsrFinal", {"text": str(text)})

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
