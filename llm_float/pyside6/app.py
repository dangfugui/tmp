import copy
import json
import os
import random
import sys
import threading
import time

from PySide6.QtCore import QMetaObject, QObject, QTimer, Qt, QUrl, Slot
from PySide6.QtGui import QBitmap, QColor, QCursor, QGuiApplication, QPainter, QRegion
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QMenu, QVBoxLayout, QWidget

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")

ORB_SIZE = 68
BUTTON_WIN = 120
MARGIN = 22
CHAT_W = 400
CHAT_H = 620
SETTINGS_W = 420
SETTINGS_H = 640
BUBBLE_W = 340
BUBBLE_H = 88
CHAT_RADIUS = 16
GAP = 4
TAIL_H = 12
TAIL_W = 26
TAIL_RIGHT = 34

PALETTE = [
    {
        "title": "主色调",
        "colors": ["#49BCCF", "#5BC2D3", "#45C1D6", "#00BCDC", "#40A8BD", "#AEF3FF"],
    },
    {"title": "点缀色", "colors": ["#2C3E50", "#3373B8"]},
    {
        "title": "中性色",
        "colors": [
            "#FFFFFF",
            "#AFAFAF",
            "#848383",
            "#656565",
            "#555555",
            "#525252",
            "#474747",
            "#313131",
            "#282828",
        ],
    },
]

CHAT_REPLIES = [
    "收到～ 目前接的是 Python 侧的 Mock 回复，后面把这里换成真实 LLM 流式接口即可。",
    "好的，我理解你的意思了。需要我把这段内容整理成要点吗？",
    "这个问题可以从三个角度来看：目标、现状、下一步。",
    "（Mock）这条回复由 Python 生成，前端只负责渲染。",
]

TTS_SENTENCES = [
    "好的，我来帮你处理。",
    "首先打开设置页面。",
    "然后在语音识别里选择正确的麦克风。",
    "最后点击开始识别就可以了。",
    "如果还有问题，随时告诉我。",
]

ASR_SENTENCES = [
    "帮我查一下明天的天气怎么样",
    "顺便提醒我下午三点开会",
]

SETTINGS_SCHEMA = [
    {
        "section": "基础",
        "items": [
            {
                "key": "orb_opacity",
                "label": "悬浮球透明度",
                "type": "number",
                "value": 1.0,
                "min": 0.2,
                "max": 1.0,
                "step": 0.05,
            },
            {
                "key": "theme",
                "label": "主题",
                "type": "select",
                "value": "dark",
                "options": [("dark", "深色"), ("blue", "蓝色"), ("light", "浅色")],
            },
            {
                "key": "orb_size",
                "label": "悬浮球大小",
                "type": "number",
                "value": 68,
                "min": 40,
                "max": 96,
                "step": 1,
            },
            {
                "key": "language",
                "label": "界面语言",
                "type": "select",
                "value": "zh",
                "options": [("zh", "简体中文"), ("en", "English")],
            },
            {"key": "autostart", "label": "开机自启", "type": "bool", "value": False},
            {
                "key": "default_mode",
                "label": "默认打开模式",
                "type": "select",
                "value": "chat",
                "options": [("chat", "聊天"), ("subtitle", "字幕"), ("asr", "识别")],
            },
        ],
    },
    {
        "section": "聊天（Agent）",
        "items": [
            {"key": "base_url", "label": "接口地址 Base URL", "type": "text", "value": "https://api.example.com/v1"},
            {"key": "api_key", "label": "API Key", "type": "password", "value": ""},
            {
                "key": "model",
                "label": "模型",
                "type": "select",
                "value": "gpt-4o",
                "options": [
                    ("gpt-4o", "gpt-4o"),
                    ("gpt-4o-mini", "gpt-4o-mini"),
                    ("claude-3.5", "claude-3.5"),
                    ("qwen-max", "qwen-max"),
                    ("custom", "自定义"),
                ],
            },
            {
                "key": "system_prompt",
                "label": "System Prompt",
                "type": "textarea",
                "value": "你是一个有用的桌面助手，回答尽量简洁。",
            },
            {
                "key": "temperature",
                "label": "temperature",
                "type": "number",
                "value": 0.7,
                "min": 0,
                "max": 2,
                "step": 0.1,
            },
            {
                "key": "max_tokens",
                "label": "单次最大 tokens",
                "type": "number",
                "value": 2048,
                "min": 256,
                "max": 32768,
                "step": 256,
            },
            {
                "key": "context_turns",
                "label": "上下文轮数",
                "type": "number",
                "value": 10,
                "min": 1,
                "max": 50,
                "step": 1,
            },
            {"key": "stream", "label": "流式输出", "type": "bool", "value": True},
        ],
    },
    {
        "section": "字幕（TTS）",
        "items": [
            {"key": "tts_font_size", "label": "字号", "type": "number", "value": 18, "min": 12, "max": 40, "step": 1},
            {"key": "tts_max_chars", "label": "每行最大字数", "type": "number", "value": 24, "min": 8, "max": 60, "step": 1},
            {"key": "tts_lines", "label": "显示行数", "type": "select", "value": "2", "options": [("1", "1"), ("2", "2"), ("3", "3"), ("5", "5")]},
            {"key": "tts_align", "label": "对齐方式", "type": "select", "value": "center", "options": [("left", "左"), ("center", "居中"), ("right", "右")]},
            {"key": "tts_hold", "label": "单句停留时长(秒)", "type": "number", "value": 3, "min": 1, "max": 20, "step": 1},
            {"key": "tts_auto_hide", "label": "播报结束自动隐藏", "type": "bool", "value": True},
        ],
    },
    {
        "section": "语音识别（ASR）",
        "items": [
            {"key": "asr_language", "label": "识别语言", "type": "select", "value": "auto", "options": [("auto", "自动"), ("zh", "中文"), ("en", "英文")]},
            {"key": "asr_engine", "label": "识别引擎", "type": "select", "value": "whisper", "options": [("whisper", "Whisper"), ("xfyun", "讯飞"), ("local", "本地模型")]},
            {"key": "asr_sample_rate", "label": "采样率", "type": "select", "value": "16000", "options": [("16000", "16000"), ("44100", "44100")]},
            {"key": "asr_show_interim", "label": "显示中间结果", "type": "bool", "value": True},
            {"key": "asr_silence", "label": "静音自动结束(秒)", "type": "number", "value": 3, "min": 1, "max": 15, "step": 1},
            {"key": "asr_auto_punct", "label": "自动补全标点", "type": "bool", "value": True},
            {"key": "asr_devices", "label": "输入设备", "type": "list", "value": ["默认麦克风"], "options": ["默认麦克风", "麦克风 A", "麦克风 B"]},
        ],
    },
    {
        "section": "快捷键",
        "items": [
            {"key": "hotkey_chat", "label": "唤起聊天", "type": "text", "value": "Ctrl+Alt+Space"},
            {"key": "hotkey_asr", "label": "开始 / 结束识别", "type": "text", "value": "Ctrl+Alt+R"},
        ],
    },
    {
        "section": "高级",
        "items": [
            {"key": "log_level", "label": "日志级别", "type": "select", "value": "INFO", "options": [("DEBUG", "DEBUG"), ("INFO", "INFO"), ("WARN", "WARN"), ("ERROR", "ERROR")]},
            {"key": "data_dir", "label": "数据目录", "type": "text", "value": "./data"},
            {"key": "proxy", "label": "代理地址", "type": "text", "value": ""},
            {"key": "features", "label": "启用模块", "type": "list", "value": ["chat", "subtitle"], "options": [("chat", "聊天"), ("subtitle", "字幕"), ("asr", "识别"), ("settings", "设置")]},
        ],
    },
]


def page(name):
    return os.path.join(WEB_DIR, name)


def work_area():
    return QGuiApplication.primaryScreen().availableGeometry()


class Backend(QObject):
    def __init__(self, window):
        super().__init__()
        self._window = window

    @Slot()
    def start_drag(self):
        handle = self._window.windowHandle()
        if handle is not None:
            handle.startSystemMove()

    @Slot()
    def open_chat(self):
        self._window.app.open_chat()

    @Slot()
    def hide_chat(self):
        self._window.app.hide_chat()

    @Slot()
    def open_settings(self):
        self._window.app.open_settings()

    @Slot()
    def hide_settings(self):
        self._window.app.hide_settings()

    @Slot()
    def open_subtitle(self):
        self._window.app.open_subtitle()

    @Slot()
    def open_asr(self):
        self._window.app.open_asr()

    @Slot()
    def hide_bubble(self):
        self._window.app.hide_bubble()

    @Slot()
    def show_menu(self):
        self._window.app.show_menu()

    @Slot(str)
    def orb_action(self, direction):
        self._window.app.orb_action(direction)

    @Slot(result="QVariant")
    def get_settings(self):
        return self._window.app.get_settings()

    @Slot("QVariant", result=bool)
    def save_settings(self, values):
        return self._window.app.save_settings(values)

    @Slot(result="QVariant")
    def reset_settings(self):
        return self._window.app.reset_settings()

    @Slot("QVariant")
    def apply_theme(self, theme_key):
        self._window.app.apply_theme(theme_key)

    @Slot("QVariant")
    def apply_opacity(self, opacity):
        self._window.app.apply_opacity(opacity)

    @Slot(str, result="QVariant")
    def chat_send(self, text):
        return self._window.app.chat_send(text)

    @Slot()
    def quit(self):
        QApplication.quit()


class WebWindow(QWidget):
    def __init__(self, app, title, url, width, height, shape="rect", size=None, radius=0):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.app = app
        self._shape = shape
        self._shape_size = size
        self._shape_radius = radius
        self._pending_js = []
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
        self.view.loadFinished.connect(self._flush_pending_js)
        self.view.load(QUrl.fromLocalFile(url))

    def send_js(self, fn_name, payload=None):
        payload = payload or {}
        js = (
            f"if (window.assistant && typeof window.assistant.{fn_name} === 'function') "
            f"window.assistant.{fn_name}({json.dumps(payload, ensure_ascii=False)});"
        )
        if self.view and self.view.page() and self.view.page().url().toString() != "about:blank":
            try:
                self.view.page().runJavaScript(js)
            except Exception:
                self._pending_js.append(js)
        else:
            self._pending_js.append(js)

    def _flush_pending_js(self):
        if not self._pending_js:
            return
        pending = self._pending_js
        self._pending_js = []
        for js in pending:
            try:
                self.view.page().runJavaScript(js)
            except Exception:
                self._pending_js.append(js)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._apply_mask()

    def _apply_mask(self):
        if self._shape == "ellipse":
            d = self._shape_size or min(self.width(), self.height())
            x = (self.width() - d) // 2
            y = (self.height() - d) // 2
            self.setMask(QRegion(x, y, d, d, QRegion.Ellipse))
        elif self._shape == "rect" and self._shape_radius > 0:
            mask = QBitmap(self.size())
            mask.fill(Qt.color0)
            painter = QPainter(mask)
            painter.setRenderHint(QPainter.Antialiasing)
            painter.setBrush(Qt.color1)
            painter.setPen(Qt.NoPen)
            radius = min(self._shape_radius, self.width() // 2, self.height() // 2)
            painter.drawRoundedRect(0, 0, self.width(), self.height(), radius, radius)
            painter.end()
            self.setMask(mask)
            self.view.setStyleSheet("border: 0; border-radius: 22px; background: transparent;")


class UiScheduler(QObject):
    def __init__(self):
        super().__init__()
        self._queue = []
        self._lock = threading.Lock()

    @Slot()
    def flush(self):
        while True:
            with self._lock:
                if not self._queue:
                    return
                window, fn_name, payload = self._queue.pop(0)
            try:
                if window is not None:
                    window.send_js(fn_name, payload)
            except Exception:
                pass

    def schedule(self, window, fn_name, payload):
        with self._lock:
            self._queue.append((window, fn_name, payload))
        QMetaObject.invokeMethod(self, "flush", Qt.QueuedConnection)


class App:
    def __init__(self):
        self.orb = None
        self.chat = None
        self.settings = None
        self.bubble = None
        self._active = None
        self._bubble_mode = None
        self._settings_data = copy.deepcopy(SETTINGS_SCHEMA)
        data_dir = os.path.join(BASE_DIR, "data")
        self._settings_data[0]["_data_dir"] = data_dir
        os.makedirs(data_dir, exist_ok=True)
        self._load_settings_from_disk()
        self._tts_stop = threading.Event()
        self._tts_thread = None
        self._asr_stop = threading.Event()
        self._asr_thread = None
        self._ui_scheduler = UiScheduler()

    def _load_settings_from_disk(self):
        try:
            save_path = os.path.join(self._settings_data[0].get("_data_dir", os.path.join(BASE_DIR, "data")), "settings.json")
            if os.path.exists(save_path):
                with open(save_path, "r", encoding="utf-8") as fh:
                    saved = json.load(fh)
                if isinstance(saved, dict):
                    for section in self._settings_data:
                        for item in section["items"]:
                            key = item.get("key")
                            if key in saved:
                                item["value"] = saved[key]
        except Exception:
            pass

    def _save_settings_to_disk(self):
        flat = {}
        for section in self._settings_data:
            for item in section["items"]:
                key = item.get("key")
                if key is not None:
                    flat[key] = item.get("value")
        try:
            data_dir = self._settings_data[0].get("_data_dir", os.path.join(BASE_DIR, "data"))
            os.makedirs(data_dir, exist_ok=True)
            with open(os.path.join(data_dir, "settings.json"), "w", encoding="utf-8") as fh:
                json.dump(flat, fh, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _orb_origin(self, origin=None):
        if origin is not None:
            return origin
        if self.orb is not None:
            try:
                return int(self.orb.x()), int(self.orb.y())
            except Exception:
                pass
        geo = work_area()
        inset = (BUTTON_WIN - ORB_SIZE) // 2
        return (
            geo.x() + geo.width() - BUTTON_WIN - MARGIN + inset,
            geo.y() + geo.height() - BUTTON_WIN - MARGIN + inset,
        )

    def _anchor_above(self, width, content_h, origin=None):
        ox, oy = self._orb_origin(origin)
        inset = (BUTTON_WIN - ORB_SIZE) // 2
        circle_right = ox + inset + ORB_SIZE
        circle_top = oy + inset
        geo = work_area()
        x = min(circle_right - width, geo.x() + geo.width() - width - 4)
        y = max(8, circle_top - GAP - (content_h + TAIL_H))
        return x, y

    def _hide_others(self, keep):
        if keep != "chat" and self.chat is not None:
            self.chat.hide()
        if keep != "settings" and self.settings is not None:
            self.settings.hide()
        if keep != "bubble":
            self.tts_stop()
            self.asr_stop()
            self._bubble_mode = None
            if self.bubble is not None:
                self.bubble.hide()

    def _set_active(self, which):
        self._active = which
        if self.orb is not None:
            self.orb.send_js("setActive", {"active": which is not None})

    def _ensure_chat(self):
        x, y = self._anchor_above(CHAT_W, CHAT_H)
        if self.chat is None:
            self.chat = WebWindow(self, "ai-chat", page("chat.html"), CHAT_W, CHAT_H + TAIL_H, shape="rect", radius=CHAT_RADIUS)
            self.chat.move(x, y)
            QTimer.singleShot(0, lambda: self.chat.send_js("onChatMessage", {"role": "bot", "text": "你好，我是 AI 助手 👋\n默认内容如下，或用悬浮球的上/下/左/右切换聊天、设置、字幕、识别。"}))
            QTimer.singleShot(0, lambda: self.chat.send_js("onPalette", {"groups": PALETTE}))
        else:
            self.chat.move(x, y)
            self.chat.show()

    def _ensure_settings(self):
        x, y = self._anchor_above(SETTINGS_W, SETTINGS_H)
        if self.settings is None:
            self.settings = WebWindow(self, "assistant-settings", page("settings.html"), SETTINGS_W, SETTINGS_H + TAIL_H, shape="rect", radius=CHAT_RADIUS)
            self.settings.move(x, y)
            QTimer.singleShot(100, lambda: self.settings.send_js("renderSettings", {"data": self.get_settings()}))
            QTimer.singleShot(120, lambda: self.settings.send_js("setTheme", {"theme": self._get_current_theme()}))
        else:
            self.settings.move(x, y)
            self.settings.show()
            QTimer.singleShot(100, lambda: self.settings.send_js("renderSettings", {"data": self.get_settings()}))
            QTimer.singleShot(120, lambda: self.settings.send_js("setTheme", {"theme": self._get_current_theme()}))

    def _ensure_bubble(self):
        x, y = self._anchor_above(BUBBLE_W, BUBBLE_H)
        if self.bubble is None:
            self.bubble = WebWindow(self, "assistant-bubble", page("bubble.html"), BUBBLE_W, BUBBLE_H + TAIL_H, shape="rect", radius=28)
            self.bubble.move(x, y)
            QTimer.singleShot(60, lambda: self.bubble.send_js("setMode", {"mode": self._bubble_mode or "subtitle"}))
        else:
            self.bubble.move(x, y)
            self.bubble.show()
            QTimer.singleShot(60, lambda: self.bubble.send_js("setMode", {"mode": self._bubble_mode or "subtitle"}))

    def orb_action(self, direction):
        if direction == "up":
            self.open_chat()
        elif direction == "down":
            self.open_settings()
        elif direction == "left":
            if self._bubble_mode == "subtitle":
                self.hide_bubble()
            else:
                self.open_subtitle()
        elif direction == "right":
            if self._bubble_mode == "asr":
                self.hide_bubble()
            else:
                self.open_asr()

    def open_chat(self):
        self._hide_others("chat")
        self._ensure_chat()
        self._set_active("chat")

    def hide_chat(self):
        if self.chat is not None:
            self.chat.hide()
        if self._active == "chat":
            self._set_active(None)

    def open_settings(self):
        self._hide_others("settings")
        self._ensure_settings()
        self._set_active("settings")

    def hide_settings(self):
        if self.settings is not None:
            self.settings.hide()
        if self._active == "settings":
            self._set_active(None)

    def open_subtitle(self):
        self._hide_others("bubble")
        self._bubble_mode = "subtitle"
        self._ensure_bubble()
        self.bubble.send_js("setMode", {"mode": "subtitle"})
        self.tts_start()
        self._set_active("bubble")

    def open_asr(self):
        self._hide_others("bubble")
        self._bubble_mode = "asr"
        self._ensure_bubble()
        self.bubble.send_js("setMode", {"mode": "asr"})
        self.asr_start()
        self._set_active("bubble")

    def hide_bubble(self):
        self.tts_stop()
        self.asr_stop()
        self._bubble_mode = None
        if self.bubble is not None:
            self.bubble.hide()
        if self._active == "bubble":
            self._set_active(None)

    def show_menu(self):
        menu = QMenu()
        quit_action = menu.addAction("退出")
        if menu.exec(QCursor.pos()) is quit_action:
            QApplication.quit()

    def _get_current_theme(self):
        for section in self._settings_data:
            for item in section["items"]:
                if item.get("key") == "theme":
                    return item.get("value", "dark")
        return "dark"

    def apply_theme(self, theme_key):
        if isinstance(theme_key, dict):
            theme_key = theme_key.get("theme", theme_key.get("value", "dark"))
        if not isinstance(theme_key, str):
            theme_key = "dark"
        theme_key = theme_key.strip() or "dark"
        for window in (self.orb, self.chat, self.settings, self.bubble):
            if window is not None:
                window.send_js("setTheme", {"theme": theme_key})
        if self.orb is not None:
            if theme_key == "blue":
                self.orb.send_js("setOrbGradient", {"start": "#49bccf", "mid": "#63b3e8", "end": "#22d3ee"})
            elif theme_key == "light":
                self.orb.send_js("setOrbGradient", {"start": "#3b82f6", "mid": "#6366f1", "end": "#1d4ed8"})
            else:
                self.orb.send_js("setOrbGradient", {"start": "#6366f1", "mid": "#8b5cf6", "end": "#ec4899"})

    def apply_opacity(self, opacity):
        if isinstance(opacity, dict):
            opacity = opacity.get("opacity", opacity.get("value", 1.0))
        opacity = max(0.2, min(1.0, float(opacity)))
        if self.orb is not None:
            self.orb.setWindowOpacity(opacity)
            self.orb.send_js("setOpacity", {"opacity": opacity})

    def get_settings(self):
        return copy.deepcopy(self._settings_data)

    def save_settings(self, values):
        if isinstance(values, dict):
            items = values.items()
        else:
            items = []
        for section in self._settings_data:
            for item in section["items"]:
                key = item["key"]
                for k, v in items:
                    if k == key:
                        item["value"] = v
                        break
        self._save_settings_to_disk()
        if "theme" in values:
            self.apply_theme({"theme": values["theme"]})
        if "orb_opacity" in values:
            self.apply_opacity({"opacity": values["orb_opacity"]})
        return True

    def reset_settings(self):
        self._settings_data = copy.deepcopy(SETTINGS_SCHEMA)
        data_dir = os.path.join(BASE_DIR, "data")
        self._settings_data[0]["_data_dir"] = data_dir
        os.makedirs(data_dir, exist_ok=True)
        save_path = os.path.join(data_dir, "settings.json")
        if os.path.exists(save_path):
            os.remove(save_path)
        return copy.deepcopy(self._settings_data)

    def chat_send(self, text):
        time.sleep(0.35 + random.random() * 0.4)
        return {"text": random.choice(CHAT_REPLIES)}

    def _safe_send(self, window, fn_name, payload):
        if window is None:
            return
        self._ui_scheduler.schedule(window, fn_name, payload)

    def tts_start(self):
        if self._tts_thread and self._tts_thread.is_alive():
            return
        self._tts_stop.set()
        self._tts_thread = threading.Thread(target=self._tts_loop, daemon=True)
        self._tts_thread.start()

    def tts_stop(self):
        self._tts_stop.clear()

    def _sleep_stoppable(self, stop, seconds):
        deadline = time.time() + seconds
        while time.time() < deadline:
            if not stop.is_set():
                return False
            time.sleep(0.05)
        return True

    def _tts_loop(self):
        stop = self._tts_stop
        index = 0
        while stop.is_set():
            sentence = TTS_SENTENCES[index % len(TTS_SENTENCES)]
            self._safe_send(self.bubble, "onTtsSentence", {"text": sentence, "index": index})
            index += 1
            if not self._sleep_stoppable(stop, 2.2):
                break
        self._safe_send(self.bubble, "onTtsIdle", {})

    def asr_start(self):
        if self._asr_thread and self._asr_thread.is_alive():
            return
        self._asr_stop.set()
        self._asr_thread = threading.Thread(target=self._asr_loop, daemon=True)
        self._asr_thread.start()

    def asr_stop(self):
        self._asr_stop.clear()

    def _asr_loop(self):
        stop = self._asr_stop
        self._safe_send(self.bubble, "onAsrState", {"state": "listening"})
        for sentence in ASR_SENTENCES:
            if not stop.is_set():
                break
            current = ""
            for ch in sentence:
                if not stop.is_set():
                    break
                current += ch
                self._safe_send(self.bubble, "onAsrPartial", {"text": current})
                time.sleep(0.12)
            if not stop.is_set():
                break
            self._safe_send(self.bubble, "onAsrFinal", {"text": sentence})
            if not self._sleep_stoppable(stop, 0.8):
                break
        stop.clear()
        self._safe_send(self.bubble, "onAsrState", {"state": "idle"})


def main():
    QApplication.setAttribute(Qt.AA_ShareOpenGLContexts, True)
    app = QApplication(sys.argv)

    controller = App()
    geo = work_area()
    inset = (BUTTON_WIN - ORB_SIZE) // 2

    orb = WebWindow(controller, "float-button", page("button.html"), BUTTON_WIN, BUTTON_WIN, shape="ellipse", size=ORB_SIZE)
    orb.move(geo.x() + geo.width() - BUTTON_WIN - MARGIN + inset, geo.y() + geo.height() - BUTTON_WIN - MARGIN + inset)
    orb.setWindowOpacity(1.0)
    controller.orb = orb
    orb.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
