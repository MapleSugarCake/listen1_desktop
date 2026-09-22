const { contextBridge, ipcRenderer, webFrame } = require("electron");
const events = new Set([
  "globalShortcut",
  "lyricWindow",
  "proxyConfig",
  "setZoomLevel",
  "githubOAuthCode",
]);
contextBridge.exposeInMainWorld("listen1Desktop", {
  version: 1,
  platform: process.platform,
  control: (operation, params) =>
    ipcRenderer.invoke("desktop:control", operation, params),
  openExternal: (url) => ipcRenderer.invoke("desktop:openExternal", url),
  openLogin: (url) => ipcRenderer.invoke("desktop:openLogin", url),
  cookieGet: (request) => ipcRenderer.invoke("desktop:cookieGet", request),
  cookieSet: (request) => ipcRenderer.invoke("desktop:cookieSet", request),
  cookieRemove: (request) =>
    ipcRenderer.invoke("desktop:cookieRemove", request),
  importLocalMusic: () => ipcRenderer.invoke("desktop:importLocalMusic"),
  localFileUrl: (trackId) =>
    ipcRenderer.invoke("desktop:localFileUrl", trackId),
  setLyric: (lyric) => ipcRenderer.send("currentLyric", lyric),
  setTrack: (track) => ipcRenderer.send("trackPlayingNow", track),
  setPlaying: (playing) => ipcRenderer.send("isPlaying", playing),
  setZoomLevel: (level) => {
    if (Number.isFinite(level) && level >= -3 && level <= 5)
      webFrame.setZoomLevel(level);
  },
  on: (channel, callback) => {
    if (!events.has(channel) || typeof callback !== "function")
      throw new Error("Unsupported desktop event");
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
