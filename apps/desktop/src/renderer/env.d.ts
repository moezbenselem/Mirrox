export {};

type DeviceState = "device" | "unauthorized" | "offline" | "unknown";
type QualityPreset = "low" | "medium" | "high";

interface DeviceInfo {
  serial: string;
  state: DeviceState;
  model?: string;
  product?: string;
  device?: string;
  mirroring?: boolean;
  audio?: boolean;
  recording?: boolean;
}

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface VysorApi {
  listDevices: () => Promise<DeviceInfo[]>;
  startMirror: (serial: string) => Promise<{ ok: boolean }>;
  stopMirror: (serial: string) => Promise<{ ok: boolean }>;
  fullscreenMirror: (serial: string) => Promise<{ ok: boolean }>;
  setShortcutTarget: (serial: string) => Promise<{ ok: boolean }>;
  listShortcuts: () => Promise<
    Array<{ action: string; label: string; accelerator: string }>
  >;
  setDeviceAudio: (
    serial: string,
    enabled: boolean
  ) => Promise<{ ok: boolean; audio?: boolean }>;
  getDeviceSession: (
    serial: string
  ) => Promise<{ serial: string; audio: boolean; mirroring: boolean }>;
  setDeviceScreen: (serial: string, on: boolean) => Promise<{ ok: boolean; on: boolean }>;
  getDeviceScreen: (serial: string) => Promise<{ on: boolean }>;
  setDemoMode: (
    serial: string,
    enabled: boolean
  ) => Promise<{ ok: boolean; enabled: boolean }>;
  getDemoMode: (serial: string) => Promise<{ enabled: boolean }>;
  getSettings: () => Promise<{
    quality: QualityPreset;
    alwaysOnTop: boolean;
    keepScreenOn: boolean;
    adbPath: string;
    scrcpyPath: string;
  }>;
  setSettings: (partial: {
    quality?: QualityPreset;
    alwaysOnTop?: boolean;
    keepScreenOn?: boolean;
  }) => Promise<{ quality: QualityPreset; alwaysOnTop: boolean; keepScreenOn: boolean }>;
  enableWireless: (serial: string) => Promise<{
    ip: string | null;
    port: number;
    hint: string | null;
  }>;
  connectWireless: (hostPort: string) => Promise<{ result: string }>;
  takeScreenshot: (serial: string) => Promise<{
    ok: boolean;
    path?: string;
    dataUrl?: string;
  }>;
  saveScreenshot: (
    tempPath: string,
    serial: string
  ) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  copyScreenshot: (tempPath: string) => Promise<{ ok: boolean }>;
  discardScreenshot: (tempPath: string) => Promise<{ ok: boolean }>;
  startRecording: (serial: string) => Promise<{ ok: boolean; already?: boolean }>;
  stopRecording: (serial: string) => Promise<{
    ok: boolean;
    saved?: boolean;
    path?: string;
    canceled?: boolean;
  }>;
  isRecording: (serial: string) => Promise<boolean>;
  dropFiles: (
    serial: string,
    filePaths: string[]
  ) => Promise<{
    results: Array<{ filePath: string; action: string; detail: string }>;
  }>;
  listFs: (
    serial: string,
    remotePath: string
  ) => Promise<{ path: string; entries: FsEntry[] }>;
  uploadFs: (
    serial: string,
    remoteDir: string,
    localPaths: string[]
  ) => Promise<{
    results: Array<{ localPath: string; action: "install" | "push"; detail: string }>;
  }>;
  downloadFs: (
    serial: string,
    remotePaths: string[]
  ) => Promise<{
    ok: boolean;
    canceled?: boolean;
    destDir?: string;
    results: Array<{ remotePath: string; localPath: string }>;
  }>;
  mkdirFs: (serial: string, remotePath: string) => Promise<{ ok: boolean }>;
  deleteFs: (
    serial: string,
    items: Array<{ path: string; isDirectory: boolean }>
  ) => Promise<{ ok: boolean; count: number }>;
  renameFs: (
    serial: string,
    fromPath: string,
    newName: string
  ) => Promise<{ ok: boolean; path: string }>;
  duplicateFs: (
    serial: string,
    item: { path: string; isDirectory: boolean }
  ) => Promise<{ ok: boolean; path: string }>;
  pickUploadFiles: () => Promise<string[]>;
  pickFiles: () => Promise<string[]>;
  openPath: (target: string) => Promise<void>;
  getPathForFile: (file: File) => string;
  onDevicesUpdated: (cb: (devices: DeviceInfo[]) => void) => () => void;
  onAdbError: (cb: (message: string) => void) => () => void;
  onMirrorError: (
    cb: (payload: { serial: string; error: string }) => void
  ) => () => void;
  onMirrorExit: (cb: (payload: { serial: string }) => void) => () => void;
  onMirrorShortcut: (
    cb: (payload: {
      action: string;
      serial: string;
      error?: string;
      payload?: unknown;
    }) => void
  ) => () => void;
}

declare global {
  interface Window {
    vysor: VysorApi;
  }
}
