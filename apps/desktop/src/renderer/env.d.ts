export {};

type DeviceState = "device" | "unauthorized" | "offline" | "unknown";
type QualityPreset = "low" | "medium" | "high";
type VideoSource = "display" | "camera";
type CameraFacing = "front" | "back";
type OrientationDegrees = 0 | 90 | 180 | 270;

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
  orientation?: OrientationDegrees;
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
  displayWidth?: number;
  displayHeight?: number;
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
  setOrientation: (
    serial: string,
    orientation: OrientationDegrees
  ) => Promise<{ ok: boolean; orientation?: OrientationDegrees }>;
  listCameras: (serial: string) => Promise<{
    cameras: Array<{ id: string; label: string }>;
    raw: string;
  }>;
  getDeviceInfo: (serial: string) => Promise<DeviceDetails>;
  getDeviceFramePreview: (serial: string) => Promise<{
    ok: boolean;
    dataUrl: string;
    width: number;
    height: number;
  }>;
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
    orientation: OrientationDegrees;
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
    mediaFrameApplyDefault: boolean;
    mediaFrameId: string | null;
    mediaFrameFitMode: "media-to-frame" | "frame-to-media";
    mediaFramePath: string | null;
    mediaFrameDataUrl: string | null;
    onboardingDismissed: boolean;
    updateBannerDismissedVersion: string | null;
    appVersion: string;
    adbPath: string;
    scrcpyPath: string;
    ffmpegPath?: string;
  }>;
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
  }) => Promise<{
    quality: QualityPreset;
    alwaysOnTop: boolean;
    keepScreenOn: boolean;
    navBarEnabled: boolean;
    clipboardAutosyncDefault: boolean;
    screenshotCopyToClipboard: boolean;
    mediaFrameApplyDefault: boolean;
    mediaFrameId: string | null;
    mediaFrameFitMode: "media-to-frame" | "frame-to-media";
    mediaFramePath: string | null;
    mediaFrameDataUrl: string | null;
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
    serial: string,
    applyFrame?: boolean
  ) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  copyScreenshot: (tempPath: string, applyFrame?: boolean) => Promise<{ ok: boolean }>;
  discardScreenshot: (tempPath: string) => Promise<{ ok: boolean }>;
  getMediaFrame: () => Promise<{
    id: string | null;
    path: string | null;
    dataUrl: string | null;
    width: number | null;
    height: number | null;
    name: string | null;
    applyDefault: boolean;
    fitMode: "media-to-frame" | "frame-to-media";
    builtins: Array<{
      id: string;
      name: string;
      dataUrl: string;
      width: number;
      height: number;
    }>;
  }>;
  pickMediaFrame: () => Promise<{
    ok: boolean;
    canceled?: boolean;
    id?: string;
    path?: string;
    dataUrl?: string;
    width?: number;
    height?: number;
    name?: string;
    rect?: { x: number; y: number; w: number; h: number };
  }>;
  selectMediaFrame: (id: string) => Promise<{
    ok: boolean;
    id: string;
    path: string;
    dataUrl: string;
    width: number;
    height: number;
    name: string;
  }>;
  clearMediaFrame: () => Promise<{ ok: boolean }>;
  startRecording: (serial: string) => Promise<{ ok: boolean; already?: boolean }>;
  stopRecording: (serial: string) => Promise<{
    ok: boolean;
    saved?: boolean;
    path?: string;
    tempPath?: string;
    serial?: string;
    canceled?: boolean;
    discarded?: boolean;
  }>;
  saveRecording: (
    tempPath: string,
    serial: string,
    applyFrame?: boolean
  ) => Promise<{ ok: boolean; saved?: boolean; path?: string; canceled?: boolean }>;
  discardRecording: (tempPath: string) => Promise<{ ok: boolean }>;
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
  openExternal: (url: string) => Promise<{ ok: boolean; reason?: string }>;
  getGithubStats: () => Promise<{
    ok: boolean;
    reason?: string;
    stars: number;
    forks: number;
    url: string;
    fullName: string;
  }>;
  checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
  installUpdate: () => Promise<{ ok: boolean; reason?: string }>;
  getPathForFile: (file: File) => string;
  onAboutOpen: (cb: () => void) => () => void;
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
