import json
import os
import threading
import time

from PySide6.QtCore import QMetaObject, QObject, QTimer, QUrl, Qt, Slot
from PySide6.QtGui import QBitmap, QColor, QPainter, QGuiApplication, QRegion
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QVBoxLayout, QWidget

try:
    from .overlay_log import logger
except ImportError:
    from overlay_log import logger


class UiScheduler(QObject):
    def __init__(self):
        super().__init__()
        self._queue = []
        self._calls = []
        self._lock = threading.Lock()

    @Slot()
    def flush(self):
        while True:
            with self._lock:
                if not self._queue:
                    return
                window, name, payload = self._queue.pop(0)
            try:
                window.send_js(name, payload)
            except RuntimeError:
                logger.exception("UI dispatch failed: %s", name)

    def schedule(self, window, name, payload):
        with self._lock:
            self._queue.append((window, name, payload))
        QMetaObject.invokeMethod(self, "flush", Qt.QueuedConnection)

    @Slot()
    def flush_calls(self):
        with self._lock:
            calls, self._calls = self._calls, []
        for fn in calls:
            try:
                fn()
            except Exception:
                logger.exception("UI call failed")

    def schedule_call(self, fn):
        """把任意函数调度到主线程（UI 线程）执行，线程安全。"""
        with self._lock:
            self._calls.append(fn)
        QMetaObject.invokeMethod(self, "flush_calls", Qt.QueuedConnection)


class Backend(QObject):
    def __init__(self, window):
        super().__init__()
        self.window = window

    @Slot()
    def start_drag(self):
        handle = self.window.windowHandle()
        if handle is not None:
            handle.startSystemMove()

    @Slot()
    def open_chat(self): self.window.host.open_chat()

    @Slot()
    def hide_chat(self): self.window.host.hide_chat()

    @Slot()
    def open_settings(self): self.window.host.open_settings()

    @Slot()
    def hide_settings(self): self.window.host.hide_settings()

    @Slot()
    def open_subtitle(self): self.window.host.open_subtitle()

    @Slot()
    def open_asr(self): self.window.host.open_asr()

    @Slot()
    def hide_bubble(self): self.window.host.hide_bubble()

    @Slot()
    def hide_all(self): self.window.host.hide_all()

    @Slot()
    def tts_demo(self):
        # 先返回，避免在 WebChannel IPC 处理期间同步操作窗口导致死锁
        QTimer.singleShot(0, self.window.host.tts_demo)

    @Slot()
    def asr_demo(self):
        QTimer.singleShot(0, self.window.host.asr_demo)

    @Slot()
    def show_menu(self): self.window.host.show_menu()

    @Slot(str)
    def orb_action(self, direction): self.window.host.orb_action(direction)

    @Slot(result="QVariant")
    def get_settings(self): return self.window.host.get_settings()

    @Slot("QVariant", result=bool)
    def save_settings(self, values): return self.window.host.save_settings(values)

    @Slot(result="QVariant")
    def reset_settings(self): return self.window.host.reset_settings()

    @Slot("QVariant")
    def apply_theme(self, theme): self.window.host.apply_theme(theme)

    @Slot("QVariant")
    def apply_opacity(self, opacity): self.window.host.apply_opacity(opacity)

    @Slot(str, result="QVariant")
    def chat_send(self, text): return self.window.host.chat_send(text)

    @Slot(result=str)
    def get_chat_profile(self):
        profile = getattr(self.window.host, "_active_chat_profile", None) or {}
        return json.dumps(profile, ensure_ascii=False)

    @Slot(result=str)
    def get_chat_profiles(self):
        profiles = self.window.host.settings_store.value("chat_profiles") or []
        logger.info("get_chat_profiles called: %d entries: %s", len(profiles),
                    [p.get("chatName") for p in profiles if isinstance(p, dict)])
        return json.dumps(profiles, ensure_ascii=False)

    @Slot(str)
    def js_log(self, message): logger.info("[JS] %s", message)

    @Slot()
    def request_chat_profiles(self):
        profiles = self.window.host.settings_store.value("chat_profiles") or []
        logger.info("request_chat_profiles: %d entries", len(profiles))
        self.window.send_js("setChatProfiles", {"profiles": profiles})

    @Slot()
    def request_active_chat_profile(self):
        profile = getattr(self.window.host, "_active_chat_profile", None) or {}
        self.window.send_js("setActiveChatProfile", {"profile": profile})

    @Slot(str, result=bool)
    def set_chat_profile(self, name):
        host = self.window.host
        logger.info("set_chat_profile called: %r", name)
        for profile in host.settings_store.value("chat_profiles") or []:
            if (profile or {}).get("chatName") == name:
                host._active_chat_profile = profile
                return True
        return False

    @Slot()
    def quit(self): QApplication.quit()


class WebWindow(QWidget):
    def __init__(self, host, title, url, width, height, shape="rect", size=None, radius=0):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.host = host
        self.shape = shape
        self.shape_size = size
        self.shape_radius = radius
        self.pending_js = []
        self.page_ready = False
        self.setWindowTitle(title)
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WA_NoSystemBackground, True)
        self.setStyleSheet("background: transparent; border: none;")
        self.resize(width, height)
        self.view = QWebEngineView(self)
        self.view.setAttribute(Qt.WA_TranslucentBackground, True)
        self.view.setContextMenuPolicy(Qt.NoContextMenu)
        self.view.page().setBackgroundColor(QColor(0, 0, 0, 0))
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.view)
        self.backend = Backend(self)
        self.channel = QWebChannel(self.view.page())
        self.channel.registerObject("api", self.backend)
        self.view.page().setWebChannel(self.channel)
        self.view.loadFinished.connect(self._page_loaded)
        # 追加时间戳 query，避免 Qt WebEngine 磁盘缓存加载旧版页面资源
        page_url = QUrl.fromLocalFile(url)
        page_url.setQuery("v=" + str(int(time.time() * 1000)))
        self.view.load(page_url)

    def _page_loaded(self, ok):
        self.page_ready = ok
        if not ok:
            logger.error("Web page failed to load: %s", self.view.url().toString())
            return
        self.flush_pending_js()
        for delay in (100, 300, 800, 1500):
            QTimer.singleShot(delay, self.flush_pending_js)

    def send_js(self, name, payload=None):
        payload = payload or {}
        js = (
            "window.setTimeout(function() {"
            f"if (window.assistant && typeof window.assistant.{name} === 'function') "
            f"window.assistant.{name}({json.dumps(payload, ensure_ascii=False)});"
            "}, 0);"
        )
        if not self.page_ready or self.view.page().url().toString() == "about:blank":
            self.pending_js.append(js)
            return
        try:
            self.view.page().runJavaScript(js)
        except RuntimeError:
            logger.exception("JavaScript execution failed: %s", name)
            self.pending_js.append(js)

    def flush_pending_js(self):
        if not self.page_ready:
            return
        pending, self.pending_js = self.pending_js, []
        for js in pending:
            try:
                self.view.page().runJavaScript(js)
            except RuntimeError:
                logger.exception("Pending JavaScript execution failed")
                self.pending_js.append(js)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.apply_mask()

    def apply_mask(self):
        if self.shape == "ellipse":
            diameter = self.shape_size or min(self.width(), self.height())
            x = (self.width() - diameter) // 2
            y = (self.height() - diameter) // 2
            self.setMask(QRegion(x, y, diameter, diameter, QRegion.Ellipse))
        elif self.shape == "rect" and self.shape_radius > 0:
            mask = QBitmap(self.size())
            mask.fill(Qt.color0)
            painter = QPainter(mask)
            painter.setRenderHint(QPainter.Antialiasing)
            painter.setBrush(Qt.color1)
            painter.setPen(Qt.NoPen)
            radius = min(self.shape_radius, self.width() // 2, self.height() // 2)
            painter.drawRoundedRect(0, 0, self.width(), self.height(), radius, radius)
            painter.end()
            self.setMask(mask)
            self.view.setStyleSheet(f"border: 0; border-radius: {self.shape_radius}px; background: transparent;")


def work_area():
    return QGuiApplication.primaryScreen().availableGeometry()
