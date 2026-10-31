const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("studio", {
  invoke: (method, params = {}) =>
    ipcRenderer.invoke("studio:invoke", method, params),
  onEvent: (callback) => {
    const handler = (_, event) => callback(event);
    ipcRenderer.on("studio:event", handler);
    return () => ipcRenderer.removeListener("studio:event", handler);
  },
  onBeforeClose: (callback) => {
    const handler = async (_, id) => {
      try {
        await callback();
      } finally {
        ipcRenderer.send("studio:flushed", id);
      }
    };
    ipcRenderer.on("studio:prepare-close", handler);
    return () => ipcRenderer.removeListener("studio:prepare-close", handler);
  },
  chooseFolder: () => ipcRenderer.invoke("studio:folder"),
  chooseFile: () => ipcRenderer.invoke("studio:file"),
  paths: (files) =>
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  openExternal: (url) => ipcRenderer.invoke("studio:external", url),
  reveal: (id) => ipcRenderer.invoke("studio:reveal", id),
  startDrag: (id) => ipcRenderer.send("studio:drag", id),
  window: (action) => ipcRenderer.send("studio:window", action),
  update: {
    state: () => ipcRenderer.invoke("studio:update", "state"),
    check: (force = false) => ipcRenderer.invoke("studio:update", "check", force),
    download: () => ipcRenderer.invoke("studio:update", "download"),
    apply: () => ipcRenderer.invoke("studio:update", "apply"),
    skip: () => ipcRenderer.invoke("studio:update", "skip"),
    cancel: () => ipcRenderer.invoke("studio:update", "cancel"),
    onState: (callback) => {
      const handler = (_, state) => callback(state);
      ipcRenderer.on("studio:update", handler);
      return () => ipcRenderer.removeListener("studio:update", handler);
    },
  },
});
