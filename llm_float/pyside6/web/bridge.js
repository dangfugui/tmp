// Qt WebChannel bridge.
// Exposes `window.qtApi` (may be null when previewed in a plain browser)
// and `window.qtReady`, a Promise that resolves with the bridge object.
window.qtApi = null;
window.api = null;

window.qtReady = new Promise((resolve) => {
  const attach = () => {
    if (typeof QWebChannel === "undefined" || typeof qt === "undefined" || !qt || !qt.webChannelTransport) {
      return false;
    }

    new QWebChannel(qt.webChannelTransport, (channel) => {
      window.qtApi = channel.objects.api || null;
      window.api = window.qtApi;
      resolve(window.qtApi);
    });
    return true;
  };

  if (attach()) return;

  let tries = 0;
  const timer = setInterval(() => {
    if (attach()) {
      clearInterval(timer);
      return;
    }
    tries += 1;
    if (tries > 200) {
      clearInterval(timer);
      resolve(null);
    }
  }, 50);
});

window.qtReady.then((bridge) => {
  window.api = bridge || window.api;
});
