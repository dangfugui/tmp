import queue

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

try:
    from .overlay_log import logger
except ImportError:
    from overlay_log import logger


def run_overlay_process(commands, responses):
    try:
        from overlay import OverlayHost

        app = QApplication([])
        host = OverlayHost()
        host.start()
        logger.info("overlay process started")
        timer = QTimer()
        timer.timeout.connect(lambda: drain_commands(app, host, commands, responses))
        timer.start(10)
        app.exec()
        logger.info("overlay process exited")
    except Exception:
        logger.exception("overlay process crashed")
        raise


def drain_commands(app, host, commands, responses):
    while True:
        try:
            request_id, name, args = commands.get_nowait()
        except queue.Empty:
            return
        try:
            if name == "quit":
                app.quit()
                result = None
            elif name == "show_pages":
                show_pages(host, app, args[0], args[1])
                result = None
            elif name == "_push_tts_text":
                host._push_tts_text(args[0], args[1])
                result = None
            elif name == "_finish_tts":
                host._safe_send(host.bubble, "onTtsIdle", {})
                result = None
            elif name == "_set_asr_state":
                host._set_asr_state(args[0])
                result = None
            elif name == "_push_asr_partial":
                host._push_asr_partial(args[0])
                result = None
            elif name == "_push_asr_final":
                host._push_asr_final(args[0])
                result = None
            else:
                result = getattr(host, name)(*args)
            responses.put((request_id, None, result))
        except Exception as exc:
            logger.exception("overlay command failed: %s", name)
            responses.put((request_id, repr(exc), None))


def show_pages(host, app, pages, dwell_ms):
    pages = list(pages)

    def show_next():
        if not pages:
            app.quit()
            return
        page = pages.pop(0)
        if page == "chat":
            host.open_chat()
        elif page == "settings":
            host.open_settings()
        elif page == "subtitle":
            host.open_subtitle()
            host._safe_send(host.bubble, "onTtsSentence", {"text": "测试播报文本", "index": 0})
        elif page == "asr":
            host.open_asr()
            host._safe_send(host.bubble, "onAsrState", {"state": "listening"})
            host._safe_send(host.bubble, "onAsrPartial", {"text": "正在识别测试文本"})
        QTimer.singleShot(dwell_ms, show_next)

    show_next()
