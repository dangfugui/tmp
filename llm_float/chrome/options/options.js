/* LLM Float 设置页（Chrome 扩展完整版）
 * 设置项 schema 与 PySide6 版一致；存储走 chrome.storage.local，保存后广播各标签页刷新。
 */
function getSchema() {
  return [
  {
    section: t('sec.basic'),
    items: [
      { key: 'orb_opacity', label: t('field.orb_opacity'), type: 'number', value: 1.0, min: 0.2, max: 1.0, step: 0.05 },
      { key: 'theme', label: t('field.theme'), type: 'select', value: 'glass', options: [['glass', t('theme.glass')], ['flat', t('theme.flat')], ['neon', t('theme.neon')], ['macaron', t('theme.macaron')], ['metal', t('theme.metal')], ['candy', t('theme.candy')], ['morandi', t('theme.morandi')], ['synthwave', t('theme.synthwave')], ['green', t('theme.green')], ['mono', t('theme.mono')], ['brand', t('theme.brand')], ['pageagent', t('theme.pageagent')]] },
      { key: 'orb_size', label: t('field.orb_size'), type: 'number', value: 68, min: 40, max: 96, step: 1 },
      { key: 'orb_action_left', label: t('field.orb_left'), type: 'select', value: 'open_chat', options: ORB_ACTIONS.map(a => [a.value, a.label]) },
      { key: 'orb_action_right', label: t('field.orb_right'), type: 'select', value: 'open_asr', options: ORB_ACTIONS.map(a => [a.value, a.label]) },
      { key: 'orb_action_wheel', label: t('field.orb_wheel'), type: 'select', value: 'none', options: ORB_ACTIONS.map(a => [a.value, a.label]) },
      { key: 'agent_workdir', label: t('field.workdir'), type: 'agent_workdir', value: '' },
      { key: 'context_turns', label: t('field.context_turns'), type: 'number', value: 10, min: 1, max: 50, step: 1 },
      { key: 'max_tool_rounds', label: t('field.max_tool_rounds'), type: 'number', value: 20, min: 1, max: 100, step: 1 },
      { key: 'max_conversations', label: t('field.max_convs'), type: 'number', value: 20, min: 1, max: 999, step: 1 },
      { key: 'py_bridge_enabled', label: t('field.py_bridge'), type: 'bool', value: false },
      { key: 'language', label: t('field.language'), type: 'select', value: 'zh', options: [['zh', '简体中文'], ['en', 'English']] },
    ],
  },
  {
    section: t('sec.chat'),
    collapsed: true,
    items: [
      { key: 'chat_profiles', label: '', type: 'chat_profiles', value: [
        { chatName: '默认', urlRegex: '.*', baseUrl: 'http://localhost:8088', agentId: 'default', ttsTarget: '', inputSelector: '', prompt: '', token: '', mode: 'qwenpaw' },
      ] },
    ],
  },
  {
    section: t('sec.links'),
    collapsed: true,
    items: [
      { key: 'quick_links', label: '', type: 'quick_links', value: [
        { name: '百度', url: 'https://www.baidu.com' },
      ] },
    ],
  },
  {
    section: t('sec.tts'),
    collapsed: true,
    segmentKey: 'tts_mode',
    segmentOptions: [['off', t('seg.off')], ['stream', t('seg.stream')], ['http', t('seg.http')]],
    segmentDefault: 'stream',
    items: [
      // 流式 TTS 配置
      { key: 'tts_ws_host', label: t('tts.ws_host'), type: 'text', value: '', showWhen: ['stream'] },
      { key: 'tts_ws_api_key', label: t('tts.ws_key'), type: 'password', value: '', showWhen: ['stream'] },
      { key: 'tts_ws_model', label: t('tts.ws_model'), type: 'text', value: 'qwen3-tts', showWhen: ['stream'] },
      { key: 'tts_ws_voice', label: t('tts.ws_voice'), type: 'text', value: 'vivian', showWhen: ['stream'] },
      { key: 'tts_ws_language', label: t('tts.ws_lang'), type: 'text', value: 'zh', showWhen: ['stream'] },
      { key: 'tts_ws_speed', label: t('tts.ws_speed'), type: 'number', value: 1.0, min: 0.5, max: 2.0, step: 0.1, showWhen: ['stream'] },
      { key: 'tts_ws_instructions', label: t('tts.ws_instr'), type: 'text', value: '', showWhen: ['stream'] },
      // 非流式 TTS 配置
      { key: 'tts_http_host', label: t('tts.http_host'), type: 'text', value: '', showWhen: ['http'] },
      { key: 'tts_http_api_key', label: t('tts.http_key'), type: 'password', value: '', showWhen: ['http'] },
      { key: 'tts_http_model', label: t('tts.http_model'), type: 'text', value: 'qwen3-tts', showWhen: ['http'] },
      { key: 'tts_http_voice', label: t('tts.http_voice'), type: 'text', value: 'vivian', showWhen: ['http'] },
      { key: 'tts_http_response_format', label: t('tts.http_fmt'), type: 'text', value: 'pcm', showWhen: ['http'] },
      { key: 'tts_http_sample_rate', label: t('tts.http_rate'), type: 'number', value: 24000, min: 8000, max: 48000, step: 1000, showWhen: ['http'] },
      { key: 'tts_http_language', label: t('tts.http_lang'), type: 'text', value: 'zh', showWhen: ['http'] },
      { key: 'tts_http_speed', label: t('tts.http_speed'), type: 'number', value: 1.0, min: 0.5, max: 2.0, step: 0.1, showWhen: ['http'] },
      { key: 'tts_http_instructions', label: t('tts.http_instr'), type: 'text', value: '', showWhen: ['http'] },
      // 通用配置
      { key: 'tts_hide_time', label: t('tts.hide_time'), type: 'number', value: 1, min: 0, max: 10, step: 0.5, showWhen: ['stream', 'http'] },
      { key: 'tts_max_length', label: t('tts.max_len'), type: 'number', value: 50, min: 10, max: 500, step: 10, showWhen: ['stream', 'http'] },
    ],
  },
  {
    section: t('sec.asr'),
    collapsed: true,
    segmentKey: 'asr_mode',
    segmentOptions: [['off', t('seg.off')], ['stream', t('seg.stream')], ['http', t('seg.http')]],
    segmentDefault: 'http',
    items: [
      // ASR 接口配置（非流式 POST /v1/audio/transcriptions；流式用浏览器自带识别，不用接口）
      { key: 'asr_host', label: t('asr.host'), type: 'text', value: '', showWhen: ['http'] },
      { key: 'asr_api_key', label: t('asr.key'), type: 'password', value: '', showWhen: ['http'] },
      { key: 'asr_model', label: t('asr.model'), type: 'text', value: 'qwen3-asr', showWhen: ['http'] },
      { key: 'asr_language', label: t('asr.lang'), type: 'text', value: 'zh', showWhen: ['http'] },
      { key: 'asr_send_delay', label: t('asr.delay'), type: 'number', value: 2, min: 0, max: 10, step: 0.5, showWhen: ['stream', 'http'] },
      { key: 'asr_silence_stop', label: t('asr.silence'), type: 'number', value: 5, min: 0, max: 30, step: 1, showWhen: ['http'] },
      { key: 'asr_wake_threshold', label: t('asr.wake'), type: 'number', value: 0, min: 0, max: 100, step: 5, showWhen: ['http', 'stream'] },
    ],
  },
  {
    section: t('sec.advanced'),
    collapsed: true,
    items: [
      { key: 'autostart', label: t('adv.autostart'), type: 'bool', value: false },
      { key: 'default_mode', label: t('adv.default_mode'), type: 'select', value: 'chat', options: [['chat', t('mode.chat')], ['subtitle', t('mode.subtitle')], ['asr', t('mode.asr')]] },
      { key: 'base_url', label: t('adv.base_url'), type: 'text', value: 'https://api.example.com/v1' },
      { key: 'api_key', label: 'API Key', type: 'password', value: '' },
      { key: 'model', label: '模型', type: 'select', value: 'gpt-4o', options: [['gpt-4o', 'gpt-4o'], ['gpt-4o-mini', 'gpt-4o-mini'], ['qwen-max', 'qwen-max'], ['custom', '自定义']] },
      { key: 'system_prompt', label: 'System Prompt', type: 'textarea', value: '你是一个有用的桌面助手，回答尽量简洁。' },
      { key: 'temperature', label: 'temperature', type: 'number', value: 0.7, min: 0, max: 2, step: 0.1 },
      { key: 'max_tokens', label: t('adv.max_tokens'), type: 'number', value: 2048, min: 256, max: 32768, step: 256 },
      { key: 'stream', label: t('adv.stream_out'), type: 'bool', value: true },

      { key: 'hotkey_chat', label: t('adv.hotkey_chat'), type: 'text', value: 'Ctrl+Alt+Space' },
      { key: 'hotkey_asr', label: t('adv.hotkey_asr'), type: 'text', value: 'Ctrl+Alt+R' },
      { key: 'log_level', label: t('adv.log_level'), type: 'select', value: 'INFO', options: [['DEBUG', 'DEBUG'], ['INFO', 'INFO'], ['WARN', 'WARN'], ['ERROR', 'ERROR']] },
      { key: 'data_dir', label: t('adv.data_dir'), type: 'text', value: './data' },
      { key: 'proxy', label: t('adv.proxy'), type: 'text', value: '' },
      { key: 'features', label: t('adv.features'), type: 'list', value: ['chat', 'subtitle'], options: [['chat', t('mode.chat')], ['subtitle', t('mode.subtitle')], ['asr', t('mode.asr')], ['settings', t('mode.settings')]] },
    ],
  },
];
}

let currentSettings = [];

function applyStaticI18n() {
  document.getElementById("opt-title").textContent = t("options.title");
  document.getElementById("opt-subtitle").textContent = t("options.subtitle");
  document.getElementById("set-reset").textContent = t("options.reset");
  document.getElementById("set-import").textContent = t("options.import");
  document.getElementById("set-export").textContent = t("options.export");
  document.getElementById("set-import-chat").textContent = t("options.import_chat");
  document.getElementById("set-export-chat").textContent = t("options.export_chat");
  document.getElementById("set-save").textContent = t("options.save");
}
initI18n(() => { applyStaticI18n(); loadSettings(); });
function showToast(msg, timeout = 1600) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), timeout);
}

/* Agent 工作目录句柄持久化：FileSystemHandle 不能存 chrome.storage（非 JSON），走 IndexedDB（扩展页同 origin 共享） */
const AGENT_IDB = 'llm-float';
function idbGet(key) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(AGENT_IDB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('handles'); } catch (e) {} };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('handles', 'readonly');
          const get = tx.objectStore('handles').get(key);
          get.onsuccess = () => resolve(get.result || null);
          get.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      };
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}
function idbSet(key, val) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(AGENT_IDB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('handles'); } catch (e) {} };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('handles', 'readwrite');
          tx.objectStore('handles').put(val, key);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (e) { resolve(false); }
      };
      req.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

/* 旧版主题名兼容：dark/blue/light 已从 10 组主题中移除，映射到 flat */
function normalizeTheme(t) {
  return (t === 'dark' || t === 'blue' || t === 'light') ? 'flat' : (t || 'flat');
}

function applyTheme(theme) {
  document.body.dataset.theme = normalizeTheme(theme);
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
    ['ttsTarget', 'TTS元素 id 或 CSS 选择器', p.ttsTarget || ''],
    ['inputSelector', '输入框 id 或 CSS 选择器', p.inputSelector || ''],
    ['prompt', '首次对话提示词（留空不拼接）', p.prompt || ''],
    ['token', 'Token', p.token || ''],
  ];
  const modeTd = document.createElement('td');
  const modeSel = document.createElement('select');
  modeSel.dataset.pk = 'mode';
  [['qwenpaw', 'QwenPaw'], ['llm', 'LLM(Agent)']].forEach(([v, l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    modeSel.appendChild(opt);
  });
  modeSel.value = p.mode || 'qwenpaw';
  modeTd.appendChild(modeSel);
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
  row.appendChild(modeTd);
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

function buildQuickLinkCard(link) {
  link = link || {};
  const card = document.createElement('div');
  card.className = 'quick-link-row';
  card.style.cssText = 'display:flex;gap:6px;align-items:center;padding:6px;border:1px solid var(--input-border);border-radius:8px;';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.dataset.field = 'name';
  nameInput.placeholder = '名称';
  nameInput.value = link.name || '';
  nameInput.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--input-border);border-radius:6px;font-size:12px;background:var(--input-bg);color:var(--text-primary);';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.dataset.field = 'url';
  urlInput.placeholder = 'URL';
  urlInput.value = link.url || '';
  urlInput.style.cssText = 'flex:1;padding:5px 8px;border:1px solid var(--input-border);border-radius:6px;font-size:12px;background:var(--input-bg);color:var(--text-primary);';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'profile-del';
  del.title = '删除';
  del.textContent = '×';
  del.style.cssText = 'flex:none;';
  del.addEventListener('click', () => card.remove());
  card.appendChild(nameInput);
  card.appendChild(urlInput);
  card.appendChild(del);
  return card;
}

function prepareField(item) {
  const field = document.createElement('div');
  field.className = 'field';
  if (item.type === 'chat_profiles' || item.type === 'quick_links') field.classList.add('field-wide');
  const label = document.createElement('label');
  label.textContent = item.label || item.key;
  if (item.type !== 'chat_profiles' && item.type !== 'quick_links') field.appendChild(label);

  const controlWrap = document.createElement('div');

  if (item.type === 'bool') {
    const check = document.createElement('label');
    check.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!item.value;
    input.dataset.key = item.key;
    check.appendChild(input);
    check.appendChild(document.createTextNode(t('field.enable')));
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
    if (item.key === 'theme') {
      select.style.flex = '1 1 auto';
      select.style.width = 'auto';
      select.style.minWidth = '150px';
      controlWrap.style.display = 'flex';
      controlWrap.style.alignItems = 'center';
      controlWrap.style.gap = '10px';
    }
    controlWrap.appendChild(select);
    if (item.key === 'theme') {
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'theme-preview-btn';
      preview.textContent = t('field.preview_theme');
      preview.title = '打开 11 组悬浮球风格预览页';
      preview.addEventListener('click', () => {
        try { chrome.tabs.create({ url: chrome.runtime.getURL('data/design_preview.html') }); } catch (e) { /* 忽略 */ }
      });
      controlWrap.appendChild(preview);
    }
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
  } else if (item.type === 'agent_workdir') {
    const wrap = document.createElement('div');
    wrap.className = 'workdir';
    const info = document.createElement('input');
    info.type = 'text';
    info.readOnly = true;
    info.placeholder = '未授权（agent 文件工具不可用，选目录后免 Python 读写该目录树）';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'workdir-pick';
    btn.textContent = t('field.pick_dir');
    btn.addEventListener('click', async () => {
      try {
        const h = await window.showDirectoryPicker({ mode: 'readwrite' });
        await idbSet('agent_workdir', h);
        info.value = h.name;
        showToast('已授权工作目录：' + h.name);
      } catch (e) { /* 用户取消 */ }
    });
    wrap.append(info, btn);
    controlWrap.appendChild(wrap);
    idbGet('agent_workdir').then((h) => { if (h) info.value = h.name; });
  } else if (item.type === 'quick_links') {
    controlWrap.innerHTML = '';
    controlWrap.dataset.key = item.key;
    controlWrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    (Array.isArray(item.value) ? item.value : []).forEach((link) => {
      controlWrap.appendChild(buildQuickLinkCard(link));
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'profile-add';
    add.textContent = t('links.add');
    add.style.cssText = 'grid-column:1/-1;';
    add.addEventListener('click', () => {
      controlWrap.insertBefore(buildQuickLinkCard({}), add);
    });
    controlWrap.appendChild(add);
  } else if (item.type === 'chat_profiles') {
    const wrap = document.createElement('div');
    wrap.className = 'profiles';
    wrap.dataset.key = item.key;
    const table = document.createElement('table');
    table.className = 'profile-table';
    table.innerHTML = '<thead><tr>' +
      '<th>' + t('chat_profile.col_name') + '</th><th>' + t('chat_profile.col_regex') + '</th><th>Base URL</th><th>Agent ID</th><th>' + t('chat_profile.col_tts') + '</th><th>' + t('chat_profile.col_input') + '</th><th>' + t('chat_profile.col_prompt') + '</th><th>Token</th><th>' + t('chat_profile.col_mode') + '</th><th class="profile-op"></th>' +
      '</tr></thead>';
    const tbody = document.createElement('tbody');
    tbody.className = 'profile-rows';
    (Array.isArray(item.value) ? item.value : []).forEach((p) => tbody.appendChild(buildProfileRow(p)));
    table.appendChild(tbody);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'profile-add';
    add.textContent = t('chat_profile.add');
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
    (section.items || []).forEach(item => {
      // 根据模式判断是否显示
      if (item.showWhen && section.segment && !item.showWhen.includes(section.segment)) return;
      list.appendChild(prepareField(item));
    });
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
          try {
            chrome.storage.local.set({ [section.segmentKey]: val }, () => {
              // 存完再重新渲染，确保拿到最新值
              loadSettings();
            });
          } catch (e) { /* 忽略 */ }
        });
        seg.appendChild(b);
      });
      title.appendChild(seg);
    }

    // 所有区域都可折叠；collapsed:true 默认折叠，否则默认展开
    title.classList.add('collapsible');
    if (section.collapsed) {
      title.classList.add('collapsed');
      list.classList.add('hidden');
    }
    title.addEventListener('click', () => {
      const collapsed = list.classList.toggle('hidden');
      title.classList.toggle('collapsed', collapsed);
    });
  });
}

/* 用 storage 扁平值覆盖 schema 默认值 */
function mergeWithStorage(schema, values) {
  return schema.map(section => ({
    ...section,
    segment: section.segmentKey ? (values && values[section.segmentKey] !== undefined ? String(values[section.segmentKey]) : (section.segmentDefault || (section.segmentOptions && section.segmentOptions[0] ? section.segmentOptions[0][0] : ""))) : undefined,
    items: (section.items || []).map(item => ({
      ...item,
      value: (item.key === 'theme' ? normalizeTheme(values && values[item.key] !== undefined ? values[item.key] : item.value) : (values && values[item.key] !== undefined ? values[item.key] : item.value)),
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
    if (field.type === 'quick_links') {
      val = Array.from(node.querySelectorAll('.quick-link-row')).map((row) => {
        const name = row.querySelector('input[data-field="name"]')?.value || '';
        const url = row.querySelector('input[data-field="url"]')?.value || '';
        return { name, url };
      }).filter((o) => o.name || o.url);
    } else if (field.type === 'chat_profiles') {
      val = Array.from(node.querySelectorAll('.profile-row')).map((row) => {
        const obj = {};
        row.querySelectorAll('input[data-pk], select[data-pk]').forEach((inp) => { obj[inp.dataset.pk] = inp.value.trim(); });
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
    const merged = mergeWithStorage(getSchema(), all);
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
    showToast(t('toast.saved'));
    const theme = values.theme || 'flat';
    applyTheme(theme);
    broadcastConfig();
  });
}

async function resetSettings() {
  // 从 data/default-config.json 读取默认配置，重新渲染整个表单
  try {
    const resp = await fetch(chrome.runtime.getURL("data/default-config.json"));
    const defaults = await resp.json();
    // 用默认配置重新渲染整个设置页面
    renderSettings(currentSettings.map(section => ({
      ...section,
      items: section.items.map(item => ({
        ...item,
        value: defaults[item.key] !== undefined ? defaults[item.key] : item.value
      }))
    })));
    showToast(t('toast.reset_done'));
  } catch (e) {
    showToast('恢复默认失败: ' + (e.message || e));
  }
}

/* ---------- 导入导出 ---------- */
async function exportSettings() {
  try {
    const all = await chrome.storage.local.get(null);
    const cfg = {};
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith("chat_conv_")) cfg[k] = v;
    }
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "llm-float-config.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("已导出配置");
  } catch (e) { showToast("导出失败: " + (e.message || e)); }
}

function importSettings() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const cfg = {};
      for (const [k, v] of Object.entries(data)) {
        if (!k.startsWith("chat_conv_")) cfg[k] = v;
      }
      await chrome.storage.local.set(cfg);
      showToast("已导入配置，刷新生效");
      setTimeout(() => location.reload(), 800);
    } catch (e) { showToast("导入失败: " + (e.message || e)); }
  };
  input.click();
}

/* ---------- 事件绑定 ---------- */
document.getElementById('set-save')?.addEventListener('click', saveSettings);
document.getElementById('set-reset')?.addEventListener('click', resetSettings);
async function exportChatHistory() {
  try {
    const all = await chrome.storage.local.get(null);
    const chat = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith("chat_conv_")) chat[k] = v;
    }
    const blob = new Blob([JSON.stringify(chat, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "llm-float-chat-history.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("已导出聊天记录");
  } catch (e) { showToast("导出失败: " + (e.message || e)); }
}

function importChatHistory() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const chat = {};
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith("chat_conv_")) chat[k] = v;
      }
      await chrome.storage.local.set(chat);
      showToast("已导入聊天记录，刷新生效");
      setTimeout(() => location.reload(), 800);
    } catch (e) { showToast("导入失败: " + (e.message || e)); }
  };
  input.click();
}

document.getElementById('set-export')?.addEventListener('click', exportSettings);
document.getElementById('set-import')?.addEventListener('click', importSettings);
document.getElementById('set-export-chat')?.addEventListener('click', exportChatHistory);
document.getElementById('set-import-chat')?.addEventListener('click', importChatHistory);
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

