// 公共配置：popup 按钮 + 悬浮球动作（加新功能只改这里）
// 格式：{ id: 按钮ID, label: 显示名称, action: 触发的动作值, color: 按钮颜色 }
const POPUP_BUTTONS = [
  { id: 'toggle', label: '开关插件', action: 'toggle_enabled', color: '#4ade80' },
  { id: 'settings', label: '设置', action: 'open_settings', color: '#a78bfa' },
  { id: 'chat', label: '聊天页', action: 'open_chat', color: '#60a5fa' },
  { id: 'tts', label: 'TTS Demo', action: 'open_tts', color: '#ff9800' },
  { id: 'asr', label: 'ASR Demo', action: 'open_asr', color: '#22c55e' },
];

// 从 POPUP_BUTTONS 生成悬浮球动作选项（设置页用）
// 加上 "无" 选项
const ORB_ACTIONS = [
  { value: 'none', label: '无' },
  ...POPUP_BUTTONS.map(btn => ({ value: btn.action, label: btn.label })),
];
