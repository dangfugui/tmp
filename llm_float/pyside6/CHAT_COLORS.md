# 聊天窗配色参考（Chat Colors）

> 聊天窗（`web/chat.html` / `chat.css`）全部颜色由 `web/theme.css` 的 CSS 变量驱动，
> 切换主题（设置 → 主题）时自动生效，前端无需改代码。
> 本文档为对接真实聊天窗口 / 自定义配色时的速查手册。
>
> 当前可用主题（`settings_store.SETTINGS_SCHEMA` 中 `theme` 枚举）：
> `flat`（极简扁平·G2）/ `neon`（霓虹赛博·G3）/ `synthwave`（复古合成波·G8）/
> `glass`（液态玻璃·G1）/ `macaron`（马卡龙奶油·G4）

---

## 1. 聊天窗用到的变量清单

| CSS 变量 | 用途 |
|---|---|
| `--bg-card` | 聊天窗整体背景（玻璃卡片） |
| `--bg-glass` | AI 消息气泡背景 |
| `--bg-glass-strong` | 图标按钮 hover 背景 |
| `--titlebar-bg` | 顶部标题栏 + 底部输入区背景 |
| `--divider` | 分割线 / 边框（标题栏、消息边框） |
| `--text-primary` | 主文字色 |
| `--text-secondary` | 次要文字色（状态、时间、色卡编码） |
| `--accent` | 强调色（聚焦边框、复制按钮 hover） |
| `--accent-2` | 强调色副色（渐变终点） |
| `--accent-grad` | **用户消息气泡渐变**（发送按钮、头像同款） |
| `--input-bg` | 输入框背景 |
| `--input-border` | 输入框边框 |
| `--focus-ring` | 输入框聚焦光晕 / 用户气泡阴影 |
| `--chip-bg` | 调色板色卡背景 |
| `--shadow-card` | 窗口投影 |
| `--glass-border` | 窗口外描边 |

---

## 2. 各主题色值

### flat · 极简扁平（G2）

| 变量 | 值 |
|---|---|
| `--bg-card` | `rgba(23, 25, 31, 0.96)` |
| `--bg-glass` | `rgba(255,255,255,0.04)` |
| `--titlebar-bg` | `rgba(255,255,255,0.02)` |
| `--divider` | `rgba(255,255,255,0.08)` |
| `--text-primary` | `#f4f5f7` |
| `--text-secondary` | `#9aa1ad` |
| `--accent` / `--accent-2` | `#6366f1` / `#4f46e5` |
| `--accent-grad` | `linear-gradient(135deg, #6366f1, #4f46e5)` |
| `--input-bg` / `--input-border` | `rgba(255,255,255,0.05)` / `rgba(255,255,255,0.12)` |
| `--focus-ring` | `rgba(99,102,241,0.32)` |
| `--glass-border` | `rgba(255,255,255,0.1)` |

### neon · 霓虹赛博（G3）

| 变量 | 值 |
|---|---|
| `--bg-card` | `rgba(11, 11, 20, 0.94)` |
| `--bg-glass` | `rgba(34,211,238,0.06)` |
| `--titlebar-bg` | `rgba(34,211,238,0.04)` |
| `--divider` | `rgba(34,211,238,0.18)` |
| `--text-primary` | `#eafcff` |
| `--text-secondary` | `#8fb8c4` |
| `--accent` / `--accent-2` | `#22d3ee` / `#818cf8` |
| `--accent-grad` | `linear-gradient(135deg, #22d3ee, #818cf8)` |
| `--input-bg` / `--input-border` | `rgba(34,211,238,0.06)` / `rgba(34,211,238,0.3)` |
| `--focus-ring` | `rgba(34,211,238,0.3)` |
| `--glass-border` | `rgba(34,211,238,0.28)` |

### synthwave · 复古合成波（G8）

| 变量 | 值 |
|---|---|
| `--bg-card` | `rgba(21, 15, 46, 0.92)` |
| `--bg-glass` | `rgba(168,85,247,0.07)` |
| `--titlebar-bg` | `rgba(168,85,247,0.05)` |
| `--divider` | `rgba(168,85,247,0.22)` |
| `--text-primary` | `#f3e8ff` |
| `--text-secondary` | `#b8a3d6` |
| `--accent` / `--accent-2` | `#a855f7` / `#ec4899` |
| `--accent-grad` | `linear-gradient(135deg, #a855f7, #ec4899)` |
| `--input-bg` / `--input-border` | `rgba(168,85,247,0.07)` / `rgba(168,85,247,0.3)` |
| `--focus-ring` | `rgba(168,85,247,0.32)` |
| `--glass-border` | `rgba(168,85,247,0.3)` |

### glass · 液态玻璃（G1）

| 变量 | 值 |
|---|---|
| `--bg-card` | `rgba(16, 18, 26, 0.88)` |
| `--bg-glass` | `rgba(255,255,255,0.045)` |
| `--titlebar-bg` | `rgba(255,255,255,0.03)` |
| `--divider` | `rgba(255,255,255,0.08)` |
| `--text-primary` | `#eef1f8` |
| `--text-secondary` | `#98a2b8` |
| `--accent` / `--accent-2` | `#6d7cff` / `#8b5cf6` |
| `--accent-grad` | `linear-gradient(135deg, #6d7cff, #8b5cf6)` |
| `--input-bg` / `--input-border` | `rgba(255,255,255,0.05)` / `rgba(255,255,255,0.1)` |
| `--focus-ring` | `rgba(109,124,255,0.35)` |
| `--glass-border` | `rgba(255,255,255,0.12)` |

### macaron · 马卡龙奶油（G4，浅色主题）

| 变量 | 值 |
|---|---|
| `--bg-card` | `rgba(255, 249, 245, 0.96)` |
| `--bg-glass` | `rgba(255,255,255,0.55)` |
| `--titlebar-bg` | `rgba(255,255,255,0.4)` |
| `--divider` | `rgba(180,150,160,0.16)` |
| `--text-primary` | `#5d4a56` |
| `--text-secondary` | `#a08b97` |
| `--accent` / `--accent-2` | `#f59eb0` / `#b9a6f2` |
| `--accent-grad` | `linear-gradient(135deg, #ffb3c1, #c9b6ff)` |
| `--input-bg` / `--input-border` | `rgba(255,255,255,0.6)` / `rgba(180,150,160,0.28)` |
| `--focus-ring` | `rgba(245,158,176,0.35)` |
| `--glass-border` | `rgba(255,255,255,0.8)` |

---

## 3. chat.css 中固定（不随主题变）的颜色

对接时如需微调，改 `web/chat.css`：

| 元素 | 值 | 说明 |
|---|---|---|
| 在线状态点 `.dot` | `#34d399` | 绿色呼吸点 |
| 危险操作 hover `.icon-btn.danger:hover` | `#f87171`（背景 `rgba(239,68,68,.16)`） | 关闭按钮悬停 |
| 用户气泡文字 `.msg.user .bubble` | `#fff` | 固定在渐变底上的白字 |
| 头像 / 发送按钮图标 | `#fff` | 固定在渐变底上的白字 |
| 滚动条 thumb | `rgba(255,255,255,.14)`（hover `.28`） | 全局滚动条 |

> ⚠️ 注意：`macaron` 是浅色主题，用户气泡渐变是浅粉（`#ffb3c1 → #c9b6ff`），但气泡文字是固定白色 `#fff`，对比度偏低。若对接时在意，可给 `.msg.user .bubble` 的 color 按主题覆盖（如 macaron 下用深色文字）。

---

## 4. 悬浮球五态核心色（同一主题文件，常用）

| 变量 | 含义 | flat | neon | synthwave | glass | macaron |
|---|---|---|---|---|---|---|
| `--orb-idle-bg` | 静默态背景 | `#6366f1` | `#0b0b14` | 深紫渐变 | 紫蓝渐变 | 粉渐变 |
| `--orb-idle-color` | 静默态图标 | `#fff` | `#22d3ee` | `#f472b6` | `#fff` | `#7a4a5c` |
| `--orb-chat-color` | 聊天态图标 | `#fff` | `#818cf8` | `#22d3ee` | `#fff` | `#3f5f7a` |
| `--orb-settings-color` | 设置态图标 | `#fff` | `#e879f9` | `#fb923c` | `#fff` | `#8a6d2f` |
| `--orb-tts-color` | 字幕态图标 | `#fff` | `#fb923c` | `#ec4899` | `#fff` | `#5b4a8a` |
| `--orb-asr-color` | 识别态图标 | `#fff` | `#4ade80` | `#4ade80` | `#fff` | `#3f6b58` |

完整五态背景/描边/阴影见 `web/theme.css` 各主题块 `--orb-*` 变量。

---

## 5. 对接真实聊天时怎么用

- **发 AI 消息**：Python 端 `overlay.push_chat_message(...)` 之前由 `Backend.chat_send` 走 `chat_handler`，前端通过 `window.assistant.onChatMessage({role, text})` 渲染，消息气泡样式自动用当前主题（AI 消息 `--bg-glass`、用户消息 `--accent-grad`）。
- **要自定义某一主题配色**：只改 `web/theme.css` 里对应 `body[data-theme="..."]` 块的变量即可，聊天窗所有元素同步变化。
- **要加新主题**：`theme.css` 新增 `body[data-theme="xxx"]` 块（复制现有块改色值）→ `settings_store.py` 的 `theme` 枚举加入 `"xxx"` → `overlay.py` 的 `VALID_THEMES` 加入 `"xxx"`。
