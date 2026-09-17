const STORAGE_KEY = 'llm_float_settings';
const FALLBACK_SETTINGS = [
  {
    section: '基础',
    items: [
      { key: 'orb_opacity', label: '悬浮球透明度', type: 'number', value: 1.0, min: 0.2, max: 1.0, step: 0.05 },
      { key: 'theme', label: '主题', type: 'select', value: 'flat', options: [['flat', '极简扁平'], ['neon', '霓虹赛博'], ['synthwave', '复古合成波'], ['glass', '液态玻璃'], ['macaron', '马卡龙奶油']] },
      { key: 'orb_size', label: '悬浮球大小', type: 'number', value: 68, min: 40, max: 96, step: 1 },
    ],
  },
  {
    section: '聊天（网址匹配）',
    items: [
      { key: 'chat_profiles', label: '', type: 'chat_profiles', value: [
        { chatName: '默认', urlRegex: '.*', baseUrl: 'http://localhost:8088', agentId: 'default', ttsTarget: '' },
      ] },
    ],
  },
  {
    section: '字幕（TTS）',
    items: [
      { key: 'tts_lines', label: '显示行数', type: 'select', value: '2', options: [['1', '1'], ['2', '2'], ['3', '3'], ['5', '5']] },
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
      { key: 'model', label: '模型', type: 'select', value: 'gpt-4o', options: [['gpt-4o', 'gpt-4o'], ['gpt-4o-mini', 'gpt-4o-mini'], ['qwen-max', 'qwen-max']] },
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

function buildProfileRow(p) {
  p = p || {};
  const row = document.createElement('tr');
  row.className = 'profile-row';
  const fields = [
    ['chatName', '名称', p.chatName || ''],
    ['urlRegex', '网址正则', p.urlRegex || ''],
    ['baseUrl', 'Base URL', p.baseUrl || ''],
    ['agentId', 'Agent ID', p.agentId || ''],
    ['ttsTarget', 'TTS定位', p.ttsTarget || ''],
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
      '<th>名称</th><th>网址正则</th><th>Base URL</th><th>Agent ID</th><th>TTS定位</th><th class="profile-op"></th>' +
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

  const normalized = normalizeSettings(data);
  currentSettings = normalized;

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

    // 「未启用」等标记 collapsed 的分组：默认折叠，点击标题展开/收起
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

function normalizeSettings(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return FALLBACK_SETTINGS;
}

function readFormValues() {
  const values = {};
  document.querySelectorAll('[data-key]').forEach(node => {
    const key = node.dataset.key;
    if (!key) return;
    const section = node.closest('.field');
    if (!section) return;
    const parent = section.parentElement;
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

function withBridgeReady(cb) {
  const ready = window.qtReady || Promise.resolve();
  ready.then(() => {
    if (window.api && typeof window.api.get_settings === 'function') {
      cb();
    } else {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          cb(JSON.parse(saved));
        } catch (_) {}
      }
    }
  });
}

function loadSettings() {
  const onOk = (data) => {
    const normalized = normalizeSettings(data);
    renderSettings(normalized);
    const theme = normalized.flatMap(s => s.items || []).find(i => i.key === 'theme');
    if (theme) applyTheme(theme.value);
  };

  withBridgeReady((fallback) => {
    if (window.api && typeof window.api.get_settings === 'function') {
      onOk(window.api.get_settings());
      return;
    }
    if (fallback) {
      onOk(fallback);
    }
  });
}

function saveSettings() {
  const values = readFormValues();
  const persist = () => {
    if (window.api && typeof window.api.save_settings === 'function') {
      const ok = window.api.save_settings(values);
      if (ok) {
        showToast('保存成功');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
        const theme = values.theme || 'flat';
        applyTheme(theme);
        if (window.api && typeof window.api.apply_theme === 'function') {
          window.api.apply_theme(theme);
        }
        if (window.api && typeof window.api.apply_opacity === 'function' && values.orb_opacity !== undefined) {
          window.api.apply_opacity(values.orb_opacity);
        }
      }
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    showToast('保存成功');
  };

  if (window.qtReady) {
    window.qtReady.then(() => persist());
  } else {
    persist();
  }
}

function resetSettings() {
  const doReset = () => {
    if (window.api && typeof window.api.reset_settings === 'function') {
      const data = window.api.reset_settings();
      const normalized = normalizeSettings(data);
      renderSettings(normalized);
      const theme = normalized.flatMap(s => s.items || []).find(i => i.key === 'theme');
      if (theme) applyTheme(theme.value);
      const opacity = normalized.flatMap(s => s.items || []).find(i => i.key === 'orb_opacity');
      if (window.api && typeof window.api.apply_opacity === 'function' && opacity) {
        window.api.apply_opacity({ opacity: opacity.value });
      }
      showToast('已恢复默认');
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    renderSettings(FALLBACK_SETTINGS);
    applyTheme('dark');
    showToast('已恢复默认');
  };

  if (window.qtReady) {
    window.qtReady.then(() => doReset());
  } else {
    doReset();
  }
}

document.getElementById('set-save')?.addEventListener('click', saveSettings);
document.getElementById('set-reset')?.addEventListener('click', resetSettings);
document.getElementById('set-tts-demo')?.addEventListener('click', () => {
  if (window.api && typeof window.api.tts_demo === 'function') window.api.tts_demo();
});
document.getElementById('set-asr-demo')?.addEventListener('click', () => {
  if (window.api && typeof window.api.asr_demo === 'function') window.api.asr_demo();
});
document.addEventListener('change', (event) => {
  if (event.target?.dataset?.key !== 'theme') return;
  const theme = event.target.value || 'flat';
  applyTheme(theme);
  const notify = () => {
    if (window.api && typeof window.api.apply_theme === 'function') {
      window.api.apply_theme({ theme });
    }
  };
  if (window.qtReady) window.qtReady.then(notify);
  else notify();
});
document.getElementById('btn-close')?.addEventListener('click', () => {
  if (window.api && typeof window.api.hide_all === 'function') window.api.hide_all();
});
document.getElementById('set-quit')?.addEventListener('click', () => {
  if (window.api && typeof window.api.quit === 'function') window.api.quit();
});

window.addEventListener('DOMContentLoaded', () => {
  renderSettings(FALLBACK_SETTINGS);
  loadSettings();
});
window.assistant = window.assistant || {};
window.assistant.renderSettings = function (payload) {
  const normalized = normalizeSettings(payload);
  renderSettings(normalized);
  const flat = normalized
    .flatMap((s) => s.items || []);
  const theme = flat.find((i) => i.key === 'theme');
  if (theme) applyTheme(theme.value);
};
window.assistant.loadSettings = function () { loadSettings(); };
window.assistant.setTheme = function (payload) {
  applyTheme(payload && payload.theme ? payload.theme : 'dark');
};
window.assistant.setOpacity = function (payload) {
  if (!payload) return;
  const color = document.body.style.getPropertyValue('--opacity');
  document.body.style.setProperty('--opacity', payload.opacity ?? 1);
  if (color !== payload.opacity) {
    document.body.style.opacity = payload.opacity ?? 1;
  }
};
window.assistant.setActive = function (payload) {
  if (payload && payload.active) {
    document.body.style.boxShadow = '0 0 0 1px rgba(99,102,241,0.7)';
  } else {
    document.body.style.boxShadow = 'none';
  }
};
