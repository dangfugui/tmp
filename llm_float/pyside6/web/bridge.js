// Qt WebChannel bridge.
// Exposes `window.qtApi` (may be null when previewed in a plain browser)
// and `window.qtReady`, a Promise that resolves with the bridge object.
window.qtApi = null;

window.qtReady = new Promise((resolve) => {
  if (typeof QWebChannel === "undefined" || typeof qt === "undefined" || !qt.webChannelTransport) {
    resolve(null);
    return;
  }
  new QWebChannel(qt.webChannelTransport, (channel) => {
    window.qtApi = channel.objects.api;
    resolve(window.qtApi);
  });
});
