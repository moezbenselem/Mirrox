import { contextBridge, ipcRenderer, webUtils } from "electron";

export type DeviceState = "device" | "unauthorized" | "offline" | "unknown";
export type QualityPreset = "low" | "medium" | "high";
export type VideoSource = "display" | "camera";
export type CameraFacing = "front" | "back";

export interface DeviceInfo {
  serial: string;
  state: DeviceState;
  model?: string;
  product?: string;
  device?: string;
  mirroring?: boolean;
  fullscreen?: boolean;
  audio?: boolean;
  clipboardAutosync?: boolean;
  videoSource?: VideoSource;
  cameraFacing?: CameraFacing;
  recording?: boolean;
  connection?: "Cable" | "Wireless";
}

export interface DeviceDetails {
  serial: string;
  model?: string;
  androidVersion?: string;
  sdk?: string;
  battery?: { level?: number; charging?: boolean; status?: string };
  ip?: string | null;
  storage?: { used?: string; total?: string; available?: string; raw?: string };
  connection: "Cable" | "Wireless";
  displayWidth?: number;
  displayHeight?: number;
  available: boolean;
  unavailableReason?: string;
}

const api = {
  listDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke("devices:list"),
  startMirror: (serial: string) => ipcRenderer.invoke("mirror:start", serial),
  stopMirror: (serial: string) => ipcRenderer.invoke("mirror:stop", serial),
  fullscreenMirror: (serial: string) =>
    ipcRenderer.invoke("mirror:fullscreen", serial) as Promise<{
      ok: boolean;
      fullscreen: boolean;
    }>,
  setShortcutTarget: (serial: string) =>
    ipcRenderer.invoke("mirror:setShortcutTarget", serial),
  listShortcuts: () => ipcRenderer.invoke("shortcuts:list"),
  setDeviceAudio: (serial: string, enabled: boolean) =>
    ipcRenderer.invoke("device:setAudio", serial, enabled),
  setDeviceClipboard: (serial: string, enabled: boolean) =>
    ipcRenderer.invoke("device:setClipboard", serial, enabled),
  setVideoSource: (serial: string, source: VideoSource) =>
    ipcRenderer.invoke("device:setVideoSource", serial, source),
  setCameraFacing: (serial: string, facing: CameraFacing) =>
    ipcRenderer.invoke("device:setCameraFacing", serial, facing),
  setCameraId: (serial: string, cameraId: string | null) =>
    ipcRenderer.invoke("device:setCameraId", serial, cameraId),
  listCameras: (serial: string) => ipcRenderer.invoke("device:listCameras", serial),
  getDeviceInfo: (serial: string): Promise<DeviceDetails> =>
    ipcRenderer.invoke("device:getInfo", serial),
  getDeviceFramePreview: (serial: string) =>
    ipcRenderer.invoke("device:getFramePreview", serial) as Promise<{
      ok: boolean;
      dataUrl: string;
      width: number;
      height: number;
    }>,
  sendNav: (
    serial: string,
    action: "back" | "home" | "recents" | "notifications"
  ) => ipcRenderer.invoke("device:nav", serial, action),
  sendKeyevent: (serial: string, code: number | string) =>
    ipcRenderer.invoke("device:keyevent", serial, code),
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
    navBarEnabled?: boolean;
    clipboardAutosyncDefault?: boolean;
    screenshotCopyToClipboard?: boolean;
    mediaFrameApplyDefault?: boolean;
    mediaFrameFitMode?: "media-to-frame" | "frame-to-media";
    onboardingDismissed?: boolean;
    updateBannerDismissedVersion?: string | null;
  }) => ipcRenderer.invoke("settings:set", partial),
  enableWireless: (serial: string) => ipcRenderer.invoke("wireless:enable", serial),
  connectWireless: (hostPort: string) => ipcRenderer.invoke("wireless:connect", hostPort),
  pairWireless: (hostPort: string, code: string) =>
    ipcRenderer.invoke("wireless:pair", hostPort, code),
  disconnectWireless: (hostPort?: string) =>
    ipcRenderer.invoke("wireless:disconnect", hostPort),
  takeScreenshot: (serial: string) => ipcRenderer.invoke("screenshot:take", serial),
  saveScreenshot: (tempPath: string, serial: string, applyFrame = false) =>
    ipcRenderer.invoke("screenshot:save", tempPath, serial, applyFrame),
  copyScreenshot: (tempPath: string, applyFrame = false) =>
    ipcRenderer.invoke("screenshot:copy", tempPath, applyFrame),
  discardScreenshot: (tempPath: string) => ipcRenderer.invoke("screenshot:discard", tempPath),
  getMediaFrame: () => ipcRenderer.invoke("frame:get"),
  pickMediaFrame: () => ipcRenderer.invoke("frame:pick"),
  selectMediaFrame: (id: string) => ipcRenderer.invoke("frame:select", id),
  clearMediaFrame: () => ipcRenderer.invoke("frame:clear"),
  startRecording: (serial: string) => ipcRenderer.invoke("record:start", serial),
  stopRecording: (serial: string) => ipcRenderer.invoke("record:stop", serial),
  saveRecording: (tempPath: string, serial: string, applyFrame = false) =>
    ipcRenderer.invoke("record:save", tempPath, serial, applyFrame),
  discardRecording: (tempPath: string) => ipcRenderer.invoke("record:discard", tempPath),
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
  cancelTransfer: () => ipcRenderer.invoke("fs:cancelTransfer"),
  previewFs: (serial: string, remotePath: string) =>
    ipcRenderer.invoke("fs:preview", serial, remotePath),
  discardPreview: (tempPath: string) => ipcRenderer.invoke("fs:discardPreview", tempPath),
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
  pickUploadFolder: (): Promise<string[]> => ipcRenderer.invoke("fs:pickUploadFolder"),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke("app:pickFiles"),
  openPath: (target: string) => ipcRenderer.invoke("shell:openPath", target),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
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
  onClipboardHint: (cb: (payload: { serial: string }) => void) => {
    const listener = (_: unknown, payload: { serial: string }) => cb(payload);
    ipcRenderer.on("mirror:clipboard-hint", listener);
    return () => ipcRenderer.removeListener("mirror:clipboard-hint", listener);
  },
  onFsProgress: (
    cb: (payload: {
      phase: string;
      message: string | null;
      percent?: number | null;
      done?: boolean;
      canceled?: boolean;
    }) => void
  ) => {
    const listener = (
      _: unknown,
      payload: {
        phase: string;
        message: string | null;
        percent?: number | null;
        done?: boolean;
        canceled?: boolean;
      }
    ) => cb(payload);
    ipcRenderer.on("fs:progress", listener);
    return () => ipcRenderer.removeListener("fs:progress", listener);
  },
  onUpdateAvailable: (cb: (payload: { version: string }) => void) => {
    const listener = (_: unknown, payload: { version: string }) => cb(payload);
    ipcRenderer.on("updates:available", listener);
    return () => ipcRenderer.removeListener("updates:available", listener);
  },
  onUpdateProgress: (cb: (payload: { percent: number }) => void) => {
    const listener = (_: unknown, payload: { percent: number }) => cb(payload);
    ipcRenderer.on("updates:progress", listener);
    return () => ipcRenderer.removeListener("updates:progress", listener);
  },
  onUpdateReady: (cb: (payload: { version: string }) => void) => {
    const listener = (_: unknown, payload: { version: string }) => cb(payload);
    ipcRenderer.on("updates:ready", listener);
    return () => ipcRenderer.removeListener("updates:ready", listener);
  },
  onUpdateError: (cb: (message: string) => void) => {
    const listener = (_: unknown, message: string) => cb(message);
    ipcRenderer.on("updates:error", listener);
    return () => ipcRenderer.removeListener("updates:error", listener);
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

contextBridge.exposeInMainWorld("mirrox", api);

export type MirroxApi = typeof api;
