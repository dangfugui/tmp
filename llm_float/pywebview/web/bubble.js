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
};
