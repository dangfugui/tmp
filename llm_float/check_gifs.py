from PIL import Image, ImageChops
import os
d = r"C:\Users\admin\Downloads\tmp\llm_float\orb_gifs"
for f in ["asr_listening.gif", "tts_speaking.gif", "chat_active.gif", "settings_active.gif"]:
    im = Image.open(os.path.join(d, f))
    frames = []
    for i in range(min(im.n_frames, 12)):
        im.seek(i)
        frames.append(im.convert("RGB"))
    diffs = [ImageChops.difference(frames[0], fr).getbbox() for fr in frames[1:]]
    print(f, "frames=", im.n_frames, "diff_boxes=", diffs)
