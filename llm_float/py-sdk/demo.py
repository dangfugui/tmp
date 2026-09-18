"""LLM Float SDK 演示：遍历每个页面，依次展示聊天 / TTS / ASR 效果。

运行：python demo.py
前置：1) 扩展已加载（chrome://extensions → 开发者模式 → 加载已解压的扩展程序）
      2) 至少一个 http/https 标签页已打开（悬浮球注入后即可）
"""
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api import FloatSDK

SLEEP = 4  # 每步演示停留秒数


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sdk = FloatSDK()

    # 事件回调：聊天流式回复 / TTS 逐句 / ASR 结果 / UI 状态
    @sdk.on("onChatMessage")
    async def on_msg(d):
        tail = "（回复完成）" if d.get("done") else "…"
        print("    [AI]", (d.get("text") or "")[:60].replace("\n", " "), tail)

    @sdk.on("onTtsSentence")
    async def on_tts(d):
        print("    [TTS %s/%s]" % (d.get("index"), d.get("total")), d.get("text"))

    @sdk.on("onAsrFinal")
    async def on_asr(d):
        print("    [ASR]", d.get("text"))

    @sdk.on("uiState")
    async def on_state(d):
        print("    [状态] orb=%s chat=%s bubble=%s" % (d.get("orb"), d.get("chat"), d.get("bubble")))

    await sdk.start()
    print("=== 桥已连接，开始演示 ===")

    # 1. 全局：主题切换（所有页面悬浮球联动）
    print("[1] 切回 极简扁平 …")
    await sdk.setTheme("flat")
    await asyncio.sleep(SLEEP)
    print("[2] 切换主题 霓虹赛博 → 观察悬浮球变色（全局）…")
    await sdk.setTheme("neon")
    await asyncio.sleep(SLEEP)

    # 2. 遍历每个页面演示
    tabs = await sdk.getTabs()
    print("\n共 %d 个可注入页面" % len(tabs))
    for i, tab in enumerate(tabs, 1):
        title = tab.get("title") or tab.get("url") or str(tab.get("id"))
        tid = tab["id"]
        print("\n===== 页面 %d/%d：%s =====" % (i, len(tabs), title))

        try:
            print("-> showChat(send=...) 打开聊天窗并发送一条消息")
            await sdk.showChat(send="你好，请用一句话介绍自己", tabId=tid)
            await asyncio.sleep(SLEEP + 1)  # 观察聊天窗与流式回复（无后端会显示错误提示，属正常）

            print("-> speakText(...) 语音播报字幕")
            await sdk.speakText("这是语音播报演示。现在播放第一句。然后是第二句。", tabId=tid)
            await asyncio.sleep(SLEEP + 1)

            print("-> startAsr + setAsrText×3 + endAsr 模拟流式识别")
            await sdk.startAsr(tabId=tid)
            await asyncio.sleep(1)
            for part in ("大家好", "大家好，这是流式", "大家好，这是流式识别效果，实时显示中"):
                await sdk.setAsrText(part, tabId=tid)
                await asyncio.sleep(1.2)
            await sdk.endAsr(text="大家好，这是流式识别效果，实时显示中。识别完成。", tabId=tid)
            await asyncio.sleep(SLEEP)

            print("-> hideChat 收起聊天窗，进入下一个页面")
            await sdk.hideChat(tabId=tid)
            await asyncio.sleep(2)
        except Exception as e:
            # 该页面不可操作（未注入 / 页面受限等）：打印原因并继续下一个页面
            print("    跳过该页面：%s" % e)
            continue

    # 3. 读取全局配置（storage 全部参数）
    print("\n[最后] getConfig 读取全局配置")
    cfg = await sdk.getConfig()
    for k in ("theme", "orb_size", "orb_opacity", "orb_enabled", "active_profile_name"):
        print("    %s = %s" % (k, cfg.get(k)))
    print("    chat_profiles = %d 条" % len(cfg.get("chat_profiles") or []))
    await asyncio.sleep(2)

    print("\n=== 演示结束，关闭桥 ===")
    await sdk.close()


if __name__ == "__main__":
    asyncio.run(main())