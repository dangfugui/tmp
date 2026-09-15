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
  asrFinal = payload.text;
  renderAsr('');
}

window.assistant = {
  setMode,
  onTtsSentence,
  onTtsIdle,
  onAsrState,
  onAsrPartial,
  onAsrFinal,
  setTheme(payload) {
    const theme = payload && payload.theme ? payload.theme : 'dark';
    document.body.dataset.theme = theme;
    const gradientMap = {
      dark: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 45%, #ec4899 100%)',
      blue: 'linear-gradient(135deg, #49bccf 0%, #63b3e8 45%, #22d3ee 100%)',
      light: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 45%, #6366f1 100%)',
    };
    document.body.style.background = gradientMap[theme] || gradientMap.dark;
  },
  setOpacity(payload) {
    const opacity = Math.max(0.2, Math.min(1.0, Number(payload && payload.opacity !== undefined ? payload.opacity : 1)));
    document.body.style.opacity = String(opacity);
  },
};
