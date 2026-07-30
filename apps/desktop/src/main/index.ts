import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  clipboard,
  nativeImage,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { AdbClient, shellQuote, type AdbDevice } from "@mirrox/adb";
import {
  MirrorManager,
  type QualityPreset,
  type VideoSource,
  type CameraFacing,
  type OrientationDegrees,
} from "@mirrox/mirror";
import {
  MirrorShortcutManager,
  MIRROR_SHORTCUTS,
  type MirrorShortcutAction,
} from "./mirrorShortcuts";
import { loadSettings, saveSettings } from "./settings";
import {
  clearStoredMediaFrame,
  compositeWithActiveFrame,
  installMediaFrame,
  listBuiltinFrames,
  loadActiveMediaFrame,
} from "./mediaFrame";

function resolveVendorBin(name: string): string {
  const packaged = path.join(process.resourcesPath, "bin", name);
  const homebrew = `/opt/homebrew/bin/${name}`;
  const usrLocal = `/usr/local/bin/${name}`;
  const devCandidates = [
    path.join(app.getAppPath(), "..", "..", "vendor", "bin", name),
    path.join(process.cwd(), "vendor", "bin", name),
    path.join(__dirname, "..", "..", "..", "..", "vendor", "bin", name),
  ];

  // Prefer packaged / vendored binaries so the app is self-contained.
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;

  for (const candidate of devCandidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }

  if (name === "adb") {
    const sdk = path.join(
      process.env.HOME ?? "",
      "Library/Android/sdk/platform-tools/adb"
    );
    if (fs.existsSync(sdk)) return sdk;
  }

  if (fs.existsSync(homebrew)) return homebrew;
  if (fs.existsSync(usrLocal)) return usrLocal;
  return name;
}

function resolveScrcpyServer(scrcpyPath: string): string | undefined {
  const beside = path.join(path.dirname(scrcpyPath), "scrcpy-server");
  if (fs.existsSync(beside)) return beside;
  const packaged = path.join(process.resourcesPath, "bin", "scrcpy-server");
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return undefined;
}

function resolveAppIconPath(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath, "icon.png"),
    path.join(app.getAppPath(), "resources", "icon.png"),
    path.join(__dirname, "../../resources/icon.png"),
    path.join(__dirname, "../../build/icon.png"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function resolveAppIcnsPath(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath, "icon.icns"),
    path.join(app.getAppPath(), "build", "icon.icns"),
    path.join(__dirname, "../../build/icon.icns"),
    path.join(__dirname, "../../resources/icon.icns"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function resolveScrcpyIconDir(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath, "scrcpy-icons"),
    path.join(app.getAppPath(), "resources", "scrcpy-icons"),
    path.join(__dirname, "../../resources/scrcpy-icons"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, "scrcpy.png"))) return candidate;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Prefer package.json so About / sidebar never show Electron's runtime version in dev. */
function resolveMirroxVersion(): string {
  const candidates = [
    path.join(app.getAppPath(), "package.json"),
    path.join(__dirname, "../../package.json"),
    path.join(process.cwd(), "apps/desktop/package.json"),
    path.join(process.cwd(), "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const version = JSON.parse(fs.readFileSync(candidate, "utf8")).version;
      if (typeof version === "string" && version.length > 0) return version;
    } catch {
      /* ignore */
    }
  }
  return app.getVersion();
}

let mainWindow: BrowserWindow | null = null;
let adb: AdbClient;
let mirrors: MirrorManager;
let mirrorShortcuts: MirrorShortcutManager | null = null;
let shortcutTarget: string | null = null;
let quality: QualityPreset = "medium";
let alwaysOnTop = false;
let keepScreenOn = true;
let navBarEnabled = false;
let clipboardAutosyncDefault = true;
let screenshotCopyToClipboard = false;
let mediaFrameApplyDefault = false;
let mediaFrameId: string | null = null;
let mediaFrameFitMode: "media-to-frame" | "frame-to-media" = "media-to-frame";
let onboardingDismissed = false;
let updateBannerDismissedVersion: string | null = null;

const GITHUB_OWNER = "moezbenselem";
const GITHUB_REPO = "Mirrox";
const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;

let githubStatsCache: {
  fetchedAt: number;
  data: { stars: number; forks: number; url: string; fullName: string };
} | null = null;

const audioBySerial = new Map<string, boolean>();
const clipboardBySerial = new Map<string, boolean>();
const clipboardToastShown = new Set<string>();
const videoSourceBySerial = new Map<string, VideoSource>();
const cameraFacingBySerial = new Map<string, CameraFacing>();
const cameraIdBySerial = new Map<string, string>();
const orientationBySerial = new Map<string, OrientationDegrees>();
const fullscreenBySerial = new Map<string, boolean>();
const restartingSerials = new Set<string>();
const recordings = new Map<
  string,
  { child: ChildProcess; remotePath: string; startedAt: number }
>();
let activeTransfer: ChildProcess | null = null;

function markRestarting(serial: string, ms = 3000): void {
  restartingSerials.add(serial);
  setTimeout(() => restartingSerials.delete(serial), ms);
}

function preloadPath(): string {
  return path.join(__dirname, "../preload/index.js");
}

function loadRenderer(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function createWindow(): void {
  const iconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 720,
    minHeight: 480,
    title: "Mirrox",
    backgroundColor: "#0f1115",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  loadRenderer(mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function resolveShortcutTarget(): string | null {
  if (shortcutTarget && mirrors.isRunning(shortcutTarget)) return shortcutTarget;
  const running = mirrors.list().filter((s) => mirrors.isRunning(s));
  return running[running.length - 1] ?? null;
}

function syncMirrorShortcuts(): void {
  mirrorShortcuts?.sync(mirrors.list().some((s) => mirrors.isRunning(s)));
  syncEscapeExitFullscreen();
}

function syncEscapeExitFullscreen(): void {
  const anyFullscreen = [...fullscreenBySerial.entries()].some(
    ([serial, on]) => on && mirrors.isRunning(serial)
  );
  mirrorShortcuts?.syncEscapeExit(anyFullscreen);
}

async function setMirrorFullscreen(
  serial: string,
  fullscreen: boolean
): Promise<{ ok: boolean; fullscreen: boolean }> {
  if (!mirrors.isRunning(serial)) {
    return { ok: false, fullscreen: false };
  }
  fullscreenBySerial.set(serial, fullscreen);
  markRestarting(serial);
  await mirrors.restart(serial, {
    ...(await mirrorRestartPatch(serial)),
    fullscreen,
  });
  syncEscapeExitFullscreen();
  await refreshDevices();
  return { ok: true, fullscreen };
}

async function exitFullscreenViaEscape(): Promise<void> {
  const target =
    (shortcutTarget && fullscreenBySerial.get(shortcutTarget)
      ? shortcutTarget
      : null) ??
    [...fullscreenBySerial.entries()].find(
      ([serial, on]) => on && mirrors.isRunning(serial)
    )?.[0] ??
    null;
  if (!target) return;
  await setMirrorFullscreen(target, false);
}

async function takeScreenshotInternal(serial: string): Promise<{
  path: string;
  dataUrl: string;
  copiedToClipboard: boolean;
}> {
  const tempPath = path.join(
    app.getPath("temp"),
    `mirrox-shot-${serial.replace(/[^\w.-]+/g, "_")}-${Date.now()}.png`
  );
  await adb.screencap(serial, tempPath);
  let copiedToClipboard = false;
  if (screenshotCopyToClipboard) {
    const image = nativeImage.createFromPath(tempPath);
    if (!image.isEmpty()) {
      clipboard.writeImage(image);
      copiedToClipboard = true;
    }
  }
  const buf = fs.readFileSync(tempPath);
  return {
    path: tempPath,
    dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
    copiedToClipboard,
  };
}

async function startRecordingInternal(serial: string): Promise<{ already: boolean }> {
  if (recordings.has(serial)) return { already: true };
  const remotePath = `/sdcard/Download/mirrox-rec-${Date.now()}.mp4`;
  const child = adb.startScreenrecord(serial, remotePath);
  recordings.set(serial, { child, remotePath, startedAt: Date.now() });
  child.once("exit", () => {
    const current = recordings.get(serial);
    if (current?.child === child) recordings.delete(serial);
  });
  return { already: false };
}

async function handleMirrorShortcutAction(
  action: MirrorShortcutAction,
  serial: string
): Promise<void> {
  try {
    if (action === "screenshot") {
      const shot = await takeScreenshotInternal(serial);
      send("mirror:shortcut", { action, serial, payload: shot });
      return;
    }

    if (action === "toggleRecord") {
      if (recordings.has(serial)) {
        const result = await stopRecordingInternal(serial);
        send("mirror:shortcut", { action, serial, payload: result });
      } else {
        await startRecordingInternal(serial);
        send("mirror:shortcut", { action, serial, payload: { started: true } });
      }
      await refreshDevices();
    }
  } catch (err) {
    send("mirror:shortcut", { action, serial, error: String(err) });
  }
}

async function refreshDevices(): Promise<AdbDevice[]> {
  const devices = await adb.listDevices();
  const enriched = await Promise.all(devices.map((d) => adb.enrichDevice(d)));
  const withSessions = enriched.map((d) => ({
    ...d,
    mirroring: mirrors.isRunning(d.serial),
    fullscreen: fullscreenBySerial.get(d.serial) ?? false,
    audio: audioBySerial.get(d.serial) ?? true,
    clipboardAutosync: clipboardBySerial.get(d.serial) ?? clipboardAutosyncDefault,
    videoSource: videoSourceBySerial.get(d.serial) ?? "display",
    cameraFacing: cameraFacingBySerial.get(d.serial) ?? "back",
    orientation: orientationBySerial.get(d.serial) ?? 0,
    recording: recordings.has(d.serial),
    connection: connectionMethodLabel(d.serial),
  }));
  send("devices:updated", withSessions);
  return withSessions;
}

function isWirelessSerial(serial: string): boolean {
  // TCP/IP ADB: "192.168.1.10:5555" or mDNS / TLS connect ids
  return /:\d+$/.test(serial) || /adb-tls-connect|_adb-tls-pairing/i.test(serial);
}

function connectionMethodLabel(serial: string): "Cable" | "Wireless" {
  return isWirelessSerial(serial) ? "Wireless" : "Cable";
}

async function resolveDeviceDisplayName(serial: string): Promise<string> {
  try {
    const devices = await adb.listDevices();
    const found = devices.find((d) => d.serial === serial);
    if (found) {
      const enriched = await adb.enrichDevice(found);
      const name = enriched.model || enriched.product || enriched.device;
      if (name) return name;
    }
  } catch {
    /* fall through */
  }
  return serial;
}

async function mirrorWindowTitle(serial: string): Promise<string> {
  const name = await resolveDeviceDisplayName(serial);
  const source = videoSourceBySerial.get(serial) ?? "display";
  if (source === "camera") {
    return `${name} — Camera`;
  }
  return `${name} — ${connectionMethodLabel(serial)}`;
}

async function startMirror(serial: string, fullscreen = false): Promise<void> {
  if (mirrors.isRunning(serial)) return;
  const audio = audioBySerial.get(serial) ?? true;
  const clipboardAutosync = clipboardBySerial.get(serial) ?? clipboardAutosyncDefault;
  const videoSource = videoSourceBySerial.get(serial) ?? "display";
  const cameraFacing = cameraFacingBySerial.get(serial) ?? "back";
  const cameraId = cameraIdBySerial.get(serial);
  const orientation = orientationBySerial.get(serial) ?? 0;
  const scrcpyPath = resolveVendorBin("scrcpy");
  fullscreenBySerial.set(serial, fullscreen);
  if (keepScreenOn) {
    void adb.setStayAwake(serial, true).catch(() => undefined);
  }
  mirrors.start({
    serial,
    quality,
    alwaysOnTop,
    stayAwake: keepScreenOn,
    audio,
    clipboardAutosync,
    videoSource,
    cameraFacing: videoSource === "camera" ? cameraFacing : undefined,
    cameraId: videoSource === "camera" ? cameraId : undefined,
    orientation: videoSource === "camera" ? orientation : undefined,
    fullscreen,
    adbPath: adb.adbPath,
    scrcpyPath,
    scrcpyServerPath: resolveScrcpyServer(scrcpyPath),
    iconDir: resolveScrcpyIconDir(),
    iconIcnsPath: resolveAppIcnsPath(),
    windowTitle: await mirrorWindowTitle(serial),
  });
  shortcutTarget = serial;
  syncMirrorShortcuts();

  if (clipboardAutosync && !clipboardToastShown.has(serial)) {
    clipboardToastShown.add(serial);
    send("mirror:clipboard-hint", { serial });
  }
}

async function mirrorRestartPatch(serial: string) {
  const scrcpyPath = resolveVendorBin("scrcpy");
  const videoSource = videoSourceBySerial.get(serial) ?? "display";
  return {
    serial,
    quality,
    alwaysOnTop,
    stayAwake: keepScreenOn,
    audio: audioBySerial.get(serial) ?? true,
    clipboardAutosync: clipboardBySerial.get(serial) ?? clipboardAutosyncDefault,
    videoSource,
    cameraFacing:
      videoSource === "camera"
        ? (cameraFacingBySerial.get(serial) ?? "back")
        : undefined,
    cameraId: videoSource === "camera" ? cameraIdBySerial.get(serial) : undefined,
    orientation:
      videoSource === "camera" ? (orientationBySerial.get(serial) ?? 0) : undefined,
    fullscreen: fullscreenBySerial.get(serial) ?? false,
    adbPath: adb.adbPath,
    scrcpyPath,
    scrcpyServerPath: resolveScrcpyServer(scrcpyPath),
    iconDir: resolveScrcpyIconDir(),
    iconIcnsPath: resolveAppIcnsPath(),
    windowTitle: await mirrorWindowTitle(serial),
  };
}

function restartRunningMirrors(): void {
  for (const serial of mirrors.list()) {
    if (!mirrors.isRunning(serial)) continue;
    markRestarting(serial);
    void (async () => {
      await mirrors.restart(serial, await mirrorRestartPatch(serial));
    })();
  }
}

async function stopRecordingInternal(
  serial: string,
  opts?: { discard?: boolean }
): Promise<{
  ok: boolean;
  saved?: boolean;
  path?: string;
  tempPath?: string;
  serial?: string;
  canceled?: boolean;
  discarded?: boolean;
}> {
  const active = recordings.get(serial);
  if (!active) return { ok: true, saved: false };

  recordings.delete(serial);
  await adb.stopScreenrecordProcess(serial, active.child);

  // Wait until remote size stops growing (finalization can lag slightly).
  let lastSize = -1;
  for (let i = 0; i < 15; i++) {
    try {
      const { stdout } = await adb.shell(
        `wc -c < ${shellQuote(active.remotePath)}`,
        serial
      );
      const size = Number.parseInt(stdout.trim(), 10);
      if (Number.isFinite(size) && size > 0 && size === lastSize) break;
      lastSize = size;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!Number.isFinite(lastSize) || lastSize < 1024) {
    throw new Error(
      "Recording file looks empty or corrupt. Record for a few seconds, then stop."
    );
  }

  const tempPath = path.join(
    app.getPath("temp"),
    `mirrox-rec-${serial.replace(/[^\w.-]+/g, "_")}-${Date.now()}.mp4`
  );

  try {
    await adb.run(["pull", active.remotePath, tempPath], serial);
    await adb.run(["shell", "rm", "-f", active.remotePath], serial).catch(() => undefined);
  } catch (err) {
    throw new Error(`Failed to pull recording: ${String(err)}`);
  }

  const localSize = fs.statSync(tempPath).size;
  if (localSize < 1024) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    throw new Error("Pulled recording is too small — device may not have finalized the MP4.");
  }

  if (opts?.discard) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    return { ok: true, saved: false, discarded: true };
  }

  return { ok: true, saved: false, tempPath, serial };
}

async function saveRecordingInternal(
  tempPath: string,
  serial: string,
  applyFrame: boolean
): Promise<{ ok: boolean; saved?: boolean; path?: string; canceled?: boolean }> {
  if (!tempPath || !fs.existsSync(tempPath)) {
    throw new Error("Recording file missing");
  }

  let sourcePath = tempPath;
  let framedPath: string | null = null;
  try {
    if (applyFrame) {
      framedPath = await compositeWithActiveFrame(
        resolveVendorBin("ffmpeg"),
        tempPath,
        "video",
        mediaFrameId,
        mediaFrameFitMode
      );
      sourcePath = framedPath;
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Save recording",
      defaultPath: path.join(app.getPath("videos"), `mirrox-${serial}-${Date.now()}.mp4`),
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });

    if (canceled || !filePath) {
      return { ok: true, saved: false, canceled: true };
    }

    fs.copyFileSync(sourcePath, filePath);
    discardTempFile(tempPath);
    return { ok: true, saved: true, path: filePath };
  } finally {
    discardTempFile(framedPath);
  }
}

function discardTempFile(tempPath: string | undefined | null): void {
  if (!tempPath || !fs.existsSync(tempPath)) return;
  try {
    fs.unlinkSync(tempPath);
  } catch {
    /* ignore */
  }
}

function registerIpc(): void {
  ipcMain.handle("devices:list", async () => refreshDevices());

  ipcMain.handle("mirror:start", async (_e, serial: string) => {
    await startMirror(serial, false);
    await refreshDevices();
    return { ok: true };
  });

  ipcMain.handle("mirror:stop", async (_e, serial: string) => {
    if (recordings.has(serial)) {
      await stopRecordingInternal(serial, { discard: true }).catch(() => undefined);
    }
    markRestarting(serial);
    await mirrors.stop(serial);
    fullscreenBySerial.delete(serial);
    if (shortcutTarget === serial) {
      shortcutTarget = resolveShortcutTarget();
    }
    syncMirrorShortcuts();
    await refreshDevices();
    return { ok: true };
  });

  ipcMain.handle("mirror:setShortcutTarget", async (_e, serial: string) => {
    shortcutTarget = serial;
    return { ok: true };
  });

  ipcMain.handle("shortcuts:list", async () => MIRROR_SHORTCUTS);

  ipcMain.handle("mirror:fullscreen", async (_e, serial: string) => {
    if (!mirrors.isRunning(serial)) {
      return { ok: false, fullscreen: false };
    }
    const next = !(fullscreenBySerial.get(serial) ?? false);
    return setMirrorFullscreen(serial, next);
  });

  ipcMain.handle("device:setAudio", async (_e, serial: string, enabled: boolean) => {
    audioBySerial.set(serial, enabled);
    if (mirrors.isRunning(serial)) {
      markRestarting(serial);
      await mirrors.restart(serial, {
        ...(await mirrorRestartPatch(serial)),
        audio: enabled,
      });
    }
    await refreshDevices();
    return { ok: true, audio: enabled };
  });

  ipcMain.handle("device:getSession", async (_e, serial: string) => ({
    serial,
    audio: audioBySerial.get(serial) ?? true,
    clipboardAutosync: clipboardBySerial.get(serial) ?? clipboardAutosyncDefault,
    videoSource: videoSourceBySerial.get(serial) ?? "display",
    cameraFacing: cameraFacingBySerial.get(serial) ?? "back",
    orientation: orientationBySerial.get(serial) ?? 0,
    mirroring: mirrors.isRunning(serial),
    fullscreen: fullscreenBySerial.get(serial) ?? false,
  }));

  ipcMain.handle("device:setClipboard", async (_e, serial: string, enabled: boolean) => {
    clipboardBySerial.set(serial, enabled);
    if (mirrors.isRunning(serial)) {
      markRestarting(serial);
      await mirrors.restart(serial, {
        ...(await mirrorRestartPatch(serial)),
        clipboardAutosync: enabled,
      });
    }
    await refreshDevices();
    return { ok: true, clipboardAutosync: enabled };
  });

  ipcMain.handle(
    "device:setVideoSource",
    async (_e, serial: string, source: VideoSource) => {
      videoSourceBySerial.set(serial, source);
      if (mirrors.isRunning(serial)) {
        markRestarting(serial);
        await mirrors.restart(serial, await mirrorRestartPatch(serial));
      }
      await refreshDevices();
      return { ok: true, videoSource: source };
    }
  );

  ipcMain.handle(
    "device:setCameraFacing",
    async (_e, serial: string, facing: CameraFacing) => {
      cameraFacingBySerial.set(serial, facing);
      if (mirrors.isRunning(serial) && (videoSourceBySerial.get(serial) ?? "display") === "camera") {
        markRestarting(serial);
        await mirrors.restart(serial, await mirrorRestartPatch(serial));
      }
      await refreshDevices();
      return { ok: true, cameraFacing: facing };
    }
  );

  ipcMain.handle("device:setCameraId", async (_e, serial: string, cameraId: string | null) => {
    if (cameraId) cameraIdBySerial.set(serial, cameraId);
    else cameraIdBySerial.delete(serial);
    if (mirrors.isRunning(serial) && (videoSourceBySerial.get(serial) ?? "display") === "camera") {
      markRestarting(serial);
      await mirrors.restart(serial, await mirrorRestartPatch(serial));
    }
    await refreshDevices();
    return { ok: true, cameraId };
  });

  ipcMain.handle(
    "device:setOrientation",
    async (_e, serial: string, orientation: OrientationDegrees) => {
      const allowed: OrientationDegrees[] = [0, 90, 180, 270];
      if (!allowed.includes(orientation)) {
        throw new Error("Orientation must be 0, 90, 180, or 270");
      }
      orientationBySerial.set(serial, orientation);
      if (mirrors.isRunning(serial) && (videoSourceBySerial.get(serial) ?? "display") === "camera") {
        markRestarting(serial);
        await mirrors.restart(serial, await mirrorRestartPatch(serial));
      }
      await refreshDevices();
      return { ok: true, orientation };
    }
  );

  ipcMain.handle("device:listCameras", async (_e, serial: string) => {
    const scrcpyPath = resolveVendorBin("scrcpy");
    const env = { ...process.env, ADB: adb.adbPath };
    const serverPath = resolveScrcpyServer(scrcpyPath);
    if (serverPath) env.SCRCPY_SERVER_PATH = serverPath;
    return await new Promise<{ cameras: Array<{ id: string; label: string }>; raw: string }>(
      (resolve, reject) => {
        const child = spawn(scrcpyPath, ["--serial", serial, "--list-cameras"], {
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        child.stdout?.on("data", (c: Buffer) => {
          out += c.toString();
        });
        child.stderr?.on("data", (c: Buffer) => {
          out += c.toString();
        });
        child.on("error", reject);
        child.on("exit", () => {
          const cameras: Array<{ id: string; label: string }> = [];
          for (const line of out.split("\n")) {
            // Typical: "--camera-id=0    (rear, ...)" or "Camera id: 0"
            const m =
              line.match(/--camera-id=(\d+)\s*(.*)/i) ||
              line.match(/camera(?:\s+id)?\s*[:=]\s*(\d+)\s*(.*)/i);
            if (m) {
              cameras.push({
                id: m[1],
                label: (m[2] || `Camera ${m[1]}`).trim() || `Camera ${m[1]}`,
              });
            }
          }
          resolve({ cameras, raw: out });
        });
      }
    );
  });

  ipcMain.handle("device:getInfo", async (_e, serial: string) => adb.getDeviceDetails(serial));

  ipcMain.handle("device:getFramePreview", async (_e, serial: string) => {
    const tempPath = path.join(
      app.getPath("temp"),
      `mirrox-frame-${serial.replace(/[^\w.-]+/g, "_")}-${Date.now()}.png`
    );
    try {
      await adb.screencap(serial, tempPath);
      let image = nativeImage.createFromPath(tempPath);
      if (image.isEmpty()) {
        return { ok: false, reason: "Empty screenshot" };
      }
      const { width, height } = image.getSize();
      const maxEdge = 480;
      if (Math.max(width, height) > maxEdge) {
        const scale = maxEdge / Math.max(width, height);
        image = image.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: "better",
        });
      }
      const size = image.getSize();
      return {
        ok: true,
        dataUrl: image.toDataURL(),
        width: size.width,
        height: size.height,
      };
    } catch (err) {
      return { ok: false, reason: String(err) };
    } finally {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
  });

  ipcMain.handle(
    "device:keyevent",
    async (_e, serial: string, code: number | string) => {
      await adb.keyevent(serial, code);
      return { ok: true };
    }
  );

  ipcMain.handle(
    "device:nav",
    async (
      _e,
      serial: string,
      action: "back" | "home" | "recents" | "notifications"
    ) => {
      if (action === "back") await adb.keyevent(serial, 4);
      else if (action === "home") await adb.keyevent(serial, 3);
      else if (action === "recents") await adb.keyevent(serial, 187);
      else if (action === "notifications") await adb.expandNotifications(serial);
      return { ok: true };
    }
  );

  ipcMain.handle("device:setScreen", async (_e, serial: string, on: boolean) => {
    await adb.setDisplayPower(serial, on);
    return { ok: true, on };
  });

  ipcMain.handle("device:getScreen", async (_e, serial: string) => {
    const on = await adb.isDisplayOn(serial);
    return { on };
  });

  ipcMain.handle("device:setDemoMode", async (_e, serial: string, enabled: boolean) => {
    await adb.setDemoMode(serial, enabled);
    return { ok: true, enabled };
  });

  ipcMain.handle("device:getDemoMode", async (_e, serial: string) => ({
    enabled: adb.isDemoMode(serial),
  }));

  ipcMain.handle("settings:get", async () => {
    const scrcpyPath = resolveVendorBin("scrcpy");
    const frame = loadActiveMediaFrame(mediaFrameId);
    return {
      quality,
      alwaysOnTop,
      keepScreenOn,
      navBarEnabled,
      clipboardAutosyncDefault,
      screenshotCopyToClipboard,
      mediaFrameApplyDefault,
      mediaFrameId,
      mediaFrameFitMode,
      mediaFramePath: frame?.path ?? null,
      mediaFrameDataUrl: frame?.dataUrl ?? null,
      onboardingDismissed,
      updateBannerDismissedVersion,
      appVersion: resolveMirroxVersion(),
      adbPath: adb.adbPath,
      scrcpyPath,
      scrcpyServerPath: resolveScrcpyServer(scrcpyPath) ?? null,
      ffmpegPath: resolveVendorBin("ffmpeg"),
    };
  });

  ipcMain.handle(
    "settings:set",
    async (
      _e,
      partial: {
        quality?: QualityPreset;
        alwaysOnTop?: boolean;
        keepScreenOn?: boolean;
        navBarEnabled?: boolean;
        clipboardAutosyncDefault?: boolean;
        screenshotCopyToClipboard?: boolean;
        mediaFrameApplyDefault?: boolean;
        mediaFrameId?: string | null;
        mediaFrameFitMode?: "media-to-frame" | "frame-to-media";
        onboardingDismissed?: boolean;
        updateBannerDismissedVersion?: string | null;
      }
    ) => {
      const qualityChanged = Boolean(partial.quality) && partial.quality !== quality;
      const alwaysOnTopChanged =
        typeof partial.alwaysOnTop === "boolean" && partial.alwaysOnTop !== alwaysOnTop;
      const keepScreenOnChanged =
        typeof partial.keepScreenOn === "boolean" && partial.keepScreenOn !== keepScreenOn;

      if (partial.quality) quality = partial.quality;
      if (typeof partial.alwaysOnTop === "boolean") alwaysOnTop = partial.alwaysOnTop;
      if (typeof partial.keepScreenOn === "boolean") keepScreenOn = partial.keepScreenOn;
      if (typeof partial.navBarEnabled === "boolean") navBarEnabled = partial.navBarEnabled;
      if (typeof partial.clipboardAutosyncDefault === "boolean") {
        clipboardAutosyncDefault = partial.clipboardAutosyncDefault;
      }
      if (typeof partial.screenshotCopyToClipboard === "boolean") {
        screenshotCopyToClipboard = partial.screenshotCopyToClipboard;
      }
      if (typeof partial.mediaFrameApplyDefault === "boolean") {
        mediaFrameApplyDefault = partial.mediaFrameApplyDefault;
      }
      if (partial.mediaFrameId !== undefined) {
        mediaFrameId = partial.mediaFrameId;
      }
      if (
        partial.mediaFrameFitMode === "media-to-frame" ||
        partial.mediaFrameFitMode === "frame-to-media"
      ) {
        mediaFrameFitMode = partial.mediaFrameFitMode;
      }
      if (typeof partial.onboardingDismissed === "boolean") {
        onboardingDismissed = partial.onboardingDismissed;
      }
      if (partial.updateBannerDismissedVersion !== undefined) {
        updateBannerDismissedVersion = partial.updateBannerDismissedVersion;
      }

      const frame = loadActiveMediaFrame(mediaFrameId);
      saveSettings({
        quality,
        alwaysOnTop,
        keepScreenOn,
        navBarEnabled,
        clipboardAutosyncDefault,
        screenshotCopyToClipboard,
        mediaFrameApplyDefault,
        mediaFrameId,
        mediaFrameFitMode,
        mediaFramePath: frame?.path ?? null,
        onboardingDismissed,
        updateBannerDismissedVersion,
      });

      mirrors.updateDefaults({ quality, alwaysOnTop, stayAwake: keepScreenOn });

      if (keepScreenOnChanged) {
        const devices = await adb.listDevices();
        for (const d of devices) {
          if (d.state !== "device") continue;
          await adb.setStayAwake(d.serial, keepScreenOn).catch(() => undefined);
        }
      }

      if (qualityChanged || alwaysOnTopChanged || keepScreenOnChanged) {
        restartRunningMirrors();
        await refreshDevices();
      }

      return {
        quality,
        alwaysOnTop,
        keepScreenOn,
        navBarEnabled,
        clipboardAutosyncDefault,
        screenshotCopyToClipboard,
        mediaFrameApplyDefault,
        mediaFrameId,
        mediaFrameFitMode,
        mediaFramePath: frame?.path ?? null,
        mediaFrameDataUrl: frame?.dataUrl ?? null,
        onboardingDismissed,
        updateBannerDismissedVersion,
      };
    }
  );

  ipcMain.handle("wireless:enable", async (_e, serial: string) => {
    const ip = await adb.getDeviceIp(serial);
    await adb.enableTcpip(serial, 5555);
    return { ip, port: 5555, hint: ip ? `${ip}:5555` : null };
  });

  ipcMain.handle("wireless:connect", async (_e, hostPort: string) => {
    const result = await adb.connect(hostPort.trim());
    await refreshDevices();
    return { result };
  });

  ipcMain.handle("wireless:pair", async (_e, hostPort: string, code: string) => {
    const result = await adb.pair(hostPort.trim(), code.trim());
    return { result };
  });

  ipcMain.handle("wireless:disconnect", async (_e, hostPort?: string) => {
    await adb.disconnect(hostPort?.trim() || undefined);
    await refreshDevices();
    return { ok: true };
  });

  ipcMain.handle("screenshot:take", async (_e, serial: string) => {
    const shot = await takeScreenshotInternal(serial);
    return { ok: true, ...shot };
  });

  ipcMain.handle(
    "screenshot:save",
    async (_e, tempPath: string, serial: string, applyFrame = false) => {
      if (!tempPath || !fs.existsSync(tempPath)) {
        throw new Error("Screenshot file missing");
      }
      let sourcePath = tempPath;
      let framedPath: string | null = null;
      try {
        if (applyFrame) {
          framedPath = await compositeWithActiveFrame(
            resolveVendorBin("ffmpeg"),
            tempPath,
            "image",
            mediaFrameId,
            mediaFrameFitMode
          );
          sourcePath = framedPath;
        }
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: "Save screenshot",
          defaultPath: path.join(app.getPath("pictures"), `mirrox-${serial}-${Date.now()}.png`),
          filters: [{ name: "PNG", extensions: ["png"] }],
        });
        if (canceled || !filePath) return { ok: false, canceled: true };
        fs.copyFileSync(sourcePath, filePath);
        return { ok: true, path: filePath };
      } finally {
        discardTempFile(framedPath);
      }
    }
  );

  ipcMain.handle("screenshot:copy", async (_e, tempPath: string, applyFrame = false) => {
    if (!tempPath || !fs.existsSync(tempPath)) {
      throw new Error("Screenshot file missing");
    }
    let sourcePath = tempPath;
    let framedPath: string | null = null;
    try {
      if (applyFrame) {
        framedPath = await compositeWithActiveFrame(
          resolveVendorBin("ffmpeg"),
          tempPath,
          "image",
          mediaFrameId,
          mediaFrameFitMode
        );
        sourcePath = framedPath;
      }
      const image = nativeImage.createFromPath(sourcePath);
      if (image.isEmpty()) throw new Error("Could not load screenshot");
      clipboard.writeImage(image);
      return { ok: true };
    } finally {
      discardTempFile(framedPath);
    }
  });

  ipcMain.handle("screenshot:discard", async (_e, tempPath: string) => {
    discardTempFile(tempPath);
    return { ok: true };
  });

  ipcMain.handle("frame:get", async () => {
    const frame = loadActiveMediaFrame(mediaFrameId);
    const builtins = listBuiltinFrames().map((f) => ({
      id: f.id,
      name: f.name,
      dataUrl: f.dataUrl,
      width: f.width,
      height: f.height,
    }));
    return {
      id: frame?.id ?? mediaFrameId,
      path: frame?.path ?? null,
      dataUrl: frame?.dataUrl ?? null,
      width: frame?.width ?? null,
      height: frame?.height ?? null,
      name: frame?.name ?? null,
      applyDefault: mediaFrameApplyDefault,
      fitMode: mediaFrameFitMode,
      builtins,
    };
  });

  ipcMain.handle("frame:pick", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Choose frame image",
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
      ],
    });
    if (canceled || !filePaths[0]) return { ok: false, canceled: true };
    const installed = installMediaFrame(filePaths[0]);
    mediaFrameId = "custom";
    saveSettings({
      mediaFrameId,
      mediaFramePath: installed.path,
      mediaFrameApplyDefault,
    });
    return {
      ok: true,
      id: installed.id,
      path: installed.path,
      dataUrl: installed.dataUrl,
      width: installed.width,
      height: installed.height,
      name: installed.name,
      rect: installed.rect,
    };
  });

  ipcMain.handle("frame:select", async (_e, id: string) => {
    const frame = loadActiveMediaFrame(id);
    if (!frame) throw new Error("Frame not found");
    mediaFrameId = frame.id;
    saveSettings({
      mediaFrameId,
      mediaFramePath: frame.path,
      mediaFrameApplyDefault,
    });
    return {
      ok: true,
      id: frame.id,
      path: frame.path,
      dataUrl: frame.dataUrl,
      width: frame.width,
      height: frame.height,
      name: frame.name,
    };
  });

  ipcMain.handle("frame:clear", async () => {
    clearStoredMediaFrame();
    mediaFrameId = null;
    saveSettings({ mediaFramePath: null, mediaFrameId: null });
    return { ok: true };
  });

  ipcMain.handle("record:start", async (_e, serial: string) => {
    const { already } = await startRecordingInternal(serial);
    await refreshDevices();
    return { ok: true, already };
  });

  ipcMain.handle("record:stop", async (_e, serial: string) => {
    const result = await stopRecordingInternal(serial);
    await refreshDevices();
    return result;
  });

  ipcMain.handle(
    "record:save",
    async (_e, tempPath: string, serial: string, applyFrame = false) => {
      const result = await saveRecordingInternal(tempPath, serial, Boolean(applyFrame));
      return result;
    }
  );

  ipcMain.handle("record:discard", async (_e, tempPath: string) => {
    discardTempFile(tempPath);
    return { ok: true };
  });

  ipcMain.handle("record:isRecording", async (_e, serial: string) => recordings.has(serial));

  ipcMain.handle("files:drop", async (_e, serial: string, filePaths: string[]) => {
    const results = [];
    for (const filePath of filePaths) {
      const result = await adb.pushOrInstall(serial, filePath);
      results.push({ filePath, ...result });
    }
    return { results };
  });

  ipcMain.handle("fs:list", async (_e, serial: string, remotePath: string) => {
    const entries = await adb.listDir(serial, remotePath);
    return { path: remotePath, entries };
  });

  ipcMain.handle(
    "fs:upload",
    async (_e, serial: string, remoteDir: string, localPaths: string[]) => {
      const results: Array<{
        localPath: string;
        action: "install" | "push";
        detail: string;
        error?: string;
      }> = [];
      for (const localPath of localPaths) {
        const base = path.basename(localPath);
        const remotePath = `${remoteDir.replace(/\/+$/, "")}/${base}`;
        const ext = path.extname(localPath).toLowerCase();
        try {
          if (ext === ".apk" && fs.statSync(localPath).isFile()) {
            send("fs:progress", {
              phase: "push",
              message: `Installing ${base}…`,
              percent: undefined,
            });
            const detail = await adb.install(serial, localPath);
            results.push({ localPath, action: "install", detail });
          } else {
            send("fs:progress", {
              phase: "push",
              message: `Uploading ${base}…`,
              percent: 0,
            });
            const { promise, child } = adb.pushWithProgress(
              serial,
              localPath,
              remotePath,
              (p) =>
                send("fs:progress", {
                  phase: "push",
                  message: `Uploading ${p.message ?? base}…`,
                  percent: p.percent,
                })
            );
            activeTransfer = child;
            await promise;
            activeTransfer = null;
            results.push({ localPath, action: "push", detail: remotePath });
          }
        } catch (err) {
          activeTransfer = null;
          results.push({
            localPath,
            action: ext === ".apk" ? "install" : "push",
            detail: "",
            error: String(err),
          });
        }
      }
      send("fs:progress", { phase: "push", message: null, percent: null, done: true });
      return { results };
    }
  );

  ipcMain.handle(
    "fs:download",
    async (_e, serial: string, remotePaths: string[]) => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: "Choose download folder",
        properties: ["openDirectory", "createDirectory"],
        defaultPath: app.getPath("downloads"),
      });
      if (canceled || !filePaths[0]) return { ok: false, canceled: true, results: [] };

      const destDir = filePaths[0];
      const results: Array<{
        remotePath: string;
        localPath: string;
        error?: string;
      }> = [];
      for (const remotePath of remotePaths) {
        const base = path.basename(remotePath);
        const localPath = path.join(destDir, base);
        try {
          send("fs:progress", {
            phase: "pull",
            message: `Downloading ${base}…`,
            percent: 0,
          });
          const { promise, child } = adb.pullWithProgress(
            serial,
            remotePath,
            localPath,
            (p) =>
              send("fs:progress", {
                phase: "pull",
                message: `Downloading ${p.message ?? base}…`,
                percent: p.percent,
              })
          );
          activeTransfer = child;
          await promise;
          activeTransfer = null;
          results.push({ remotePath, localPath });
        } catch (err) {
          activeTransfer = null;
          results.push({ remotePath, localPath, error: String(err) });
        }
      }
      send("fs:progress", { phase: "pull", message: null, percent: null, done: true });
      return { ok: true, destDir, results };
    }
  );

  ipcMain.handle("fs:cancelTransfer", async () => {
    if (activeTransfer && !activeTransfer.killed) {
      try {
        activeTransfer.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      activeTransfer = null;
      send("fs:progress", { phase: "push", message: null, percent: null, done: true, canceled: true });
      return { ok: true, canceled: true };
    }
    return { ok: true, canceled: false };
  });

  ipcMain.handle("fs:preview", async (_e, serial: string, remotePath: string) => {
    const name = path.basename(remotePath);
    const ext = path.extname(name).toLowerCase();
    const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
    const textExts = new Set([
      ".txt",
      ".log",
      ".json",
      ".xml",
      ".md",
      ".csv",
      ".html",
      ".htm",
      ".css",
      ".js",
      ".ts",
      ".jsx",
      ".tsx",
      ".yml",
      ".yaml",
      ".ini",
      ".conf",
      ".prop",
      ".properties",
      ".sh",
      ".bat",
      ".kt",
      ".java",
      ".gradle",
      ".gitignore",
    ]);

    let kind: "image" | "text" | "unsupported" = "unsupported";
    if (imageExts.has(ext)) kind = "image";
    else if (textExts.has(ext)) kind = "text";

    const maxImage = 40 * 1024 * 1024;
    const maxText = 1.5 * 1024 * 1024;

    let size = 0;
    try {
      const { stdout } = await adb.shell(`wc -c < ${shellQuote(remotePath)}`, serial);
      size = Number.parseInt(stdout.trim(), 10) || 0;
    } catch {
      size = 0;
    }

    if (kind === "image" && size > maxImage) {
      throw new Error("Image is too large to preview (over 40 MB). Download it instead.");
    }
    if (kind === "text" && size > maxText) {
      throw new Error("File is too large to preview as text. Download it instead.");
    }

    const tempPath = path.join(
      app.getPath("temp"),
      `mirrox-preview-${Date.now()}-${name.replace(/[^\w.-]+/g, "_")}`
    );
    await adb.pull(serial, remotePath, tempPath);

    if (kind === "unsupported" && size > 0 && size <= maxText) {
      const sample = fs.readFileSync(tempPath).subarray(0, Math.min(512, size));
      const printable = [...sample].filter(
        (b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)
      ).length;
      if (sample.length && printable / sample.length > 0.85) kind = "text";
    }

    if (kind === "image") {
      const buf = fs.readFileSync(tempPath);
      const mime =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".webp"
              ? "image/webp"
              : ext === ".svg"
                ? "image/svg+xml"
                : ext === ".bmp"
                  ? "image/bmp"
                  : "image/png";
      return {
        ok: true,
        kind: "image" as const,
        name,
        remotePath,
        tempPath,
        size,
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      };
    }

    if (kind === "text") {
      const text = fs.readFileSync(tempPath, "utf8");
      return {
        ok: true,
        kind: "text" as const,
        name,
        remotePath,
        tempPath,
        size,
        text,
      };
    }

    return {
      ok: true,
      kind: "unsupported" as const,
      name,
      remotePath,
      tempPath,
      size,
    };
  });

  ipcMain.handle("fs:discardPreview", async (_e, tempPath: string) => {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  });

  ipcMain.handle("fs:mkdir", async (_e, serial: string, remotePath: string) => {
    await adb.mkdir(serial, remotePath);
    return { ok: true };
  });

  ipcMain.handle(
    "fs:delete",
    async (
      _e,
      serial: string,
      items: Array<{ path: string; isDirectory: boolean }>
    ) => {
      for (const item of items) {
        await adb.remove(serial, item.path, item.isDirectory);
      }
      return { ok: true, count: items.length };
    }
  );

  ipcMain.handle(
    "fs:rename",
    async (_e, serial: string, fromPath: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed.includes("/") || trimmed.includes("\0")) {
        throw new Error("Invalid name");
      }
      const dir = fromPath.includes("/")
        ? fromPath.slice(0, fromPath.lastIndexOf("/")) || "/"
        : "/";
      const toPath = dir === "/" ? `/${trimmed}` : `${dir}/${trimmed}`;
      if (toPath === fromPath) return { ok: true, path: toPath };
      if (await adb.exists(serial, toPath)) {
        throw new Error("A file or folder with that name already exists");
      }
      await adb.rename(serial, fromPath, toPath);
      return { ok: true, path: toPath };
    }
  );

  ipcMain.handle(
    "fs:duplicate",
    async (_e, serial: string, item: { path: string; isDirectory: boolean }) => {
      const toPath = await adb.uniqueCopyPath(serial, item.path);
      await adb.copy(serial, item.path, toPath, item.isDirectory);
      return { ok: true, path: toPath };
    }
  );

  ipcMain.handle("fs:pickUpload", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Upload files to device",
      properties: ["openFile", "multiSelections"],
    });
    if (canceled) return [];
    return filePaths;
  });

  ipcMain.handle("fs:pickUploadFolder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Upload folder to device",
      properties: ["openDirectory"],
    });
    if (canceled) return [];
    return filePaths;
  });

  ipcMain.handle("shell:openPath", async (_e, target: string) => {
    await shell.openPath(target);
  });

  ipcMain.handle("shell:openExternal", async (_e, url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return { ok: false, reason: "Invalid URL" };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("github:stats", async () => {
    const now = Date.now();
    if (githubStatsCache && now - githubStatsCache.fetchedAt < 10 * 60 * 1000) {
      return { ok: true, ...githubStatsCache.data };
    }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Mirrox",
          },
        }
      );
      if (!res.ok) {
        return {
          ok: false,
          reason: `GitHub ${res.status}`,
          url: GITHUB_REPO_URL,
          fullName: `${GITHUB_OWNER}/${GITHUB_REPO}`,
          stars: githubStatsCache?.data.stars ?? 0,
          forks: githubStatsCache?.data.forks ?? 0,
        };
      }
      const json = (await res.json()) as {
        stargazers_count?: number;
        forks_count?: number;
        html_url?: string;
        full_name?: string;
      };
      const data = {
        stars: json.stargazers_count ?? 0,
        forks: json.forks_count ?? 0,
        url: json.html_url ?? GITHUB_REPO_URL,
        fullName: json.full_name ?? `${GITHUB_OWNER}/${GITHUB_REPO}`,
      };
      githubStatsCache = { fetchedAt: now, data };
      return { ok: true, ...data };
    } catch (err) {
      return {
        ok: false,
        reason: String(err),
        url: GITHUB_REPO_URL,
        fullName: `${GITHUB_OWNER}/${GITHUB_REPO}`,
        stars: githubStatsCache?.data.stars ?? 0,
        forks: githubStatsCache?.data.forks ?? 0,
      };
    }
  });

  ipcMain.handle("app:pickFiles", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
    });
    if (canceled) return [];
    return filePaths;
  });

  ipcMain.handle("updates:check", async () => {
    try {
      const { autoUpdater } = await import("electron-updater");
      if (!app.isPackaged) {
        return { ok: false, reason: "Updates only in packaged builds" };
      }
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, updateInfo: result?.updateInfo ?? null };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  });

  ipcMain.handle("updates:install", async () => {
    try {
      const { autoUpdater } = await import("electron-updater");
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  });
}

app.setName("Mirrox");

app.whenReady().then(() => {
  const mirroxVersion = resolveMirroxVersion();
  app.setAboutPanelOptions({
    applicationName: "Mirrox",
    applicationVersion: mirroxVersion,
    version: mirroxVersion,
    copyright: "Copyright © Mirrox",
  });

  const persisted = loadSettings();
  if (persisted.quality) quality = persisted.quality;
  if (typeof persisted.alwaysOnTop === "boolean") alwaysOnTop = persisted.alwaysOnTop;
  if (typeof persisted.keepScreenOn === "boolean") keepScreenOn = persisted.keepScreenOn;
  if (typeof persisted.navBarEnabled === "boolean") navBarEnabled = persisted.navBarEnabled;
  if (typeof persisted.clipboardAutosyncDefault === "boolean") {
    clipboardAutosyncDefault = persisted.clipboardAutosyncDefault;
  }
  if (typeof persisted.screenshotCopyToClipboard === "boolean") {
    screenshotCopyToClipboard = persisted.screenshotCopyToClipboard;
  }
  if (typeof persisted.mediaFrameApplyDefault === "boolean") {
    mediaFrameApplyDefault = persisted.mediaFrameApplyDefault;
  }
  if (
    persisted.mediaFrameFitMode === "media-to-frame" ||
    persisted.mediaFrameFitMode === "frame-to-media"
  ) {
    mediaFrameFitMode = persisted.mediaFrameFitMode;
  }
  if (typeof persisted.mediaFrameId === "string" || persisted.mediaFrameId === null) {
    mediaFrameId = persisted.mediaFrameId ?? null;
  } else if (persisted.mediaFramePath) {
    mediaFrameId = "custom";
  }
  if (typeof persisted.onboardingDismissed === "boolean") {
    onboardingDismissed = persisted.onboardingDismissed;
  }
  if (persisted.updateBannerDismissedVersion !== undefined) {
    updateBannerDismissedVersion = persisted.updateBannerDismissedVersion;
  }

  const adbPath = resolveVendorBin("adb");
  adb = new AdbClient({ adbPath, pollIntervalMs: 1500 });
  mirrors = new MirrorManager({
    adbPath,
    scrcpyPath: resolveVendorBin("scrcpy"),
    quality,
    stayAwake: keepScreenOn,
  });

  mirrorShortcuts = new MirrorShortcutManager({
    getTargetSerial: resolveShortcutTarget,
    onAction: (action, serial) => handleMirrorShortcutAction(action, serial),
    onExitFullscreen: () => exitFullscreenViaEscape(),
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          {
            label: `About ${app.name}`,
            click: () => send("about:open", null),
          },
          { type: "separator" },
          {
            label: "Check for Updates…",
            click: () => {
              void (async () => {
                try {
                  if (!app.isPackaged) {
                    send("updates:error", "Updates only available in packaged builds");
                    return;
                  }
                  const { autoUpdater } = await import("electron-updater");
                  await autoUpdater.checkForUpdates();
                } catch (err) {
                  send("updates:error", String(err));
                }
              })();
            },
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          ...(!app.isPackaged ? [{ role: "toggleDevTools" as const }] : []),
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
    ])
  );

  registerIpc();
  createWindow();

  if (app.isPackaged) {
    void (async () => {
      try {
        const { autoUpdater } = await import("electron-updater");
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.on("update-available", (info) => {
          send("updates:available", {
            version: info.version,
            releaseNotes: info.releaseNotes ?? null,
          });
        });
        autoUpdater.on("download-progress", (progress) => {
          send("updates:progress", { percent: progress.percent });
        });
        autoUpdater.on("update-downloaded", (info) => {
          send("updates:ready", { version: info.version });
        });
        autoUpdater.on("error", (err) => {
          send("updates:error", String(err));
        });
        await autoUpdater.checkForUpdates().catch(() => undefined);
      } catch {
        /* electron-updater optional at runtime in some builds */
      }
    })();
  }

  adb.on("devices", () => {
    void refreshDevices();
  });
  adb.on("error", (err) => {
    send("adb:error", String(err));
  });
  mirrors.on("session-exit", (serial) => {
    if (restartingSerials.has(serial)) return;
    void (async () => {
      fullscreenBySerial.delete(serial);
      if (recordings.has(serial)) {
        await stopRecordingInternal(serial, { discard: true }).catch(() => undefined);
      }
      if (shortcutTarget === serial) {
        shortcutTarget = resolveShortcutTarget();
      }
      syncMirrorShortcuts();
      send("mirror:exit", { serial });
      await refreshDevices();
    })();
  });
  mirrors.on("session-error", (serial, err) => {
    send("mirror:error", { serial, error: String(err) });
    void refreshDevices();
  });

  adb.startWatching();

  const iconPath = resolveAppIconPath();
  if (iconPath && process.platform === "darwin") {
    try {
      app.dock?.setIcon(nativeImage.createFromPath(iconPath));
    } catch {
      /* ignore */
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  mirrorShortcuts?.dispose();
  for (const serial of [...recordings.keys()]) {
    void stopRecordingInternal(serial, { discard: true }).catch(() => undefined);
  }
  adb?.stopWatching();
  void mirrors?.stopAll();
});
