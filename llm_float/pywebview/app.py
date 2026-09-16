import copy
import json
import os
import random
import shutil
import sys
import threading
import time

import webview

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")

# Target: Windows (WebView2) and 银河麒麟 V10 SP1 / x86_64 (X11, UKUI).
# Never hard-code an OS API without an IS_WINDOWS guard + cross-platform fallback.
IS_WINDOWS = sys.platform.startswith("win")
# Optional override on Linux: LLM_FLOAT_GUI=qt|gtk|cef (empty = let pywebview pick)
GUI_BACKEND = os.environ.get("LLM_FLOAT_GUI") or None


def _clear_webview2_cache():
    """Clear WebView2 user data to avoid stale HTML/CSS/JS cache on Windows."""
    if not IS_WINDOWS:
        return
    # Common WebView2 user data locations
    cache_dirs = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WebView2"),
        os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "WebView2"),
        # pywebview default data directory
        os.path.join(BASE_DIR, "webview2_data"),
    ]
    for d in cache_dirs:
        if os.path.isdir(d):
            try:
                shutil.rmtree(d, ignore_errors=True)
                print(f"[cache] cleared: {d}")
            except Exception as e:
                print(f"[cache] failed to clear {d}: {e}")


# Clear cache before any webview window is created
_clear_webview2_cache()

ORB_SIZE = 68
BUTTON_WIN = 120  # Windows enforces a minimum tracking width of ~120px
MARGIN = 22

CHAT_W = 400
CHAT_H = 620
SETTINGS_W = 420
SETTINGS_H = 640
BUBBLE_W = 340
BUBBLE_H = 88
RADIUS = 16

# How panels attach to the orb: a small gap plus a speech-bubble tail that
# points at the orb, so the panel reads as "growing out of" the floating ball.
GAP = 4
TAIL_H = 12
TAIL_W = 26
TAIL_RIGHT = 34  # tail centre distance from the panel's right edge


# --------------------------------------------------------------------------- #
# Mock data (all of it lives on the Python side; the web UI only renders it)   #
# --------------------------------------------------------------------------- #

# Default content shown in the chat window: a colour palette (swatch + code).
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
                "options": [
                    ("dark", "深色"),
                    ("blue", "蓝色"),
                    ("light", "浅色"),
                ],
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
            {
                "key": "base_url",
                "label": "接口地址 Base URL",
                "type": "text",
                "value": "https://api.example.com/v1",
            },
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
            {
                "key": "tts_font_size",
                "label": "字号",
                "type": "number",
                "value": 18,
                "min": 12,
                "max": 40,
                "step": 1,
            },
            {
                "key": "tts_max_chars",
                "label": "每行最大字数",
                "type": "number",
                "value": 24,
                "min": 8,
                "max": 60,
                "step": 1,
            },
            {
                "key": "tts_lines",
                "label": "显示行数",
                "type": "select",
                "value": "2",
                "options": [("1", "1"), ("2", "2"), ("3", "3"), ("5", "5")],
            },
            {
                "key": "tts_align",
                "label": "对齐方式",
                "type": "select",
                "value": "center",
                "options": [("left", "左"), ("center", "居中"), ("right", "右")],
            },
            {
                "key": "tts_hold",
                "label": "单句停留时长(秒)",
                "type": "number",
                "value": 3,
                "min": 1,
                "max": 20,
                "step": 1,
            },
            {
                "key": "tts_auto_hide",
                "label": "播报结束自动隐藏",
                "type": "bool",
                "value": True,
            },
        ],
    },
    {
        "section": "语音识别（ASR）",
        "items": [
            {
                "key": "asr_language",
                "label": "识别语言",
                "type": "select",
                "value": "auto",
                "options": [("auto", "自动"), ("zh", "中文"), ("en", "英文")],
            },
            {
                "key": "asr_engine",
                "label": "识别引擎",
                "type": "select",
                "value": "whisper",
                "options": [
                    ("whisper", "Whisper"),
                    ("xfyun", "讯飞"),
                    ("local", "本地模型"),
                ],
            },
            {
                "key": "asr_sample_rate",
                "label": "采样率",
                "type": "select",
                "value": "16000",
                "options": [("16000", "16000"), ("44100", "44100")],
            },
            {
                "key": "asr_show_interim",
                "label": "显示中间结果",
                "type": "bool",
                "value": True,
            },
            {
                "key": "asr_silence",
                "label": "静音自动结束(秒)",
                "type": "number",
                "value": 3,
                "min": 1,
                "max": 15,
                "step": 1,
            },
            {
                "key": "asr_auto_punct",
                "label": "自动补全标点",
                "type": "bool",
                "value": True,
            },
            {
                "key": "asr_devices",
                "label": "输入设备",
                "type": "list",
                "value": ["默认麦克风"],
                "options": ["默认麦克风", "麦克风 A", "麦克风 B"],
            },
        ],
    },
    {
        "section": "快捷键",
        "items": [
            {
                "key": "hotkey_chat",
                "label": "唤起聊天",
                "type": "text",
                "value": "Ctrl+Alt+Space",
            },
            {
                "key": "hotkey_asr",
                "label": "开始 / 结束识别",
                "type": "text",
                "value": "Ctrl+Alt+R",
            },
        ],
    },
    {
        "section": "高级",
        "items": [
            {
                "key": "log_level",
                "label": "日志级别",
                "type": "select",
                "value": "INFO",
                "options": [
                    ("DEBUG", "DEBUG"),
                    ("INFO", "INFO"),
                    ("WARN", "WARN"),
                    ("ERROR", "ERROR"),
                ],
            },
            {"key": "data_dir", "label": "数据目录", "type": "text", "value": "./data"},
            {"key": "proxy", "label": "代理地址", "type": "text", "value": ""},
            {
                "key": "features",
                "label": "启用模块",
                "type": "list",
                "value": ["chat", "subtitle"],
                "options": [
                    ("chat", "聊天"),
                    ("subtitle", "字幕"),
                    ("asr", "识别"),
                    ("settings", "设置"),
                ],
            },
        ],
    },
]


# --------------------------------------------------------------------------- #
# Geometry helpers                                                             #
# --------------------------------------------------------------------------- #


def get_work_area():
    """Return (left, top, right, bottom) of the usable desktop area.

    Platform order:
      1. Windows: SystemParametersInfoW (avoids the taskbar).
      2. Any OS: tkinter screen size (needs python3-tk on Linux).
      3. Last resort: sane default so the app still starts.
    """
    if IS_WINDOWS:
        try:
            import ctypes
            from ctypes import wintypes

            rect = wintypes.RECT()
            ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0)
            return rect.left, rect.top, rect.right, rect.bottom
        except Exception:
            pass

    try:
        import tkinter as tk

        root = tk.Tk()
        root.withdraw()
        w, h = root.winfo_screenwidth(), root.winfo_screenheight()
        root.destroy()
        return 0, 0, w, h
    except Exception:
        return 0, 0, 1920, 1080


def page(name):
    return os.path.join(WEB_DIR, name)


def apply_shape(window, shape, size=None, radius=0, tail=False):
    """Clip a frameless window to a shape so it has no rectangular background.

    Windows only: WebView2 renders into a WinForms host that paints an opaque
    background, so we clip the form with ``Region`` (using ``TransparencyKey``
    would turn the layered window click-through, killing mouse input).

    On Linux (GTK/Qt backend) ``transparent=True`` works natively, so the
    WebView just stays transparent and the CSS border-radius provides the
    rounded look. Nothing Windows-specific is touched here.

    ``tail=True`` adds a downward speech-bubble tail (for the panels) pointing
    at the orb below; the CSS draws the same tail via ``body::after``.
    """
    if not IS_WINDOWS:
        return window

    def on_loaded():
        try:
            from System import Action
            from System.Drawing import Region
            from System.Drawing.Drawing2D import GraphicsPath

            form = window.native

            def build():
                cs = form.ClientSize
                cw, ch = int(cs.Width), int(cs.Height)
                scale = getattr(form, "_scale", 1.0) or 1.0
                path = GraphicsPath()

                if shape == "ellipse":
                    d = int(round((size or min(cw, ch) / scale) * scale))
                    d = min(d, cw, ch)
                    path.AddEllipse((cw - d) // 2, (ch - d) // 2, d, d)
                else:
                    th = int(round(TAIL_H * scale)) if tail else 0
                    body_h = ch - th
                    r = max(0, int(round(radius * scale)))
                    r = min(r, cw // 2, body_h // 2)
                    path.AddArc(0, 0, 2 * r, 2 * r, 180, 90)
                    path.AddArc(cw - 2 * r, 0, 2 * r, 2 * r, 270, 90)
                    path.AddArc(cw - 2 * r, body_h - 2 * r, 2 * r, 2 * r, 0, 90)
                    path.AddArc(0, body_h - 2 * r, 2 * r, 2 * r, 90, 90)
                    path.CloseFigure()

                    if tail and th > 0:
                        cx = cw - int(round(TAIL_RIGHT * scale))
                        half = int(round(TAIL_W * scale / 2))
                        path.AddLine(cx - half, body_h, cx + half, body_h)
                        path.AddLine(cx + half, body_h, cx, body_h + th)
                        path.AddLine(cx, body_h + th, cx - half, body_h)
                        path.CloseFigure()

                form.Region = Region(path)

            form.Invoke(Action(build))
        except Exception as exc:  # pragma: no cover - platform specific
            print("shape patch failed:", exc)

    window.events.loaded += on_loaded
    return window


# --------------------------------------------------------------------------- #
# A tiny per-window JS bridge (handles "not loaded yet" by queueing)           #
# --------------------------------------------------------------------------- #


class JsBridge:
    def __init__(self):
        self._window = None
        self._loaded = False
        self._pending = []

    def adopt(self, window):
        self._window = window
        window.events.loaded += self._on_loaded
        return self

    def _on_loaded(self):
        self._loaded = True
        pending, self._pending = self._pending, []
        for js in pending:
            self._eval(js)

    def _eval(self, js):
        try:
            self._window.evaluate_js(js)
        except Exception as exc:  # pragma: no cover
            print("evaluate_js failed:", exc)

    def send(self, event, payload=None):
        js = (
            "window.assistant && window.assistant.{0} && "
            "window.assistant.{0}({1})".format(
                event,
                json.dumps(payload if payload is not None else {}, ensure_ascii=False),
            )
        )
        if self._window is None or not self._loaded:
            self._pending.append(js)
        else:
            self._eval(js)

    def show(self):
        if self._window:
            self._window.show()

    def hide(self):
        if self._window:
            self._window.hide()


# --------------------------------------------------------------------------- #
# JS <-> Python API                                                            #
# --------------------------------------------------------------------------- #


class Api:
    def __init__(self, geo):
        self._geo = geo  # (right, bottom)

        # orb window, set from main() so panels can anchor to it
        self._orb = None  # type: webview.Window | None
        self._chat = None  # type: webview.Window | None
        self._settings = None  # type: webview.Window | None
        self._bubble = None  # type: webview.Window | None

        self._orb_js = JsBridge()
        self._chat_js = JsBridge()
        self._settings_js = JsBridge()
        self._bubble_js = JsBridge()

        self._active = None  # which panel is currently shown
        self._bubble_mode = None  # "subtitle" | "asr" | None
        self._settings_data = copy.deepcopy(SETTINGS_SCHEMA)

        data_dir = os.path.join(BASE_DIR, "data")
        self._settings_data[0]["_data_dir"] = data_dir
        os.makedirs(data_dir, exist_ok=True)

        # Load saved settings from file for persistence across restarts.
        # Support both the older nested schema format and the flat key/value JSON
        # format produced by the current UI.
        try:
            save_path = os.path.join(data_dir, "settings.json")
            if os.path.exists(save_path):
                with open(save_path, "r", encoding="utf-8") as f:
                    saved = json.load(f)

                raw = saved if isinstance(saved, dict) else {}
                if isinstance(saved, list):
                    raw = {}
                    for section in saved:
                        for item in section.get("items", []):
                            key = item.get("key")
                            if key is not None:
                                raw[key] = item.get("value")

                for section in self._settings_data:
                    for item in section["items"]:
                        key = item["key"]
                        if key in raw:
                            item["value"] = raw[key]
        except Exception:
            pass

        self._tts_stop = threading.Event()
        self._tts_thread = None
        self._asr_stop = threading.Event()
        self._asr_thread = None

    # ---- window factories ----------------------------------------------- #
    def _make(self, title, name, w, h, x, y, shape="rect", tail=False):
        window = apply_shape(
            webview.create_window(
                title,
                url=page(name),
                js_api=self,
                width=w,
                height=h,
                x=x,
                y=y,
                min_size=(w, h),
                frameless=True,
                easy_drag=False,
                on_top=True,
                transparent=True,
                resizable=False,
                shadow=False,
            ),
            shape=shape,
            size=None if shape != "ellipse" else ORB_SIZE,
            radius=0 if shape == "ellipse" else RADIUS,
            tail=tail,
        )
        return window

    # ---- layout: anchor every panel to the orb --------------------------- #
    def _orb_origin(self, origin=None):
        """Top-left of the orb window, following it if the user dragged it."""
        if origin is not None:
            return origin
        if self._orb is not None:
            try:
                return int(self._orb.x), int(self._orb.y)
            except Exception:
                pass
        right, bottom = self._geo
        inset = (BUTTON_WIN - ORB_SIZE) // 2
        return (
            right - BUTTON_WIN - MARGIN + inset,
            bottom - BUTTON_WIN - MARGIN + inset,
        )

    def _anchor_above(self, width, content_h, origin=None, gap=GAP):
        """Panel sits right above the orb, with a tail pointing at it.

        Anchors to the visible circle (not the 120px window) so the gap stays
        tight and the orb is never covered. ``content_h`` is the panel body
        height without the tail; the window is ``TAIL_H`` taller.
        """
        inset = (BUTTON_WIN - ORB_SIZE) // 2
        ox, oy = self._orb_origin(origin)
        circle_right = ox + inset + ORB_SIZE
        circle_top = oy + inset
        right, _ = self._geo
        x = min(circle_right - width, right - width - 4)
        y = max(8, circle_top - gap - (content_h + TAIL_H))
        return x, y

    # ---- mutual exclusion + live follow ---------------------------------- #
    def _hide_others(self, keep):
        """Only one of chat / settings / bubble may be visible at a time."""
        if keep != "chat":
            self._chat_js.hide()
        if keep != "settings":
            self._settings_js.hide()
        if keep != "bubble":
            self.tts_stop()
            self.asr_stop()
            self._bubble_mode = None
            self._bubble_js.hide()

    def _set_active(self, which):
        """Tell the orb to light up + show matching animation while a panel is attached."""
        self._active = which
        self._orb_js.send("setActive", {"active": which is not None})
        # Map panel -> orb visual state (four animated states)
        state_map = {
            "chat": "chat",
            "settings": "settings",
            "bubble": "tts" if self._bubble_mode == "subtitle" else "asr",
            None: "idle",
        }
        self._orb_js.send("setOrbState", {"state": state_map.get(which, "idle")})

    def apply_theme(self, theme_key):
        """Push setTheme to all window bridges so CSS variables switch."""
        if isinstance(theme_key, dict):
            theme_key = theme_key.get("theme", theme_key.get("value", "dark"))
        if not isinstance(theme_key, str):
            theme_key = "dark"
        theme_key = theme_key.strip() or "dark"

        for bridge in (self._orb_js, self._chat_js, self._settings_js, self._bubble_js):
            bridge.send("setTheme", {"theme": theme_key})
        # also update the orb's gradient per theme
        if theme_key == "blue":
            self._orb_js.send(
                "setOrbGradient",
                {
                    "start": "#49bccf",
                    "mid": "#63b3e8",
                    "end": "#22d3ee",
                },
            )
        elif theme_key == "light":
            self._orb_js.send(
                "setOrbGradient",
                {
                    "start": "#3b82f6",
                    "mid": "#6366f1",
                    "end": "#1d4ed8",
                },
            )
        else:  # dark
            self._orb_js.send(
                "setOrbGradient",
                {
                    "start": "#6366f1",
                    "mid": "#8b5cf6",
                    "end": "#ec4899",
                },
            )

    def apply_opacity(self, opacity):
        """Set the orb window opacity.

        Windows: uses SetLayeredWindowAttributes via ctypes (WS_EX_LAYERED is
        already set by ``transparent=True``).  Clamped to [0.2, 1.0] so the
        window never fully disappears (which would break mouse input).
        Linux: pywebview's ``transparent=True`` already makes the WebView
        background transparent; we just store the value here.
        """
        if isinstance(opacity, dict):
            opacity = opacity.get("opacity", opacity.get("value", 1.0))
        opacity = max(0.2, min(1.0, float(opacity)))
        if not IS_WINDOWS:
            try:
                self._orb.alpha = opacity  # type: ignore[attr-defined]
            except Exception:
                pass
            return
        # Windows path
        try:
            import ctypes

            hwnd = getattr(self._orb, "native", None)
            if hwnd is None:
                return
            hwnd = getattr(hwnd, "Handle", None)
            if hwnd is None:
                return
            ctypes.windll.user32.SetLayeredWindowAttributes(
                hwnd,
                0,
                int(opacity * 255),
                0x00000010,  # LWA_ALPHA
            )
        except Exception:
            pass

    def _on_orb_moved(self, x, y):
        """Keep every already-created panel glued to the orb while dragging."""
        for window, w, content_h in (
            (self._chat, CHAT_W, CHAT_H),
            (self._settings, SETTINGS_W, SETTINGS_H),
            (self._bubble, BUBBLE_W, BUBBLE_H),
        ):
            if window is None:
                continue
            try:
                px, py = self._anchor_above(w, content_h, origin=(int(x), int(y)))
                window.move(px, py)
            except Exception:
                pass

    def _ensure_chat(self):
        x, y = self._anchor_above(CHAT_W, CHAT_H)
        if self._chat is None:
            self._chat = self._make(
                "assistant-chat",
                "chat.html",
                CHAT_W,
                CHAT_H + TAIL_H,
                x,
                y,
                tail=True,
            )
            self._chat_js.adopt(self._chat)
            self._chat_js.send(
                "onChatMessage",
                {
                    "role": "bot",
                    "text": "你好，我是 AI 助手 👋\n默认内容如下，或用悬浮球的上/下/左/右切换聊天、设置、字幕、识别。",
                },
            )
            self._chat_js.send("onPalette", {"groups": PALETTE})
        else:
            self._chat.move(x, y)
            self._chat.show()

    def _ensure_settings(self):
        x, y = self._anchor_above(SETTINGS_W, SETTINGS_H)
        if self._settings is None:
            self._settings = self._make(
                "assistant-settings",
                "settings.html",
                SETTINGS_W,
                SETTINGS_H + TAIL_H,
                x,
                y,
                tail=True,
            )
            self._settings_js.adopt(self._settings)
        else:
            self._settings.move(x, y)
            self._settings.show()

    def _ensure_bubble(self):
        x, y = self._anchor_above(BUBBLE_W, BUBBLE_H)
        if self._bubble is None:
            self._bubble = self._make(
                "assistant-bubble",
                "bubble.html",
                BUBBLE_W,
                BUBBLE_H + TAIL_H,
                x,
                y,
                tail=True,
            )
            self._bubble_js.adopt(self._bubble)
        else:
            self._bubble.move(x, y)
            self._bubble.show()

    # ---- exposed: orb sectors ------------------------------------------- #
    def orb_action(self, direction):
        """Temporary testing hook: the four sectors of the orb.

        up -> chat, down -> settings, left -> subtitle(TTS), right -> ASR.
        Later these will be driven by real wake-word / TTS / ASR events.
        """
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

    def open_settings(self):
        self._hide_others("settings")
        self._ensure_settings()
        self._set_active("settings")

    def open_subtitle(self):
        self._hide_others("bubble")
        self._bubble_mode = "subtitle"
        self._ensure_bubble()
        self._bubble_js.send("setMode", {"mode": "subtitle"})
        self.tts_start()
        self._set_active("bubble")

    def open_asr(self):
        self._hide_others("bubble")
        self._bubble_mode = "asr"
        self._ensure_bubble()
        self._bubble_js.send("setMode", {"mode": "asr"})
        self.asr_start()
        self._set_active("bubble")

    def hide_chat(self):
        self._chat_js.hide()
        if self._active == "chat":
            self._set_active(None)

    def hide_settings(self):
        self._settings_js.hide()
        if self._active == "settings":
            self._set_active(None)

    def hide_bubble(self):
        self.tts_stop()
        self.asr_stop()
        self._bubble_mode = None
        self._bubble_js.hide()
        if self._active == "bubble":
            self._set_active(None)

    def quit(self):
        self._tts_stop.clear()
        self._asr_stop.clear()
        for win in list(webview.windows):
            win.destroy()

    # ---- chat ------------------------------------------------------------ #
    def chat_send(self, text):
        """Return a mock reply. Replace with a real LLM call later."""
        time.sleep(0.35 + random.random() * 0.4)
        return {"text": random.choice(CHAT_REPLIES)}

    # ---- TTS subtitle ---------------------------------------------------- #
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
            self._bubble_js.send("onTtsSentence", {"text": sentence, "index": index})
            index += 1
            if not self._sleep_stoppable(stop, 2.2):
                break
        self._bubble_js.send("onTtsIdle", {})

    # ---- ASR ------------------------------------------------------------- #
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
        self._bubble_js.send("onAsrState", {"state": "listening"})
        for sentence in ASR_SENTENCES:
            if not stop.is_set():
                break
            current = ""
            for ch in sentence:
                if not stop.is_set():
                    break
                current += ch
                self._bubble_js.send("onAsrPartial", {"text": current})
                time.sleep(0.12)
            if not stop.is_set():
                break
            self._bubble_js.send("onAsrFinal", {"text": sentence})
            if not self._sleep_stoppable(stop, 0.8):
                break
        stop.clear()
        self._bubble_js.send("onAsrState", {"state": "idle"})

    # ---- settings -------------------------------------------------------- #
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

        flat = {}
        for section in self._settings_data:
            for item in section["items"]:
                key = item.get("key")
                if key is not None:
                    flat[key] = item.get("value")

        try:
            data_dir = self._settings_data[0].get("_data_dir", os.path.join(BASE_DIR, "data"))
            os.makedirs(data_dir, exist_ok=True)
            save_path = os.path.join(data_dir, "settings.json")
            with open(save_path, "w", encoding="utf-8") as f:
                json.dump(flat, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        return True

    def reset_settings(self):
        self._settings_data = copy.deepcopy(SETTINGS_SCHEMA)
        data_dir = os.path.join(BASE_DIR, "data")
        self._settings_data[0]["_data_dir"] = data_dir
        os.makedirs(data_dir, exist_ok=True)
        save_path = os.path.join(data_dir, "settings.json")
        try:
            if os.path.exists(save_path):
                os.remove(save_path)
        except Exception:
            pass
        return copy.deepcopy(self._settings_data)


# --------------------------------------------------------------------------- #
# Entry point                                                                  #
# --------------------------------------------------------------------------- #


def main():
    _, _, right, bottom = get_work_area()

    api = Api(geo=(right, bottom))

    inset = (BUTTON_WIN - ORB_SIZE) // 2
    # 增加裁剪区域到 80px，给 CSS scale(1.08/1.07) 留出余量，避免动画被裁切
    ORB_CLIP_SIZE = 80
    orb = apply_shape(
        webview.create_window(
            "float-button",
            url=page("button.html"),
            js_api=api,
            width=BUTTON_WIN,
            height=BUTTON_WIN,
            x=right - BUTTON_WIN - MARGIN + inset,
            y=bottom - BUTTON_WIN - MARGIN + inset,
            min_size=(BUTTON_WIN, BUTTON_WIN),
            frameless=True,
            easy_drag=False,
            on_top=True,
            transparent=True,
            resizable=False,
            shadow=False,
        ),
        shape="ellipse",
        size=ORB_CLIP_SIZE,
    )
    api._orb = orb  # panels anchor to the orb and follow it when dragged
    api._orb_js.adopt(orb)
    # keep any open panel glued to the orb while the orb is being dragged
    orb.events.moved += lambda x, y: api._on_orb_moved(x, y)

    webview.start(debug=True, gui=GUI_BACKEND,
                  # Disable WebView2 cache for development
                  storage_path=os.path.join(BASE_DIR, "webview2_data"),
                  http_port=0)  # type: ignore[arg-type]


if __name__ == "__main__":
    main()
