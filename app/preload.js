const { contextBridge, ipcRenderer } = require("electron");

// 悬浮歌词窗口启用了 sandbox，只暴露必要的渲染进程 API。
// 回调进入页面脚本前会去掉 Electron event，避免泄露 sender 等内部对象。
contextBridge.exposeInMainWorld("api", {
  send: (channel, data) => {
    if (channel !== "control" && channel !== "floatWindowMoving") return;
    ipcRenderer.send(channel, data);
  },
  onLyric: (fn) => {
    // event 中包含 sender 等内部对象，这里只传业务参数。
    const listener = (_event, ...args) => fn(...args);
    ipcRenderer.on("currentLyric", listener);
    return () => ipcRenderer.removeListener("currentLyric", listener);
  },
  onTranslLyric: (fn) => {
    // event 中包含 sender 等内部对象，这里只传业务参数。
    const listener = (_event, ...args) => fn(...args);
    ipcRenderer.on("currentLyricTrans", listener);
    return () => ipcRenderer.removeListener("currentLyricTrans", listener);
  },
});
