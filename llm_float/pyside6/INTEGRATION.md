# Overlay integration

`Overlay` owns the desktop overlay entry point. It reuses an existing
`QApplication`, or creates one when the host has not created it yet.

```python
from overlay import Overlay

overlay = Overlay()
overlay.open_chat()
overlay.push_tts_text("正在播报的文本", index=0)
overlay.set_asr_state("listening")
overlay.push_asr_partial("持续增长的识别结果")
overlay.push_asr_final("本句识别完成")
overlay.set_asr_state("idle")
overlay.exec()
```

When the host already owns an `App`, use `app.overlay` so both systems share
the same Qt windows and event loop.