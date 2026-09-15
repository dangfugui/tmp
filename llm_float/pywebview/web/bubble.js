/* Floating bubble: shows either TTS subtitle (lyrics style) or ASR text.
 * Everything it displays is pushed from Python (window.assistant.*). */

const modeSub = document.getElementById("mode-sub");
const modeAsr = document.getElementById("mode-asr");
const subPrev = document.getElementById("sub-prev");
const subCur = document.getElementById("sub-cur");
const asrDot = document.getElementById("asr-dot");
const asrText = document.getElementById("asr-text");

let currentMode = null;
let asrFinal = "";

function setMode(payload) {
  currentMode = payload.mode;
  modeSub.classList.toggle("active", currentMode === "subtitle");
  modeAsr.classList.toggle("active", currentMode === "asr");

  if (currentMode === "subtitle") {
    subPrev.textContent = "";
    subCur.textContent = "等待播报…";
  } else if (currentMode === "asr") {
    asrFinal = "";
    asrText.innerHTML = '<span class="interim">聆听中…</span>';
  }
}

/* ---------- subtitle ---------- */
function onTtsSentence(payload) {
  const prev = subCur.textContent;
  subPrev.textContent = prev === "等待播报…" ? "" : prev;
  subCur.textContent = payload.text;
}

function onTtsIdle() {
  subCur.textContent = "播报结束";
}

/* ---------- asr ---------- */
function onAsrState(payload) {
  const listening = payload.state === "listening";
  asrDot.style.visibility = listening ? "visible" : "hidden";
  if (!listening && !asrFinal) {
    asrText.innerHTML = '<span class="interim">已停止</span>';
  }
}

function renderAsr(interim) {
  asrText.innerHTML = "";
  if (asrFinal) {
    asrText.appendChild(document.createTextNode(asrFinal));
  }
  if (interim) {
    const span = document.createElement("span");
    span.className = "interim";
    span.textContent = interim;
    asrText.appendChild(span);
  }
}

function onAsrPartial(payload) {
  renderAsr(payload.text);
}

function onAsrFinal(payload) {
  asrFinal = payload.text;
  renderAsr("");
}

window.assistant = {
  setMode,
  onTtsSentence,
  onTtsIdle,
  onAsrState,
  onAsrPartial,
  onAsrFinal,
  setTheme(payload) {
    const theme = payload.theme;
    document.body.dataset.theme = theme;
    const gradientMap = {
      dark: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 45%, #ec4899 100%)",
      blue: "linear-gradient(135deg, #49bccf 0%, #63b3e8 45%, #22d3ee 100%)",
      light: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 45%, #6366f1 100%)",
    };
    document.body.style.background = gradientMap[theme] || gradientMap.dark;
  },
  setOpacity(payload) {
    const opacity = Math.max(0.2, Math.min(1.0, payload.opacity));
    document.body.style.opacity = String(opacity);
  },
};
