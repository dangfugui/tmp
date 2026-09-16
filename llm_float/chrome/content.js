// content.js - injects the floating orb into every page with drag support and click actions
console.log('[LLM Float] Content script executing');
(function() {
  console.log('[LLM Float] IIFE entered');
  if (document.getElementById('llm-float-orb')) {
    console.log('[LLM Float] Orb already exists, exiting');
    return;
  }

  const orb = document.createElement('div');
  orb.id = 'llm-float-orb';
  orb.setAttribute('role', 'button');
  orb.setAttribute('aria-label', 'AI 助手');
  orb.setAttribute('tabindex', '0'); // make it focusable for keyboard if needed
  orb.className = 'orb';
  console.log('[LLM Float] Orb element created:', orb);

  orb.innerHTML = `
    <svg class="icon icon-idle" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
  `;

  document.body.appendChild(orb);
  console.log('[LLM Float] Orb appended to body');

  // Make sure events pass through the SVG to the orb div
  const icon = orb.querySelector('.icon-idle');
  if (icon) {
    icon.style.pointerEvents = 'none';
  }

  // Ensure orb itself gets pointer events
  orb.style.touchAction = 'none'; // prevent browser gestures from interfering

  // Set initial position to bottom-right (20px from edges) using left/top based on innerWidth/Height
  const updateInitialPosition = () => {
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const left = vw - 68 - 20; // right:20 => left = width - width - 20
    const top = vh - 68 - 20; // bottom:20 => top = height - height - 20
    orb.style.left = `${left}px`;
    orb.style.top = `${top}px`;
    orb.style.bottom = 'auto';
    orb.style.right = 'auto';
    console.log('[LLM Float] Position set: left=', left, 'top=', top, 'vw=', vw, 'vh=', vh);
  };
  updateInitialPosition();
  window.addEventListener('resize', updateInitialPosition);

  // Drag logic
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;
  const DRAG_THRESHOLD = 4;

  orb.addEventListener('mousedown', (e) => {
    console.log('[LLM Float] Orb mousedown', e.button);
    if (e.button === 2) { // right click
      e.preventDefault();
      e.stopPropagation();
      console.log('[LLM Float] Right click (mousedown) detected');
      const rect = orb.getBoundingClientRect();
      const screenX = window.screenX || window.screenLeft || 0;
      const screenY = window.screenY || window.screenTop || 0;
      const left = screenX + rect.left;
      const top = screenY + rect.top;
      // Position popup so its bottom-right corner touches orb's top-left corner
      const popupWidth = 400;
      const popupHeight = 500;
      let popupLeft = left - popupWidth;
      let popupTop = top - popupHeight;
      // Ensure popup stays within visible screen (optional clamp)
      if (popupLeft < 0) popupLeft = 0;
      if (popupTop < 0) popupTop = 0;
      console.log('[LLM Float] Sending openChat with position (right-click mousedown) bottom-right meets orb top-left:', {left: popupLeft, top: popupTop, width: popupWidth, height: popupHeight});
      chrome.runtime.sendMessage(
        { action: 'openChat', left: popupLeft, top: popupTop, width: popupWidth, height: popupHeight },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[LLM Float] Error sending message:', chrome.runtime.lastError);
          } else {
            console.log('[LLM Float] Message sent, response:', response);
          }
        }
      );
      return; // do not treat as drag start
    }
    // left click only for drag
    if (e.button !== 0) return;
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = orb.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    // Ensure we are using left/top positioning
    orb.style.bottom = 'auto';
    orb.style.right = 'auto';
    // Prevent text selection
    e.preventDefault();
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) {
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        isDragging = true;
        orb.classList.add('dragging');
        console.log('[LLM Float] Drag started');
      }
    }
    if (isDragging) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      orb.style.left = `${initialLeft + dx}px`;
      orb.style.top = `${initialTop + dy}px`;
    }
  }

  function onMouseUp() {
    console.log('[LLM Float] Mouseup');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (isDragging) {
      orb.classList.remove('dragging');
      console.log('[LLM Float] Drag ended');
    }
    isDragging = false;
  }

  // Left click: mock ASR
  orb.addEventListener('click', (e) => {
    e.preventDefault(); // prevent any default action
    console.log('[LLM Float] Left click: mock ASR');
    // Visual feedback: add a listening class
    orb.classList.add('listening');
    // Mock: after 2 seconds, remove listening class and show a toast
    setTimeout(() => {
      orb.classList.remove('listening');
      // Simple toast
      const toast = document.createElement('div');
      toast.textContent = 'ASR 完成（模拟）';
      toast.style.position = 'fixed';
      toast.style.bottom = '20px';
      toast.style.left = '50%';
      toast.style.transform = 'translateX(-50%)';
      toast.style.background = 'rgba(0,0,0,0.7)';
      toast.style.color = '#fff';
      toast.style.padding = '8px 16px';
      toast.style.borderRadius = '4px';
      toast.style.zIndex = '2147483647';
      toast.style.fontSize = '14px';
      document.body.appendChild(toast);
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 2000);
    }, 2000);
  });

  // Right click: prevent context menu (default browser menu) but do NOT send message here
  orb.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // prevent context menu
    e.stopPropagation();
    console.log('[LLM Float] Right click: contextmenu prevented (no message sent)');
  });

  // Also log any other mouse events for debugging
  orb.addEventListener('mouseup', (e) => {
    console.log('[LLM Float] Orb mouseup', e.button);
  });
  orb.addEventListener('mousedown', (e) => {
    console.log('[LLM Float] Orb mousedown detailed', e.button);
  }, true); // capture phase

  // Also listen on document for contextmenu to see if it's being captured elsewhere
  document.addEventListener('contextmenu', (e) => {
    console.log('[LLM Float] Document contextmenu', e.target === orb ? 'orb' : 'other');
  }, true);
})();