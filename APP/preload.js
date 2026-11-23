"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sentinel", {
  getVersion: () => ipcRenderer.invoke("app:version"),
  getTheme: () => ipcRenderer.invoke("app:theme"),
  getState: () => ipcRenderer.invoke("app:get-state"),
  sync: () => ipcRenderer.invoke("app:sync"),
  refreshFields: () => ipcRenderer.invoke("app:refresh-fields"),
  login: (credentials) => ipcRenderer.invoke("auth:login", credentials),
  logout: () => ipcRenderer.invoke("auth:logout"),
  captureGross: (options) => ipcRenderer.invoke("capture:gross", options),
  captureStatus: () => ipcRenderer.invoke("capture:status"),
  clearCapture: () => ipcRenderer.invoke("capture:clear"),
  saveGross: (payload) => ipcRenderer.invoke("app:save-gross", payload),
  saveTare: (payload) => ipcRenderer.invoke("app:save-tare", payload),
  downloadReport: (id, password) => ipcRenderer.invoke("report:download", id, password),
  updateSettings: (payload, password) => ipcRenderer.invoke("app:update-settings", payload, password),
  resetDemo: () => ipcRenderer.invoke("app:reset-demo"),
  connectCamera: (options) => ipcRenderer.invoke("camera:connect", options),
  verifyPlate: (options) => ipcRenderer.invoke("camera:verify-plate", options),
  disconnectCamera: (role) => ipcRenderer.invoke("camera:disconnect", role),
  cameraState: () => ipcRenderer.invoke("camera:state"),
  connectContainer: (options) => ipcRenderer.invoke("container:connect", options),
  disconnectContainer: () => ipcRenderer.invoke("container:disconnect"),
  onCameraStatus: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on("camera:status", listener); return () => ipcRenderer.removeListener("camera:status", listener); },
  listPorts: () => ipcRenderer.invoke("serial:list"),
  connectSerial: (options) => ipcRenderer.invoke("serial:connect", options),
  disconnectSerial: () => ipcRenderer.invoke("serial:disconnect"),
  onScaleReading: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("scale:reading", listener);
    return () => ipcRenderer.removeListener("scale:reading", listener);
  }
});
