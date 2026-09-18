import random
import os
import sys
import threading
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# ---- Linux 输入法兼容（麒麟等）----
# X11 + fcitx：兜底设置 Qt 输入法模块，避免 WebEngine 聊天窗无法切换中文输入法。
# 必须在导入 PySide6 / QtWebEngine 之前设置。Windows 下不生效、无影响。
if sys.platform.startswith("linux"):
    os.environ.setdefault("QT_IM_MODULE", "fcitx")
    os.environ.setdefault("GTK_IM_MODULE", "fcitx")
    os.environ.setdefault("XMODIFIERS", "@im=fcitx")
    if os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland":
        _flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "").strip()
        if "--enable-wayland-ime" not in _flags:
            os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (_flags + " --enable-wayland-ime").strip()

try:
    from .overlay import Overlay
except ImportError:
    from overlay import Overlay


CHAT_REPLIES = [
    "收到～ 目前接的是 Python 侧的 Mock 回复，后面把这里换成真实 LLM 流式接口即可。",
    "好的，我理解你的意思了。需要我把这段内容整理成要点吗？",
    "这个问题可以从三个角度来看：目标、现状、下一步。",
]
TTS_SENTENCES = [
    "好的，我来帮你处理。",
    "首先打开设置页面。",
    "然后在语音识别里选择正确的麦克风。",
    "最后点击开始识别就可以了。",
]
ASR_SENTENCES = ["帮我查一下明天的天气怎么样", "顺便提醒我下午三点开会"]


class App:
    """Example host containing only mock business and demo voice loops."""

    def __init__(self):
        self._tts_stop = threading.Event()
        self._asr_stop = threading.Event()
        self._tts_thread = None
        self._asr_thread = None
        self.overlay = Overlay(
            chat_handler=self.chat_send,
            on_subtitle=self.tts_start,
            on_asr=self.asr_start,
            on_bubble_hide=self.stop_voice,
        )

    def start(self):
        self.overlay.start()

    def chat_send(self, text):
        from qwenpaw_chat import start_chat
        start_chat(self.overlay.host, text)
        return None

    def tts_start(self):
        # 打开字幕播报时停掉识别循环，避免两个线程同时操作气泡窗口
        self.asr_stop()
        if self._tts_thread and self._tts_thread.is_alive():
            return
        self._tts_stop.set()
        self._tts_thread = threading.Thread(target=self._tts_loop, daemon=True)
        self._tts_thread.start()

    def tts_stop(self):
        self._tts_stop.clear()

    def stop_voice(self):
        self.tts_stop()
        self.asr_stop()

    def _tts_loop(self):
        for index, sentence in enumerate(TTS_SENTENCES):
            if not self._tts_stop.is_set():
                break
            self.overlay.push_tts_text(sentence, index)
            time.sleep(2.2)
        self.overlay.finish_tts()

    def asr_start(self):
        # 打开识别时停掉字幕播报循环，避免两个线程同时操作气泡窗口
        self.tts_stop()
        if self._asr_thread and self._asr_thread.is_alive():
            return
        self._asr_stop.set()
        self._asr_thread = threading.Thread(target=self._asr_loop, daemon=True)
        self._asr_thread.start()

    def asr_stop(self):
        self._asr_stop.clear()

    def _asr_loop(self):
        self.overlay.set_asr_state("listening")
        for sentence in ASR_SENTENCES:
            if not self._asr_stop.is_set():
                break
            current = ""
            for char in sentence:
                if not self._asr_stop.is_set():
                    break
                current += char
                self.overlay.push_asr_partial(current)
                time.sleep(0.12)
            if not self._asr_stop.is_set():
                break
            self.overlay.push_asr_final(sentence)
            time.sleep(0.8)
        self._asr_stop.clear()
        self.overlay.set_asr_state("idle")


def main():
    controller = App()
    # QApplication 已在 Overlay 初始化时创建；此时禁用 Qt WebEngine 磁盘缓存，
    # 确保本地页面资源（chat.js/css）每次都是最新
    try:
        from PySide6.QtWebEngineCore import QWebEngineProfile
        QWebEngineProfile.defaultProfile().setHttpCacheType(QWebEngineProfile.NoCache)
    except Exception:
        pass
    controller.start()
    sys.exit(controller.overlay.exec())


if __name__ == "__main__":
    main()
