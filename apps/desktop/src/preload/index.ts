import { contextBridge, ipcRenderer, webUtils } from "electron";

export type DeviceState = "device" | "unauthorized" | "offline" | "unknown";
export type QualityPreset = "low" | "medium" | "high";

export interface DeviceInfo {
  serial: string;
  state: DeviceState;
  model?: string;
  product?: string;
  device?: string;
  mirroring?: boolean;
  audio?: boolean;
  recording?: boolean;
}

const api = {
  listDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke("devices:list"),
  startMirror: (serial: string) => ipcRenderer.invoke("mirror:start", serial),
  stopMirror: (serial: string) => ipcRenderer.invoke("mirror:stop", serial),
  fullscreenMirror: (serial: string) => ipcRenderer.invoke("mirror:fullscreen", serial),
  setShortcutTarget: (serial: string) =>
    ipcRenderer.invoke("mirror:setShortcutTarget", serial),
  listShortcuts: () => ipcRenderer.invoke("shortcuts:list"),
  setDeviceAudio: (serial: string, enabled: boolean) =>
    ipcRenderer.invoke("device:setAudio", serial, enabled),
  getDeviceSession: (serial: string) => ipcRenderer.invoke("device:getSession", serial),
  setDeviceScreen: (serial: string, on: boolean) =>
    ipcRenderer.invoke("device:setScreen", serial, on),
  getDeviceScreen: (serial: string) => ipcRenderer.invoke("device:getScreen", serial),
  setDemoMode: (serial: string, enabled: boolean) =>
    ipcRenderer.invoke("device:setDemoMode", serial, enabled),
  getDemoMode: (serial: string) => ipcRenderer.invoke("device:getDemoMode", serial),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (partial: {
    quality?: QualityPreset;
    alwaysOnTop?: boolean;
    keepScreenOn?: boolean;
  }) => ipcRenderer.invoke("settings:set", partial),
  enableWireless: (serial: string) => ipcRenderer.invoke("wireless:enable", serial),
  connectWireless: (hostPort: string) => ipcRenderer.invoke("wireless:connect", hostPort),
  takeScreenshot: (serial: string) => ipcRenderer.invoke("screenshot:take", serial),
  saveScreenshot: (tempPath: string, serial: string) =>
    ipcRenderer.invoke("screenshot:save", tempPath, serial),
  copyScreenshot: (tempPath: string) => ipcRenderer.invoke("screenshot:copy", tempPath),
  discardScreenshot: (tempPath: string) => ipcRenderer.invoke("screenshot:discard", tempPath),
  startRecording: (serial: string) => ipcRenderer.invoke("record:start", serial),
  stopRecording: (serial: string) => ipcRenderer.invoke("record:stop", serial),
  isRecording: (serial: string): Promise<boolean> =>
    ipcRenderer.invoke("record:isRecording", serial),
  dropFiles: (serial: string, filePaths: string[]) =>
    ipcRenderer.invoke("files:drop", serial, filePaths),
  listFs: (serial: string, remotePath: string) =>
    ipcRenderer.invoke("fs:list", serial, remotePath),
  uploadFs: (serial: string, remoteDir: string, localPaths: string[]) =>
    ipcRenderer.invoke("fs:upload", serial, remoteDir, localPaths),
  downloadFs: (serial: string, remotePaths: string[]) =>
    ipcRenderer.invoke("fs:download", serial, remotePaths),
  mkdirFs: (serial: string, remotePath: string) =>
    ipcRenderer.invoke("fs:mkdir", serial, remotePath),
  deleteFs: (
    serial: string,
    items: Array<{ path: string; isDirectory: boolean }>
  ) => ipcRenderer.invoke("fs:delete", serial, items),
  renameFs: (serial: string, fromPath: string, newName: string) =>
    ipcRenderer.invoke("fs:rename", serial, fromPath, newName),
  duplicateFs: (
    serial: string,
    item: { path: string; isDirectory: boolean }
  ) => ipcRenderer.invoke("fs:duplicate", serial, item),
  pickUploadFiles: (): Promise<string[]> => ipcRenderer.invoke("fs:pickUpload"),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke("app:pickFiles"),
  openPath: (target: string) => ipcRenderer.invoke("shell:openPath", target),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onDevicesUpdated: (cb: (devices: DeviceInfo[]) => void) => {
    const listener = (_: unknown, devices: DeviceInfo[]) => cb(devices);
    ipcRenderer.on("devices:updated", listener);
    return () => ipcRenderer.removeListener("devices:updated", listener);
  },
  onAdbError: (cb: (message: string) => void) => {
    const listener = (_: unknown, message: string) => cb(message);
    ipcRenderer.on("adb:error", listener);
    return () => ipcRenderer.removeListener("adb:error", listener);
  },
  onMirrorError: (cb: (payload: { serial: string; error: string }) => void) => {
    const listener = (_: unknown, payload: { serial: string; error: string }) => cb(payload);
    ipcRenderer.on("mirror:error", listener);
    return () => ipcRenderer.removeListener("mirror:error", listener);
  },
  onMirrorExit: (cb: (payload: { serial: string }) => void) => {
    const listener = (_: unknown, payload: { serial: string }) => cb(payload);
    ipcRenderer.on("mirror:exit", listener);
    return () => ipcRenderer.removeListener("mirror:exit", listener);
  },
  onMirrorShortcut: (
    cb: (payload: {
      action: string;
      serial: string;
      error?: string;
      payload?: unknown;
    }) => void
  ) => {
    const listener = (
      _: unknown,
      event: { action: string; serial: string; error?: string; payload?: unknown }
    ) => cb(event);
    ipcRenderer.on("mirror:shortcut", listener);
    return () => ipcRenderer.removeListener("mirror:shortcut", listener);
  },
};

contextBridge.exposeInMainWorld("vysor", api);

export type VysorApi = typeof api;
