/* LLM Float 设置页（Chrome 扩展完整版）
 * 设置项 schema 与 PySide6 版一致；存储走 chrome.storage.local，保存后广播各标签页刷新。
 */
const STORAGE_SCHEMA = [
  {
    section: '基础',
    items: [
      { key: 'orb_opacity', label: '悬浮球透明度', type: 'number', value: 1.0, min: 0.2, max: 1.0, step: 0.05 },
      { key: 'theme', label: '主题', type: 'select', value: 'flat', options: [['flat', '极简扁平'], ['neon', '霓虹赛博'], ['synthwave', '复古合成波'], ['glass', '液态玻璃'], ['macaron', '马卡龙奶油'], ['dark', '深色'], ['blue', '蓝色'], ['light', '浅色']] },
      { key: 'orb_size', label: '悬浮球大小', type: 'number', value: 68, min: 40, max: 96, step: 1 },
    ],
  },
  {
    section: '聊天（网址匹配）',
    items: [
      { key: 'chat_profiles', label: '', type: 'chat_profiles', value: [
        { chatName: '默认', urlRegex: '.*', baseUrl: 'http://localhost:8088', agentId: 'default', ttsTarget: '', token: '' },
      ] },
    ],
  },
  {
    section: '字幕（TTS）',
    segmentKey: 'tts_mode',
    segmentOptions: [['off', '关'], ['stream', '流式'], ['http', '非流式']],
    segmentDefault: 'stream',
    items: [
      { key: 'tts_lines', label: '显示行数', type: 'select', value: '2', options: [['1', '1'], ['2', '2'], ['3', '3'], ['5', '5']] },
      // TTS 接口配置（WS /v1/audio/speech/stream + HTTP /v1/audio/speech），播报方式由标题栏三态选择
      { key: 'tts_host', label: 'TTS 服务 HOST', type: 'text', value: '' },
      { key: 'tts_api_key', label: 'TTS API Key', type: 'password', value: '' },
      { key: 'tts_model', label: 'TTS 模型', type: 'text', value: 'qwen3-tts' },
      { key: 'tts_voice', label: '音色 voice', type: 'text', value: 'vivian' },
      { key: 'tts_response_format', label: '音频格式 response_format', type: 'text', value: 'pcm' },
      { key: 'tts_sample_rate', label: '采样率 sample_rate', type: 'number', value: 24000, min: 8000, max: 48000, step: 1000 },
      { key: 'tts_language', label: '语言 language', type: 'text', value: 'zh' },
      { key: 'tts_speed', label: '语速 speed', type: 'number', value: 1.0, min: 0.5, max: 2.0, step: 0.1 },
      { key: 'tts_instructions', label: '指令 instructions', type: 'text', value: '' },
    ],
  },
  {
    section: '识别（ASR）',
    segmentKey: 'asr_mode',
    segmentOptions: [['off', '关'], ['stream', '流式'], ['http', '非流式']],
    segmentDefault: 'http',
    items: [
      // ASR 接口配置（非流式 POST /v1/audio/transcriptions；流式实时识别待接口文档接入）
      { key: 'asr_host', label: 'ASR 服务 HOST', type: 'text', value: '' },
      { key: 'asr_api_key', label: 'ASR API Key', type: 'password', value: '' },
      { key: 'asr_model', label: '识别模型', type: 'text', value: 'qwen3-asr' },
      { key: 'asr_language', label: '识别语言', type: 'text', value: 'zh' },
    ],
  },
  {
    section: '未启用',
    collapsed: true,
    items: [
      { key: 'language', label: '界面语言', type: 'select', value: 'zh', options: [['zh', '简体中文'], ['en', 'English']] },
      { key: 'autostart', label: '开机自启', type: 'bool', value: false },
      { key: 'default_mode', label: '默认打开模式', type: 'select', value: 'chat', options: [['chat', '聊天'], ['subtitle', '字幕'], ['asr', '识别']] },
      { key: 'base_url', label: '接口地址 Base URL', type: 'text', value: 'https://api.example.com/v1' },
      { key: 'api_key', label: 'API Key', type: 'password', value: '' },
      { key: 'model', label: '模型', type: 'select', value: 'gpt-4o', options: [['gpt-4o', 'gpt-4o'], ['gpt-4o-mini', 'gpt-4o-mini'], ['qwen-max', 'qwen-max'], ['custom', '自定义']] },
      { key: 'system_prompt', label: 'System Prompt', type: 'textarea', value: '你是一个有用的桌面助手，回答尽量简洁。' },
      { key: 'temperature', label: 'temperature', type: 'number', value: 0.7, min: 0, max: 2, step: 0.1 },
      { key: 'max_tokens', label: '单次最大 tokens', type: 'number', value: 2048, min: 256, max: 32768, step: 256 },
      { key: 'context_turns', label: '上下文轮数', type: 'number', value: 10, min: 1, max: 50, step: 1 },
      { key: 'stream', label: '流式输出', type: 'bool', value: true },
      { key: 'tts_font_size', label: '字号', type: 'number', value: 18, min: 12, max: 40, step: 1 },
      { key: 'tts_max_chars', label: '每行最大字数', type: 'number', value: 24, min: 8, max: 60, step: 1 },
      { key: 'tts_align', label: '对齐方式', type: 'select', value: 'center', options: [['left', '左'], ['center', '居中'], ['right', '右']] },
      { key: 'tts_hold', label: '单句停留时长(秒)', type: 'number', value: 3, min: 1, max: 20, step: 1 },
      { key: 'tts_auto_hide', label: '播报结束自动隐藏', type: 'bool', value: true },
      { key: 'asr_language', label: '识别语言', type: 'select', value: 'auto', options: [['auto', '自动'], ['zh', '中文'], ['en', '英文']] },
      { key: 'asr_engine', label: '识别引擎', type: 'select', value: 'whisper', options: [['whisper', 'Whisper'], ['xfyun', '讯飞'], ['local', '本地模型']] },
      { key: 'asr_sample_rate', label: '采样率', type: 'select', value: '16000', options: [['16000', '16000'], ['44100', '44100']] },
      { key: 'asr_show_interim', label: '显示中间结果', type: 'bool', value: true },
      { key: 'asr_silence', label: '静音自动结束(秒)', type: 'number', value: 3, min: 1, max: 15, step: 1 },
      { key: 'asr_auto_punct', label: '自动补全标点', type: 'bool', value: true },
      { key: 'asr_devices', label: '输入设备', type: 'list', value: ['默认麦克风'], options: ['默认麦克风', '麦克风 A', '麦克风 B'] },
      { key: 'hotkey_chat', label: '唤起聊天', type: 'text', value: 'Ctrl+Alt+Space' },
      { key: 'hotkey_asr', label: '开始 / 结束识别', type: 'text', value: 'Ctrl+Alt+R' },
      { key: 'log_level', label: '日志级别', type: 'select', value: 'INFO', options: [['DEBUG', 'DEBUG'], ['INFO', 'INFO'], ['WARN', 'WARN'], ['ERROR', 'ERROR']] },
      { key: 'data_dir', label: '数据目录', type: 'text', value: './data' },
      { key: 'proxy', label: '代理地址', type: 'text', value: '' },
      { key: 'features', label: '启用模块', type: 'list', value: ['chat', 'subtitle'], options: [['chat', '聊天'], ['subtitle', '字幕'], ['asr', '识别'], ['settings', '设置']] },
    ],
  },
];

let currentSettings = [];

function showToast(msg, timeout = 1600) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), timeout);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme || 'flat';
}

/* ---------- 表单渲染 ---------- */
function buildProfileRow(p) {
  p = p || {};
  const row = document.createElement('tr');
  row.className = 'profile-row';
  const fields = [
    ['chatName', '名称', p.chatName || ''],
    ['urlRegex', '网址正则', p.urlRegex || ''],
    ['baseUrl', 'Base URL', p.baseUrl || ''],
    ['agentId', 'Agent ID', p.agentId || ''],
    ['ttsTarget', '元素 id 或 CSS 选择器', p.ttsTarget || ''],
    ['token', 'Token', p.token || ''],
  ];
  fields.forEach(([pk, ph, val]) => {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.pk = pk;
    input.placeholder = ph;
    input.value = val;
    td.appendChild(input);
    row.appendChild(td);
  });
  const tdOp = document.createElement('td');
  tdOp.className = 'profile-op';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'profile-del';
  del.title = '删除';
  del.textContent = '×';
  del.addEventListener('click', () => row.remove());
  tdOp.appendChild(del);
  row.appendChild(tdOp);
  return row;
}

function prepareField(item) {
  const field = document.createElement('div');
  field.className = 'field';
  if (item.type === 'chat_profiles') field.classList.add('field-wide');
  const label = document.createElement('label');
  label.textContent = item.label || item.key;
  if (item.type !== 'chat_profiles') field.appendChild(label);

  const controlWrap = document.createElement('div');

  if (item.type === 'bool') {
    const check = document.createElement('label');
    check.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!item.value;
    input.dataset.key = item.key;
    check.appendChild(input);
    check.appendChild(document.createTextNode('启用'));
    controlWrap.appendChild(check);
  } else if (item.type === 'select') {
    const select = document.createElement('select');
    select.dataset.key = item.key;
    for (const [value, label] of item.options || []) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      if (String(item.value) === String(value)) option.selected = true;
      select.appendChild(option);
    }
    controlWrap.appendChild(select);
  } else if (item.type === 'textarea') {
    const textarea = document.createElement('textarea');
    textarea.dataset.key = item.key;
    textarea.value = item.value || '';
    controlWrap.appendChild(textarea);
  } else if (item.type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = item.min ?? '';
    input.max = item.max ?? '';
    input.step = item.step ?? '1';
    input.value = item.value ?? '';
    input.dataset.key = item.key;
    controlWrap.appendChild(input);
  } else if (item.type === 'chat_profiles') {
    const wrap = document.createElement('div');
    wrap.className = 'profiles';
    wrap.dataset.key = item.key;
    const table = document.createElement('table');
    table.className = 'profile-table';
    table.innerHTML = '<thead><tr>' +
      '<th>名称</th><th>网址正则</th><th>Base URL</th><th>Agent ID</th><th>TTS定位</th><th>Token</th><th class="profile-op"></th>' +
      '</tr></thead>';
    const tbody = document.createElement('tbody');
    tbody.className = 'profile-rows';
    (Array.isArray(item.value) ? item.value : []).forEach((p) => tbody.appendChild(buildProfileRow(p)));
    table.appendChild(tbody);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'profile-add';
    add.textContent = '+ 添加配置';
    add.addEventListener('click', () => tbody.appendChild(buildProfileRow({})));
    wrap.append(table, add);
    controlWrap.appendChild(wrap);
  } else if (item.type === 'list') {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = Array.isArray(item.value) ? item.value.join(', ') : (item.value || '');
    input.dataset.key = item.key;
    controlWrap.appendChild(input);
  } else {
    const input = document.createElement('input');
    input.type = item.type === 'password' ? 'password' : 'text';
    input.value = item.value || '';
    input.dataset.key = item.key;
    controlWrap.appendChild(input);
  }

  field.appendChild(controlWrap);
  return field;
}

function renderSettings(data) {
  const body = document.getElementById('settings-body');
  if (!body) return;
  body.innerHTML = '';
  currentSettings = data;

  currentSettings.forEach(section => {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'section';
    const title = document.createElement('h3');
    title.textContent = section.section || '设置';
    sectionEl.appendChild(title);

    const list = document.createElement('div');
    list.className = 'field-list';
    (section.items || []).forEach(item => list.appendChild(prepareField(item)));
    sectionEl.appendChild(list);
    body.appendChild(sectionEl);

    if (section.segmentKey && section.segmentOptions) {
      // 标题栏三态选择（如 TTS 播报：关 / 流式 / 非流式）
      title.classList.add('sec-title');
      const seg = document.createElement('div');
      seg.className = 'seg';
      (section.segmentOptions || []).forEach((opt) => {
        const val = opt[0], label = opt[1];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seg-btn' + (String(section.segment) === val ? ' active' : '');
        b.textContent = label;
        b.addEventListener('click', () => {
          try { chrome.storage.local.set({ [section.segmentKey]: val }); } catch (e) { /* 忽略 */ }
          seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
        });
        seg.appendChild(b);
      });
      title.appendChild(seg);
    }

    if (section.collapsed) {
      title.classList.add('collapsible', 'collapsed');
      list.classList.add('hidden');
      title.addEventListener('click', () => {
        const collapsed = list.classList.toggle('hidden');
        title.classList.toggle('collapsed', collapsed);
      });
    }
  });
}

/* 用 storage 扁平值覆盖 schema 默认值 */
function mergeWithStorage(schema, values) {
  return schema.map(section => ({
    ...section,
    segment: section.segmentKey ? (values && values[section.segmentKey] !== undefined ? String(values[section.segmentKey]) : (section.segmentDefault || (section.segmentOptions && section.segmentOptions[0] ? section.segmentOptions[0][0] : ""))) : undefined,
    items: (section.items || []).map(item => ({
      ...item,
      value: values && values[item.key] !== undefined ? values[item.key] : item.value,
    })),
  }));
}

function readFormValues() {
  const values = {};
  document.querySelectorAll('[data-key]').forEach(node => {
    const key = node.dataset.key;
    if (!key) return;
    const section = node.closest('.field');
    if (!section) return;
    const field = currentSettings.flatMap(s => s.items || []).find(item => item.key === key);
    if (!field) return;
    let val;
    if (field.type === 'chat_profiles') {
      val = Array.from(node.querySelectorAll('.profile-row')).map((row) => {
        const obj = {};
        row.querySelectorAll('input[data-pk]').forEach((inp) => { obj[inp.dataset.pk] = inp.value.trim(); });
        return obj;
      }).filter((o) => o.chatName || o.urlRegex || o.baseUrl || o.agentId || o.ttsTarget || o.token);
    } else {
      val = node.value;
      if (node.type === 'checkbox') val = node.checked;
      else if (field.type === 'number') val = Number(val);
      else if (field.type === 'list') val = String(val).split(',').map(v => v.trim()).filter(Boolean);
    }
    values[key] = val;
  });
  return values;
}

/* ---------- 加载 / 保存 / 重置 ---------- */
function loadSettings() {
  chrome.storage.local.get(null, (all) => {
    const merged = mergeWithStorage(STORAGE_SCHEMA, all);
    renderSettings(merged);
    // 一次性固化：把当前完整配置存为"默认快照"，此后点恢复默认回到此状态
    if (all.__defaults === undefined) {
      const snapshot = {};
      merged.flatMap(s => s.items || []).forEach(i => { snapshot[i.key] = i.value; });
      merged.forEach(s => { if (s.segmentKey && s.segment !== undefined) snapshot[s.segmentKey] = s.segment; });
      try { chrome.storage.local.set({ __defaults: snapshot }); } catch (e) { /* 忽略 */ }
    }
    const theme = merged.flatMap(s => s.items || []).find(i => i.key === 'theme');
    if (theme) applyTheme(theme.value);
  });
}

function broadcastConfig() {
  try {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((t) => {
        chrome.tabs.sendMessage(t.id, { type: 'llm_config_updated' }).catch(() => {});
      });
    });
  } catch (e) { /* 忽略 */ }
}

function saveSettings() {
  const values = readFormValues();
  chrome.storage.local.set(values, () => {
    showToast('保存成功');
    const theme = values.theme || 'flat';
    applyTheme(theme);
    broadcastConfig();
  });
}

function resetSettings() {
  // 恢复"默认快照"（首次打开设置页时固化的当前配置）；无快照时回退 schema 内置默认
  chrome.storage.local.get('__defaults', (d) => {
    const snap = d.__defaults || {};
    const defaults = {};
    STORAGE_SCHEMA.forEach(s => {
      (s.items || []).forEach(i => { defaults[i.key] = snap[i.key] !== undefined ? snap[i.key] : i.value; });
      if (s.segmentKey) defaults[s.segmentKey] = snap[s.segmentKey] !== undefined ? snap[s.segmentKey] : (s.segmentDefault || '');
    });
    chrome.storage.local.set(defaults, () => {
      const merged = mergeWithStorage(STORAGE_SCHEMA, defaults);
      renderSettings(merged);
      const theme = merged.flatMap(s => s.items || []).find(i => i.key === 'theme');
      if (theme) applyTheme(theme.value);
      broadcastConfig();
      showToast('已恢复默认');
    });
  });
}

/* ---------- 事件绑定 ---------- */
document.getElementById('set-save')?.addEventListener('click', saveSettings);
document.getElementById('set-reset')?.addEventListener('click', resetSettings);
document.getElementById('set-tts-demo')?.addEventListener('click', () => {
  try { chrome.runtime.sendMessage({ type: 'llm_demo', demo: 'tts' }); } catch (e) { /* 忽略 */ }
});
document.getElementById('set-asr-demo')?.addEventListener('click', () => {
  try { chrome.runtime.sendMessage({ type: 'llm_demo', demo: 'asr' }); } catch (e) { /* 忽略 */ }
});
document.addEventListener('change', (event) => {
  if (event.target?.dataset?.key !== 'theme') return;
  applyTheme(event.target.value || 'flat');
});

loadSettings();
