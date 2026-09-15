import copy
import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_PATH = os.path.join(ROOT, "pywebview", "app.py")

spec = importlib.util.spec_from_file_location("llm_float_pywebview_app", APP_PATH)
app_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app_mod)


def test_save_settings_persists_as_flat_mapping(tmp_path):
    api = app_mod.Api(geo=(100, 100))
    api._settings_data = copy.deepcopy(app_mod.SETTINGS_SCHEMA)
    api._settings_data[0]["_data_dir"] = str(tmp_path)

    api.save_settings({"theme": "light", "orb_opacity": 0.6})

    with open(os.path.join(tmp_path, "settings.json"), "r", encoding="utf-8") as f:
        saved = json.load(f)

    assert isinstance(saved, dict)
    assert saved["theme"] == "light"
    assert saved["orb_opacity"] == 0.6


def test_apply_theme_accepts_js_payload_dict():
    api = app_mod.Api(geo=(100, 100))
    api._orb_js = type("Bridge", (), {"send": lambda self, *args, **kwargs: None})()
    api._chat_js = type("Bridge", (), {"send": lambda self, *args, **kwargs: None})()
    api._settings_js = type("Bridge", (), {"send": lambda self, *args, **kwargs: None})()
    api._bubble_js = type("Bridge", (), {"send": lambda self, *args, **kwargs: None})()

    api.apply_theme({"theme": "blue"})
    api.apply_opacity({"opacity": 0.5})

    assert True
