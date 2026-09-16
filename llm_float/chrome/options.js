document.addEventListener('DOMContentLoaded', () => {
  const enableSound = document.getElementById('enableSound');
  const autoStart = document.getElementById('autoStart');
  const orbSize = document.getElementById('orbSize');
  const saveBtn = document.getElementById('save');

  // Load saved settings
  chrome.storage.sync.get(
    { enableSound: false, autoStart: false, orbSize: 68 },
    (items) => {
      enableSound.checked = items.enableSound;
      autoStart.checked = items.autoStart;
      orbSize.value = items.orbSize;
    }
  );

  // Save settings
  saveBtn.addEventListener('click', () => {
    const settings = {
      enableSound: enableSound.checked,
      autoStart: autoStart.checked,
      orbSize: parseInt(orbSize.value, 10) || 68
    };
    chrome.storage.sync.set(settings, () => {
      alert('Settings saved');
    });
  });
});