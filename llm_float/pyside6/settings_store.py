import copy
import json
import os
import threading


SETTINGS_SCHEMA = [
    {
        "section": "基础",
        "items": [
            {"key": "orb_opacity", "label": "悬浮球透明度", "type": "number", "value": 1.0, "min": 0.2, "max": 1.0, "step": 0.05},
            {"key": "theme", "label": "主题", "type": "select", "value": "flat", "options": [("flat", "极简扁平"), ("neon", "霓虹赛博"), ("synthwave", "复古合成波"), ("glass", "液态玻璃"), ("macaron", "马卡龙奶油")]},
            {"key": "orb_size", "label": "悬浮球大小", "type": "number", "value": 68, "min": 40, "max": 96, "step": 1},
        ],
    },
    {
        "section": "聊天（网址匹配）",
        "items": [
            {"key": "chat_profiles", "label": "", "type": "chat_profiles", "value": [
                {"chatName": "默认", "urlRegex": ".*", "baseUrl": "http://localhost:8088", "agentId": "default", "ttsTarget": "", "token": ""},
            ]},
        ],
    },
    {
        "section": "字幕（TTS）",
        "items": [
            {"key": "tts_lines", "label": "显示行数", "type": "select", "value": "2", "options": [("1", "1"), ("2", "2"), ("3", "3"), ("5", "5")]},
        ],
    },
    {
        "section": "未启用",
        "collapsed": True,
        "items": [
            {"key": "language", "label": "界面语言", "type": "select", "value": "zh", "options": [("zh", "简体中文"), ("en", "English")]},
            {"key": "autostart", "label": "开机自启", "type": "bool", "value": False},
            {"key": "default_mode", "label": "默认打开模式", "type": "select", "value": "chat", "options": [("chat", "聊天"), ("subtitle", "字幕"), ("asr", "识别")]},
            {"key": "base_url", "label": "接口地址 Base URL", "type": "text", "value": "https://api.example.com/v1"},
            {"key": "api_key", "label": "API Key", "type": "password", "value": ""},
            {"key": "model", "label": "模型", "type": "select", "value": "gpt-4o", "options": [("gpt-4o", "gpt-4o"), ("gpt-4o-mini", "gpt-4o-mini"), ("claude-3.5", "claude-3.5"), ("qwen-max", "qwen-max"), ("custom", "自定义")]},
            {"key": "system_prompt", "label": "System Prompt", "type": "textarea", "value": "你是一个有用的桌面助手，回答尽量简洁。"},
            {"key": "temperature", "label": "temperature", "type": "number", "value": 0.7, "min": 0, "max": 2, "step": 0.1},
            {"key": "max_tokens", "label": "单次最大 tokens", "type": "number", "value": 2048, "min": 256, "max": 32768, "step": 256},
            {"key": "context_turns", "label": "上下文轮数", "type": "number", "value": 10, "min": 1, "max": 50, "step": 1},
            {"key": "stream", "label": "流式输出", "type": "bool", "value": True},
            {"key": "tts_font_size", "label": "字号", "type": "number", "value": 18, "min": 12, "max": 40, "step": 1},
            {"key": "tts_max_chars", "label": "每行最大字数", "type": "number", "value": 24, "min": 8, "max": 60, "step": 1},
            {"key": "tts_align", "label": "对齐方式", "type": "select", "value": "center", "options": [("left", "左"), ("center", "居中"), ("right", "右")]},
            {"key": "tts_hold", "label": "单句停留时长(秒)", "type": "number", "value": 3, "min": 1, "max": 20, "step": 1},
            {"key": "tts_auto_hide", "label": "播报结束自动隐藏", "type": "bool", "value": True},
            {"key": "asr_language", "label": "识别语言", "type": "select", "value": "auto", "options": [("auto", "自动"), ("zh", "中文"), ("en", "英文")]},
            {"key": "asr_engine", "label": "识别引擎", "type": "select", "value": "whisper", "options": [("whisper", "Whisper"), ("xfyun", "讯飞"), ("local", "本地模型")]},
            {"key": "asr_sample_rate", "label": "采样率", "type": "select", "value": "16000", "options": [("16000", "16000"), ("44100", "44100")]},
            {"key": "asr_show_interim", "label": "显示中间结果", "type": "bool", "value": True},
            {"key": "asr_silence", "label": "静音自动结束(秒)", "type": "number", "value": 3, "min": 1, "max": 15, "step": 1},
            {"key": "asr_auto_punct", "label": "自动补全标点", "type": "bool", "value": True},
            {"key": "asr_devices", "label": "输入设备", "type": "list", "value": ["默认麦克风"], "options": ["默认麦克风", "麦克风 A", "麦克风 B"]},
            {"key": "hotkey_chat", "label": "唤起聊天", "type": "text", "value": "Ctrl+Alt+Space"},
            {"key": "hotkey_asr", "label": "开始 / 结束识别", "type": "text", "value": "Ctrl+Alt+R"},
            {"key": "log_level", "label": "日志级别", "type": "select", "value": "INFO", "options": [("DEBUG", "DEBUG"), ("INFO", "INFO"), ("WARN", "WARN"), ("ERROR", "ERROR")]},
            {"key": "data_dir", "label": "数据目录", "type": "text", "value": "./data"},
            {"key": "proxy", "label": "代理地址", "type": "text", "value": ""},
            {"key": "features", "label": "启用模块", "type": "list", "value": ["chat", "subtitle"], "options": [("chat", "聊天"), ("subtitle", "字幕"), ("asr", "识别"), ("settings", "设置")]},
        ],
    },
]


def get_all_settings(base_dir=None):
    """统一接口：读取设置中全部参数（分组 -> 项 -> 当前值/类型/选项）。

    不传 base_dir 默认取项目根（data/settings.json）。
    宿主模式想要内存最新值（未保存的修改）时，直接使用 host.settings_store.get()。
    """
    if base_dir is None:
        base_dir = os.path.dirname(os.path.abspath(__file__))
    return SettingsStore(base_dir).get()


class SettingsStore:
    def __init__(self, base_dir):
        self.base_dir = base_dir
        self.path = os.path.join(base_dir, "data", "settings.json")
        self.values = copy.deepcopy(SETTINGS_SCHEMA)
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self.load()

    def load(self):
        with self._lock:
            try:
                with open(self.path, "r", encoding="utf-8") as fh:
                    saved = json.load(fh)
                if isinstance(saved, dict):
                    for section in self.values:
                        for item in section["items"]:
                            if item["key"] in saved:
                                item["value"] = saved[item["key"]]
            except (OSError, ValueError):
                pass

    def get(self):
        with self._lock:
            return copy.deepcopy(self.values)

    def save(self, updates):
        with self._lock:
            if not isinstance(updates, dict):
                return False
            for section in self.values:
                for item in section["items"]:
                    if item["key"] in updates:
                        item["value"] = updates[item["key"]]
            flat = {item["key"]: item["value"] for section in self.values for item in section["items"]}
            with open(self.path, "w", encoding="utf-8") as fh:
                json.dump(flat, fh, ensure_ascii=False, indent=2)
            return True

    def reset(self):
        # 只重置内存中的值（UI 立即预览默认效果）；不写盘，
        # 必须点击“保存”才会真正持久化，否则退出后仍按原配置生效。
        with self._lock:
            self.values = copy.deepcopy(SETTINGS_SCHEMA)
        return self.get()

    def value(self, key, default=None):
        with self._lock:
            for section in self.values:
                for item in section["items"]:
                    if item["key"] == key:
                        return item["value"]
            return default
