export {};

type DeviceState = "device" | "unauthorized" | "offline" | "unknown";
type QualityPreset = "low" | "medium" | "high";
type VideoSource = "display" | "camera";
type CameraFacing = "front" | "back";

interface DeviceInfo {
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

interface DeviceDetails {
  serial: string;
  model?: string;
  androidVersion?: string;
  sdk?: string;
  battery?: { level?: number; charging?: boolean; status?: string };
  ip?: string | null;
  storage?: { used?: string; total?: string; available?: string; raw?: string };
  connection: "Cable" | "Wireless";
  available: boolean;
  unavailableReason?: string;
}

interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface MirroxApi {
  listDevices: () => Promise<DeviceInfo[]>;
  startMirror: (serial: string) => Promise<{ ok: boolean }>;
  stopMirror: (serial: string) => Promise<{ ok: boolean }>;
  fullscreenMirror: (serial: string) => Promise<{ ok: boolean; fullscreen: boolean }>;
  setShortcutTarget: (serial: string) => Promise<{ ok: boolean }>;
  listShortcuts: () => Promise<
    Array<{ action: string; label: string; accelerator: string }>
  >;
  setDeviceAudio: (
    serial: string,
    enabled: boolean
  ) => Promise<{ ok: boolean; audio?: boolean }>;
  setDeviceClipboard: (
    serial: string,
    enabled: boolean
  ) => Promise<{ ok: boolean; clipboardAutosync?: boolean }>;
  setVideoSource: (
    serial: string,
    source: VideoSource
  ) => Promise<{ ok: boolean; videoSource?: VideoSource }>;
  setCameraFacing: (
    serial: string,
    facing: CameraFacing
  ) => Promise<{ ok: boolean; cameraFacing?: CameraFacing }>;
  setCameraId: (
    serial: string,
    cameraId: string | null
  ) => Promise<{ ok: boolean; cameraId?: string | null }>;
  listCameras: (serial: string) => Promise<{
    cameras: Array<{ id: string; label: string }>;
    raw: string;
  }>;
  getDeviceInfo: (serial: string) => Promise<DeviceDetails>;
  sendNav: (
    serial: string,
    action: "back" | "home" | "recents" | "notifications"
  ) => Promise<{ ok: boolean }>;
  sendKeyevent: (serial: string, code: number | string) => Promise<{ ok: boolean }>;
  getDeviceSession: (serial: string) => Promise<{
    serial: string;
    audio: boolean;
    clipboardAutosync: boolean;
    videoSource: VideoSource;
    cameraFacing: CameraFacing;
    mirroring: boolean;
    fullscreen: boolean;
  }>;
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
    navBarEnabled: boolean;
    clipboardAutosyncDefault: boolean;
    screenshotCopyToClipboard: boolean;
    onboardingDismissed: boolean;
    updateBannerDismissedVersion: string | null;
    adbPath: string;
    scrcpyPath: string;
  }>;
  setSettings: (partial: {
    quality?: QualityPreset;
    alwaysOnTop?: boolean;
    keepScreenOn?: boolean;
    navBarEnabled?: boolean;
    clipboardAutosyncDefault?: boolean;
    screenshotCopyToClipboard?: boolean;
    onboardingDismissed?: boolean;
    updateBannerDismissedVersion?: string | null;
  }) => Promise<{
    quality: QualityPreset;
    alwaysOnTop: boolean;
    keepScreenOn: boolean;
    navBarEnabled: boolean;
    clipboardAutosyncDefault: boolean;
    screenshotCopyToClipboard: boolean;
    onboardingDismissed: boolean;
    updateBannerDismissedVersion: string | null;
  }>;
  enableWireless: (serial: string) => Promise<{
    ip: string | null;
    port: number;
    hint: string | null;
  }>;
  connectWireless: (hostPort: string) => Promise<{ result: string }>;
  pairWireless: (hostPort: string, code: string) => Promise<{ result: string }>;
  disconnectWireless: (hostPort?: string) => Promise<{ ok: boolean }>;
  takeScreenshot: (serial: string) => Promise<{
    ok: boolean;
    path?: string;
    dataUrl?: string;
    copiedToClipboard?: boolean;
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
    results: Array<{
      localPath: string;
      action: "install" | "push";
      detail: string;
      error?: string;
    }>;
  }>;
  downloadFs: (
    serial: string,
    remotePaths: string[]
  ) => Promise<{
    ok: boolean;
    canceled?: boolean;
    destDir?: string;
    results: Array<{ remotePath: string; localPath: string; error?: string }>;
  }>;
  cancelTransfer: () => Promise<{ ok: boolean; canceled: boolean }>;
  previewFs: (serial: string, remotePath: string) => Promise<{
    ok: boolean;
    kind: "image" | "text" | "unsupported";
    name: string;
    remotePath: string;
    tempPath: string;
    size: number;
    dataUrl?: string;
    text?: string;
  }>;
  discardPreview: (tempPath: string) => Promise<{ ok: boolean }>;
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
  pickUploadFolder: () => Promise<string[]>;
  pickFiles: () => Promise<string[]>;
  openPath: (target: string) => Promise<void>;
  checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
  installUpdate: () => Promise<{ ok: boolean; reason?: string }>;
  getPathForFile: (file: File) => string;
  onDevicesUpdated: (cb: (devices: DeviceInfo[]) => void) => () => void;
  onAdbError: (cb: (message: string) => void) => () => void;
  onMirrorError: (
    cb: (payload: { serial: string; error: string }) => void
  ) => () => void;
  onMirrorExit: (cb: (payload: { serial: string }) => void) => () => void;
  onClipboardHint: (cb: (payload: { serial: string }) => void) => () => void;
  onFsProgress: (
    cb: (payload: {
      phase: string;
      message: string | null;
      percent?: number | null;
      done?: boolean;
      canceled?: boolean;
    }) => void
  ) => () => void;
  onUpdateAvailable: (cb: (payload: { version: string }) => void) => () => void;
  onUpdateProgress: (cb: (payload: { percent: number }) => void) => () => void;
  onUpdateReady: (cb: (payload: { version: string }) => void) => () => void;
  onUpdateError: (cb: (message: string) => void) => () => void;
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
    mirrox: MirroxApi;
  }
}
