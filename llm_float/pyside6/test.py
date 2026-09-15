import sys,time

try:
    from .overlay import Overlay
except ImportError:
    from overlay import Overlay


def run_demo():
    # Core API test only: no windows are created and settings are read-only.
    overlay = Overlay(start=True)
    # TTS
    overlay.push_tts_text("Hello, world!", 0)
    time.sleep(1)
    overlay.push_tts_text("你好啊", 0)
    time.sleep(1)
    # ASR
    overlay.set_asr_state("listening")
    time.sleep(1)
    overlay.push_asr_partial("Hello, ")
    time.sleep(1)
    overlay.push_asr_partial("Hello, 你好")
    time.sleep(1)
    overlay.set_asr_state("idle")
    time.sleep(1)
    # Settings
    overlay.open_settings()
    time.sleep(1)
if __name__ == "__main__":
    sys.exit(run_demo())
