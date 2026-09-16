document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const messages = document.getElementById('messages');
  const btnClear = document.getElementById('btn-clear');
  const btnMin = document.getElementById('btn-min');
  const btnClose = document.getElementById('btn-close');

  function addMessage(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${sender}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    msgDiv.appendChild(bubble);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    msgDiv.appendChild(meta);
    messages.appendChild(msgDiv);
    messages.scrollTop = messages.scrollHeight;
  }

  function sendMessage() {
    const val = input.value.trim();
    if (!val) return;
    addMessage(val, 'user');
    input.value = '';
    // Mock bot reply after a short delay
    setTimeout(() => {
      addMessage('我收到了：' + val, 'bot');
    }, 500);
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', e => {
    if (e.key === 'Enter') sendMessage();
  });

  btnClear.addEventListener('click', () => {
    messages.innerHTML = '';
  });
  btnMin.addEventListener('click', () => {
    // minimize not implemented; just hide
    window.parent?.postMessage ? null : null;
  });
  btnClose.addEventListener('click', () => {
    window.close();
  });

  // Initial greeting
  addMessage('你好！我是 LLM 助手。', 'bot');
});