"""
为 llm_float 悬浮球生成四态 GIF 动图（与 orb_demo.html 动画对应）。
输出目录：llm_float/orb_gifs/
"""
from PIL import Image, ImageDraw, ImageFont
import math
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "orb_gifs")
os.makedirs(OUT_DIR, exist_ok=True)

W, H = 68, 68          # 画布尺寸（与项目悬浮球实际尺寸一致 68px）
CX, CY = 34, 34        # 球心
R = 28                 # 球半径（缩小：原 34 -> 28，留白边）

# 字体（尝试系统中文字体）
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttc",
    r"C:\Windows\Fonts\segoeui.ttf",
]
def get_font(size, bold=False):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

FONT_LABEL = get_font(14)
FONT_DESC = get_font(10)

BG = (19, 26, 43)        # 格子背景 #131a2b
GRID = (35, 45, 66)      # 细边框


def base_cell():
    im = Image.new("RGB", (W, H), (0, 0, 0))
    return im, ImageDraw.Draw(im)


def gradient_circle(d, center, r, c1, c2, c3):
    """径向渐变球体"""
    img = Image.new("RGB", (W, H), (0, 0, 0))
    px = img.load()
    cx, cy = center
    for y in range(max(0, cy - r), min(H, cy + r + 1)):
        for x in range(max(0, cx - r), min(W, cx + r + 1)):
            dx, dy = x - cx, y - cy
            dist = math.sqrt(dx * dx + dy * dy) / r
            if dist <= 1:
                t = dist
                if t < 0.45:
                    u = t / 0.45
                    col = tuple(int(c1[i] * (1 - u) + c2[i] * u) for i in range(3))
                else:
                    u = (t - 0.45) / 0.55
                    col = tuple(int(c2[i] * (1 - u) + c3[i] * u) for i in range(3))
                px[x, y] = col
    return img


def overlay_glow(im, center, r, color, alpha):
    """外发光"""
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(int(r * 0.9), int(r * 1.9)):
        a = int(alpha * (1 - (i - r * 0.9) / r))
        gd.ellipse([CX - i, CY - i, CX + i, CY + i], outline=(*color, a))
    im.alpha_composite(glow)


def svg_icon(draw, kind, color, scale=1.0):
    """用线条绘制简易图标（麦克风/音量/齿轮/气泡）"""
    cx, cy = CX, CY
    s = 17 * scale
    if kind == "mic":
        # 麦克风
        draw.rounded_rectangle([cx - 5 * s / 17, cy - 9 * s / 17, cx + 5 * s / 17, cy + 3 * s / 17],
                               radius=3 * s / 17, outline=color, width=max(1, int(1.6 * scale)))
        draw.arc([cx - 9 * s / 17, cy - 3 * s / 17, cx + 9 * s / 17, cy + 11 * s / 17],
                 15, 165, fill=color, width=max(1, int(1.6 * scale)))
        draw.line([cx, cy + 6 * s / 17, cx, cy + 12 * s / 17], fill=color, width=max(1, int(1.6 * scale)))
    elif kind == "vol":
        # 音量
        draw.polygon([(cx - 8 * s / 17, cy - 4 * s / 17), (cx - 3 * s / 17, cy - 4 * s / 17),
                      (cx + 2 * s / 17, cy - 9 * s / 17), (cx + 2 * s / 17, cy + 9 * s / 17),
                      (cx - 3 * s / 17, cy + 4 * s / 17), (cx - 8 * s / 17, cy + 4 * s / 17)],
                     fill=color)
        draw.arc([cx + 1 * s / 17, cy - 6 * s / 17, cx + 11 * s / 17, cy + 6 * s / 17],
                 -55, 55, fill=color, width=max(1, int(1.6 * scale)))
        draw.arc([cx + 4 * s / 17, cy - 10 * s / 17, cx + 15 * s / 17, cy + 10 * s / 17],
                 -45, 45, fill=color, width=max(1, int(1.6 * scale)))
    elif kind == "gear":
        # 齿轮（简化：圆 + 8 个齿）
        rr = 8 * s / 17
        for i in range(8):
            a = i * math.pi / 4
            x1, y1 = cx + math.cos(a) * (rr - 2), cy + math.sin(a) * (rr - 2)
            x2, y2 = cx + math.cos(a) * (rr + 2.5), cy + math.sin(a) * (rr + 2.5)
            draw.line([x1, y1, x2, y2], fill=color, width=max(1, int(1.8 * scale)))
        draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=color, width=max(1, int(1.6 * scale)))
        draw.ellipse([cx - 2.5, cy - 2.5, cx + 2.5, cy + 2.5], fill=color)
    elif kind == "chat":
        # 对话气泡
        bw, bh = 20 * s / 17, 14 * s / 17
        draw.rounded_rectangle([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2],
                               radius=5, outline=color, width=max(1, int(1.6 * scale)))
        draw.polygon([(cx - 4, cy + bh / 2), (cx + 2, cy + bh / 2), (cx - 2, cy + bh / 2 + 5)], fill=color)


def make_asr(frame_idx, total):
    im, d = base_cell()
    t = frame_idx / total
    c1, c2, c3 = (94, 234, 212), (20, 184, 166), (15, 118, 110)
    core = gradient_circle(d, (CX, CY), R, c1, c2, c3)
    # 外发光
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(int(R * 1.9), int(R * 0.9), -1):
        a = int(60 * (1 - (i - R * 0.9) / (R)))
        gd.ellipse([CX - i, CY - i, CX + i, CY + i], outline=(*c2, a))
    core_a = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    core_a.alpha_composite(core.convert("RGBA"))
    core_a.alpha_composite(glow)
    im = Image.alpha_composite(im.convert("RGBA"), core_a)
    d = ImageDraw.Draw(im)
    # 扩散环
    for k in range(2):
        ph = (t * 1.6 + k * 0.8) % 1.6
        rr = R + 6 + ph * 42
        alpha = int(200 * (1 - ph / 1.6))
        if rr < R + 48:
            d.ellipse([CX - rr, CY - rr, CX + rr, CY + rr], outline=(*c2, alpha), width=3)
    # 声波条
    heights = [8, 16, 24, 16, 8]
    for i, h in enumerate(heights):
        ph = (t + i * 0.12) % 1
        hh = h * (0.4 + 0.6 * abs(math.sin(ph * math.pi)))
        x = CX - 12 + i * 6
        d.rounded_rectangle([x - 1.5, CY - hh / 2, x + 1.5, CY + hh / 2],
                            radius=1.5, fill=(255, 255, 255, 230))
    svg_icon(d, "mic", (6, 78, 59))
    return im


def make_tts(frame_idx, total):
    im, d = base_cell()
    t = frame_idx / total
    c1, c2, c3 = (253, 164, 175), (244, 63, 94), (190, 18, 60)
    pulse = 1 + 0.07 * math.sin(t * 2 * math.pi / 1.4 * 1.4)
    core = gradient_circle(d, (CX, CY), int(R * pulse), c1, c2, c3)
    core_a = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    core_a.alpha_composite(core.convert("RGBA"))
    im = Image.alpha_composite(im.convert("RGBA"), core_a)
    d = ImageDraw.Draw(im)
    # 飘出的音符粒子
    notes = [(0.30, 0.18), (0.52, 0.10), (0.74, 0.22), (0.86, 0.34)]
    for i, (nx, ny) in enumerate(notes):
        ph = (t * 1.4 + i * 0.3) % 1.4
        if ph < 1:
            x = CX + (nx - 0.5) * 2 * R
            y = CY + (ny - 0.5) * 2 * R - ph * 26
            size = 2 + ph * 3
            alpha = int(230 * (1 - ph))
            d.ellipse([x - size / 2, y - size / 2, x + size / 2, y + size / 2],
                      fill=(*c1, alpha))
    svg_icon(d, "vol", (255, 255, 255))
    return im


def make_chat(frame_idx, total):
    im, d = base_cell()
    t = frame_idx / total
    c1, c2, c3 = (147, 197, 253), (59, 130, 246), (29, 78, 216)
    bob = 8 * math.sin(t * 2 * math.pi / 2.2)
    scale = 1 + 0.03 * math.sin(t * 2 * math.pi / 2.2)
    core = gradient_circle(d, (CX, CY + int(bob)), int(R * scale), c1, c2, c3)
    core_a = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    core_a.alpha_composite(core.convert("RGBA"))
    im = Image.alpha_composite(im.convert("RGBA"), core_a)
    d = ImageDraw.Draw(im)
    # 白色气泡（带两条消息线，更像聊天）
    bx, by = CX, CY + int(bob) - 4
    bw, bh = 40, 28
    d.rounded_rectangle([bx - bw / 2, by - bh / 2, bx + bw / 2, by + bh / 2],
                        radius=12, fill=(255, 255, 255, 240))
    d.polygon([(bx - 6, by + bh / 2 - 2), (bx + 4, by + bh / 2 - 2), (bx, by + bh / 2 + 6)],
              fill=(255, 255, 255, 240))
    # 气泡内的两条消息线
    d.line([bx - 12, by - 4, bx + 4, by - 4], fill=(147, 197, 253), width=2)
    d.line([bx - 12, by + 4, bx + 10, by + 4], fill=(147, 197, 253), width=2)
    return im


def make_settings(frame_idx, total):
    im, d = base_cell()
    t = frame_idx / total
    c1, c2, c3 = (196, 181, 253), (139, 92, 246), (109, 40, 217)
    core = gradient_circle(d, (CX, CY), R, c1, c2, c3)
    core_a = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    core_a.alpha_composite(core.convert("RGBA"))
    im = Image.alpha_composite(im.convert("RGBA"), core_a)
    d = ImageDraw.Draw(im)
    # 旋转齿轮
    ang = t * 2 * math.pi / 4
    svg_icon(d, "gear", (245, 243, 255))
    # 旋转通过重绘实现：先画静态图标再叠加旋转效果（简化为点闪烁）
    dots = [(0.20, 0.14), (0.30, 0.84), (0.34, 0.80)]
    for i, (nx, ny) in enumerate(dots):
        ph = (t * 2 + i * 0.5) % 2
        if ph < 1:
            x = CX + (nx - 0.5) * 2 * R
            y = CY + (ny - 0.5) * 2 * R
            size = 3 + 2 * abs(math.sin(ph * math.pi))
            alpha = int(120 + 120 * abs(math.sin(ph * math.pi)))
            d.ellipse([x - size / 2, y - size / 2, x + size / 2, y + size / 2],
                      fill=(251, 191, 36, alpha))
    return im


def save_gif(name, maker, fps=12, seconds=3):
    frames = []
    total = fps * seconds
    for i in range(total):
        frames.append(maker(i, total))
    path = os.path.join(OUT_DIR, f"{name}.gif")
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=int(1000 / fps), loop=0, optimize=True)
    print(f"saved: {path} ({len(frames)} frames)")


if __name__ == "__main__":
    save_gif("asr_listening", make_asr)
    save_gif("tts_speaking", make_tts)
    save_gif("chat_active", make_chat)
    save_gif("settings_active", make_settings)
    print("done")
