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
    overlay.push_asr_partial("Hello, 你好嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻嘻")
    time.sleep(1)
    overlay.set_asr_state("idle")
    time.sleep(1)
    # Settings
    overlay.open_settings()
    time.sleep(1)

    # 案例1：设置 URL 回调（每次点击聊天时触发，获取当前页面 URL）
    import qwenpaw_chat
    qwenpaw_chat.set_browser_url_provider(lambda: "https://www.baidu.com/s?wd=hello")
    print("当前页面 URL:", qwenpaw_chat.get_active_browser_url())

    # 案例2：获取聊天（网址匹配）配置列表，供外部对接取用
    import os
    from settings_store import SettingsStore
    profiles = SettingsStore(os.path.dirname(os.path.abspath(__file__))).value("chat_profiles") or []
    print("聊天配置列表:", profiles)
if __name__ == "__main__":
    sys.exit(run_demo())
