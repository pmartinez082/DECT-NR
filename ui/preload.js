const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    startServer: (snr) => ipcRenderer.send("server-start", snr),
    startClient: (mcs) => ipcRenderer.send("client-start", mcs),

    onServerLog: (callback) =>
        ipcRenderer.on("server-log", (_, data) => callback(data)),

    onClientLog: (callback) =>
        ipcRenderer.on("client-log", (_, data) => callback(data)),
});
