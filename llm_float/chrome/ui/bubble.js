const modeSub = document.getElementById('mode-sub');
const modeAsr = document.getElementById('mode-asr');
const subPrev = document.getElementById('sub-prev');
const subCur = document.getElementById('sub-cur');
const asrDot = document.getElementById('asr-dot');
const asrText = document.getElementById('asr-text');
const asrStopBtn = document.getElementById('asr-stop');

// 初始化拉取透明度
try {
  chrome.storage.local.get(["orb_opacity"], (d) => {
    if (d.orb_opacity !== undefined) document.body.style.opacity = String(Math.max(0.2, Math.min(1.0, Number(d.orb_opacity))));
  });
} catch (e) {}

let currentMode = 'subtitle';
let asrFinal = '';

function setMode(payload) {
  currentMode = payload && payload.mode ? payload.mode : 'subtitle';
  modeSub.classList.toggle('active', currentMode === 'subtitle');
  modeAsr.classList.toggle('active', currentMode === 'asr');
  document.body.dataset.mode = currentMode === 'asr' ? 'asr' : 'subtitle';

  if (currentMode === 'subtitle') {
    subPrev.textContent = '';
    subCur.textContent = '等待播报…';
  } else if (currentMode === 'asr') {
    asrFinal = '';
    asrText.textContent = '聆听中…';
    if (asrStopBtn) asrStopBtn.style.display = '';
  }
}

function onTtsSentence(payload) {
  const prev = subCur.textContent;
  subPrev.textContent = prev === '等待播报…' ? '' : prev;
  subCur.textContent = payload.text;
  // 从左到右扫入动画（每次新句子重新触发）
  subCur.classList.remove('scan');
  void subCur.offsetWidth; // 强制重排以重启动画
  subCur.classList.add('scan');
}

function onTtsIdle() {
  subCur.textContent = '播报结束';
}

function onAsrState(payload) {
  const state = payload.state;
  const listening = state === 'listening';
  const recognizing = state === 'recognizing';
  asrDot.style.visibility = listening ? 'visible' : 'hidden';
  if (asrStopBtn) asrStopBtn.style.display = listening ? '' : 'none';
  const wave = document.getElementById('asr-wave');
  const loading = document.getElementById('asr-loading');
  if (wave) wave.style.display = listening ? '' : 'none';
  if (loading) loading.style.display = recognizing ? '' : 'none';
  if (recognizing) {
    asrText.textContent = '识别中…';
  } else if (!listening && !asrFinal) {
    asrText.textContent = '已停止';
  }
}

/* 停止按钮：通知 content 停止录音/识别并收尾（结果发到聊天窗） */
if (asrStopBtn) {
  asrStopBtn.addEventListener('click', () => {
    console.log('[llm-float][bubble] asr stop clicked');
    try { window.parent.postMessage({ kind: 'bubble', action: 'asr_stop' }, '*'); } catch (e) { /* 忽略 */ }
  });
}

function renderAsr(interim) {
  if (asrFinal) {
    asrText.textContent = asrFinal;
    if (interim) {
      asrText.textContent += ' ' + interim;
    }
  } else if (interim) {
    asrText.textContent = interim;
  } else {
    asrText.textContent = '聆听中…';
  }
}

function onAsrPartial(payload) {
  renderAsr(payload.text);
}

function onAsrVolume(payload) {
  const levels = payload && payload.levels ? payload.levels : [];
  const bars = document.querySelectorAll('#asr-wave i');
  bars.forEach((bar, i) => {
    const v = levels[i] || 0;
    const h = Math.max(6, Math.min(60, v * 120));
    bar.style.height = h + 'px';
    bar.style.animation = 'none';
  });
}

function onAsrFinal(payload) {
  const text = payload && payload.text ? payload.text : '';
  asrFinal = asrFinal ? `${asrFinal} ${text}` : text;
  renderAsr('');
}

/* ===== TTS demo：逐句朗读 + 字幕推进（浏览器 speechSynthesis，无需 Python） ===== */
let ttsQueue = [];
function runTtsDemo(text) {
  const sentences = String(text).split(/[。！？!?；;]/).map(s => s.trim()).filter(Boolean);
  if (!sentences.length) sentences.push(String(text));
  ttsQueue = sentences;
  setMode({ mode: 'subtitle' });
  if (!('speechSynthesis' in window)) {
    subPrev.textContent = '';
    subCur.textContent = '当前浏览器不支持语音合成';
    return;
  }
  try { speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
  speakNext();
}

function speakNext() {
  if (!ttsQueue.length) {
    onTtsIdle();
    notifyDemoDone();
    return;
  }
  const sentence = ttsQueue.shift();
  onTtsSentence({ text: sentence });
  const u = new SpeechSynthesisUtterance(sentence);
  u.lang = 'zh-CN';
  u.rate = 1.0;
  u.onend = () => speakNext();
  u.onerror = () => speakNext();
  try { speechSynthesis.speak(u); } catch (e) { speakNext(); }
}

function notifyDemoDone() {
  try { window.parent.postMessage({ kind: "bubble", action: "demo_done" }, "*"); } catch (e) { /* 忽略 */ }
}

window.assistant = {
  setMode,
  onTtsSentence,
  onTtsIdle,
  onAsrState,
  onAsrPartial,
  onAsrVolume,
  onAsrFinal,
  stopDemo() {
    // 互斥时调用：停止正在播放的 TTS（ASR 由 content 顶层停止）
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
  },
  runDemo(payload) {
    // 切换 demo 前先停旧的 TTS（ASR 由 content 顶层管理）
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
    if (payload && payload.type === 'tts') {
      runTtsDemo(payload.text || '这是一段语音播报演示，用于展示字幕气泡效果。欢迎使用悬浮助手。');
    }
  },
  setTheme(payload) {
    const theme = payload && payload.theme ? payload.theme : 'dark';
    document.body.dataset.theme = theme;
  },
  setOpacity(payload) {
    const opacity = Math.max(0.2, Math.min(1.0, Number(payload && payload.opacity !== undefined ? payload.opacity : 1)));
    document.body.style.opacity = String(opacity);
  },
};
