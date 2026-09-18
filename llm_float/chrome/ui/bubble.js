const modeSub = document.getElementById('mode-sub');
const modeAsr = document.getElementById('mode-asr');
const subPrev = document.getElementById('sub-prev');
const subCur = document.getElementById('sub-cur');
const asrDot = document.getElementById('asr-dot');
const asrText = document.getElementById('asr-text');

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
  }
}

function onTtsSentence(payload) {
  const prev = subCur.textContent;
  subPrev.textContent = prev === '等待播报…' ? '' : prev;
  subCur.textContent = payload.text;
}

function onTtsIdle() {
  subCur.textContent = '播报结束';
}

function onAsrState(payload) {
  const listening = payload.state === 'listening';
  asrDot.style.visibility = listening ? 'visible' : 'hidden';
  if (!listening && !asrFinal) {
    asrText.textContent = '已停止';
  }
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

function onAsrFinal(payload) {
  const text = payload && payload.text ? payload.text : '';
  asrFinal = asrFinal ? `${asrFinal} ${text}` : text;
  renderAsr('');
}

/* ===== Chrome 扩展桥：content script 中转的配置 / 状态推送 ===== */
window.addEventListener("message", (e) => {
  const data = e.data || {};
  if (data.kind !== "assistant" || !data.name) return;
  const fn = window.assistant[data.name];
  if (typeof fn === "function") fn(data.payload || {});
});

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

/* ===== ASR demo：Web Speech API（浏览器自带，无需 Python） ===== */
let recognition = null;
function runAsrDemo() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onAsrState({ state: 'idle' });
    asrText.textContent = '当前浏览器不支持语音识别';
    return;
  }
  setMode({ mode: 'asr' });
  onAsrState({ state: 'listening' });
  if (recognition) { try { recognition.stop(); } catch (e) { /* 忽略 */ } }
  recognition = new SR();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (ev) => {
    let interim = '', final = '';
    for (let i = 0; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) onAsrFinal({ text: final });
    else if (interim) onAsrPartial({ text: interim });
  };
  recognition.onend = () => {
    if (!asrFinal) onAsrState({ state: 'idle' });
    notifyDemoDone();
  };
  recognition.onerror = () => {
    onAsrState({ state: 'idle' });
  };
  try { recognition.start(); } catch (e) { onAsrState({ state: 'idle' }); }
}

/* ===== 兜底：iframe 加载后直接读 storage 主题 ===== */
(function initFromStorage() {
  try {
    chrome.storage.local.get(["theme"], (d) => {
      if (d.theme) document.body.dataset.theme = d.theme;
    });
  } catch (e) { /* 非扩展环境忽略 */ }
})();

function notifyDemoDone() {
  try { window.parent.postMessage({ kind: "bubble", action: "demo_done" }, "*"); } catch (e) { /* 忽略 */ }
}

window.assistant = {
  setMode,
  onTtsSentence,
  onTtsIdle,
  onAsrState,
  onAsrPartial,
  onAsrFinal,
  runDemo(payload) {
    if (payload && payload.type === 'tts') {
      runTtsDemo(payload.text || '这是一段语音播报演示，用于展示字幕气泡效果。欢迎使用悬浮助手。');
    } else if (payload && payload.type === 'asr') {
      runAsrDemo();
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
