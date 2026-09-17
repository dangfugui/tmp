import logging
import os
import sys


LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "overlay.log")


def get_logger():
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    logger = logging.getLogger("llm_float.overlay")
    if not logger.handlers:
        logger.setLevel(logging.DEBUG)
        logger.propagate = False
        formatter = logging.Formatter("%(asctime)s %(process)d %(levelname)s %(message)s")
        # 文件日志（data/overlay.log）
        file_handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        # 同时输出到控制台（stdout）
        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)
    return logger


logger = get_logger()
