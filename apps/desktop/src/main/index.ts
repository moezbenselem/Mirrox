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
import type { ChildProcess } from "node:child_process";
import { AdbClient, shellQuote, type AdbDevice } from "@vysor/adb";
import { MirrorManager, type QualityPreset } from "@vysor/mirror";
import {
  MirrorShortcutManager,
  MIRROR_SHORTCUTS,
  type MirrorShortcutAction,
} from "./mirrorShortcuts";

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

let mainWindow: BrowserWindow | null = null;
let adb: AdbClient;
let mirrors: MirrorManager;
let mirrorShortcuts: MirrorShortcutManager | null = null;
let shortcutTarget: string | null = null;
let quality: QualityPreset = "medium";
let alwaysOnTop = false;
let keepScreenOn = true;

const audioBySerial = new Map<string, boolean>();
const restartingSerials = new Set<string>();
const recordings = new Map<
  string,
  { child: ChildProcess; remotePath: string; startedAt: number }
>();

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
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 720,
    minHeight: 480,
    title: "Mirrox",
    backgroundColor: "#0f1115",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
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
}

async function takeScreenshotInternal(serial: string): Promise<{
  path: string;
  dataUrl: string;
}> {
  const tempPath = path.join(
    app.getPath("temp"),
    `mirrox-shot-${serial.replace(/[^\w.-]/g, "_")}-${Date.now()}.png`
  );
  await adb.screencap(serial, tempPath);
  const buf = fs.readFileSync(tempPath);
  return {
    path: tempPath,
    dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
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
    audio: audioBySerial.get(d.serial) ?? true,
    recording: recordings.has(d.serial),
  }));
  send("devices:updated", withSessions);
  return withSessions;
}

function startMirror(serial: string, fullscreen = false): void {
  const audio = audioBySerial.get(serial) ?? true;
  const scrcpyPath = resolveVendorBin("scrcpy");
  if (keepScreenOn) {
    void adb.setStayAwake(serial, true).catch(() => undefined);
  }
  mirrors.start({
    serial,
    quality,
    alwaysOnTop,
    stayAwake: keepScreenOn,
    audio,
    fullscreen,
    adbPath: adb.adbPath,
    scrcpyPath,
    scrcpyServerPath: resolveScrcpyServer(scrcpyPath),
    windowTitle: `Mirrox — ${serial}`,
  });
  shortcutTarget = serial;
  syncMirrorShortcuts();
}

function mirrorRestartPatch(serial: string) {
  const scrcpyPath = resolveVendorBin("scrcpy");
  return {
    serial,
    quality,
    alwaysOnTop,
    stayAwake: keepScreenOn,
    audio: audioBySerial.get(serial) ?? true,
    adbPath: adb.adbPath,
    scrcpyPath,
    scrcpyServerPath: resolveScrcpyServer(scrcpyPath),
    windowTitle: `Mirrox — ${serial}`,
  };
}

function restartRunningMirrors(): void {
  for (const serial of mirrors.list()) {
    if (!mirrors.isRunning(serial)) continue;
    restartingSerials.add(serial);
    mirrors.restart(serial, mirrorRestartPatch(serial));
    setTimeout(() => restartingSerials.delete(serial), 1000);
  }
}

async function stopRecordingInternal(serial: string): Promise<{
  ok: boolean;
  saved?: boolean;
  path?: string;
  canceled?: boolean;
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
    `mirrox-rec-${serial.replace(/[^\w.-]/g, "_")}-${Date.now()}.mp4`
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

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Save recording",
    defaultPath: path.join(app.getPath("videos"), `mirrox-${serial}-${Date.now()}.mp4`),
    filters: [{ name: "MP4", extensions: ["mp4"] }],
  });

  if (canceled || !filePath) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    return { ok: true, saved: false, canceled: true };
  }

  fs.copyFileSync(tempPath, filePath);
  try {
    fs.unlinkSync(tempPath);
  } catch {
    /* ignore */
  }
  return { ok: true, saved: true, path: filePath };
}

function registerIpc(): void {
  ipcMain.handle("devices:list", async () => refreshDevices());

  ipcMain.handle("mirror:start", async (_e, serial: string) => {
    startMirror(serial, false);
    await refreshDevices();
    return { ok: true };
  });

  ipcMain.handle("mirror:stop", async (_e, serial: string) => {
    if (recordings.has(serial)) {
      await stopRecordingInternal(serial).catch(() => undefined);
    }
    mirrors.stop(serial);
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
    restartingSerials.add(serial);
    mirrors.stop(serial);
    startMirror(serial, true);
    setTimeout(() => restartingSerials.delete(serial), 1000);
    await refreshDevices();
    return { ok: true };
  });

  ipcMain.handle("device:setAudio", async (_e, serial: string, enabled: boolean) => {
    audioBySerial.set(serial, enabled);
    if (mirrors.isRunning(serial)) {
      restartingSerials.add(serial);
      mirrors.restart(serial, {
        ...mirrorRestartPatch(serial),
        audio: enabled,
      });
      setTimeout(() => restartingSerials.delete(serial), 1000);
    }
    await refreshDevices();
    return { ok: true, audio: enabled };
  });

  ipcMain.handle("device:getSession", async (_e, serial: string) => ({
    serial,
    audio: audioBySerial.get(serial) ?? true,
    mirroring: mirrors.isRunning(serial),
  }));

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
    return {
      quality,
      alwaysOnTop,
      keepScreenOn,
      adbPath: adb.adbPath,
      scrcpyPath,
      scrcpyServerPath: resolveScrcpyServer(scrcpyPath) ?? null,
    };
  });

  ipcMain.handle(
    "settings:set",
    async (
      _e,
      partial: { quality?: QualityPreset; alwaysOnTop?: boolean; keepScreenOn?: boolean }
    ) => {
      const qualityChanged = Boolean(partial.quality) && partial.quality !== quality;
      const alwaysOnTopChanged =
        typeof partial.alwaysOnTop === "boolean" && partial.alwaysOnTop !== alwaysOnTop;
      const keepScreenOnChanged =
        typeof partial.keepScreenOn === "boolean" && partial.keepScreenOn !== keepScreenOn;

      if (partial.quality) quality = partial.quality;
      if (typeof partial.alwaysOnTop === "boolean") alwaysOnTop = partial.alwaysOnTop;
      if (typeof partial.keepScreenOn === "boolean") keepScreenOn = partial.keepScreenOn;
      mirrors.updateDefaults({ quality, alwaysOnTop, stayAwake: keepScreenOn });

      if (keepScreenOnChanged) {
        const devices = await adb.listDevices();
        for (const d of devices) {
          if (d.state !== "device") continue;
          await adb.setStayAwake(d.serial, keepScreenOn).catch(() => undefined);
        }
      }

      // scrcpy picks up quality / window / stay-awake only at launch — restart live sessions
      if (qualityChanged || alwaysOnTopChanged || keepScreenOnChanged) {
        restartRunningMirrors();
        await refreshDevices();
      }

      return { quality, alwaysOnTop, keepScreenOn };
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

  ipcMain.handle("screenshot:take", async (_e, serial: string) => {
    const shot = await takeScreenshotInternal(serial);
    return { ok: true, ...shot };
  });

  ipcMain.handle("screenshot:save", async (_e, tempPath: string, serial: string) => {
    if (!tempPath || !fs.existsSync(tempPath)) {
      throw new Error("Screenshot file missing");
    }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Save screenshot",
      defaultPath: path.join(app.getPath("pictures"), `mirrox-${serial}-${Date.now()}.png`),
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.copyFileSync(tempPath, filePath);
    return { ok: true, path: filePath };
  });

  ipcMain.handle("screenshot:copy", async (_e, tempPath: string) => {
    if (!tempPath || !fs.existsSync(tempPath)) {
      throw new Error("Screenshot file missing");
    }
    const image = nativeImage.createFromPath(tempPath);
    if (image.isEmpty()) throw new Error("Could not load screenshot");
    clipboard.writeImage(image);
    return { ok: true };
  });

  ipcMain.handle("screenshot:discard", async (_e, tempPath: string) => {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
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
      const results = [];
      for (const localPath of localPaths) {
        const base = path.basename(localPath);
        const remotePath = `${remoteDir.replace(/\/+$/, "")}/${base}`;
        const ext = path.extname(localPath).toLowerCase();
        if (ext === ".apk") {
          const detail = await adb.install(serial, localPath);
          results.push({ localPath, action: "install" as const, detail });
        } else {
          await adb.push(serial, localPath, remotePath);
          results.push({ localPath, action: "push" as const, detail: remotePath });
        }
      }
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
      const results = [];
      for (const remotePath of remotePaths) {
        const base = path.basename(remotePath);
        const localPath = path.join(destDir, base);
        await adb.pull(serial, remotePath, localPath);
        results.push({ remotePath, localPath });
      }
      return { ok: true, destDir, results };
    }
  );

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
      title: "Upload to device",
      properties: ["openFile", "multiSelections"],
    });
    if (canceled) return [];
    return filePaths;
  });

  ipcMain.handle("shell:openPath", async (_e, target: string) => {
    await shell.openPath(target);
  });

  ipcMain.handle("app:pickFiles", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
    });
    if (canceled) return [];
    return filePaths;
  });
}

app.whenReady().then(() => {
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
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
      },
      {
        label: "Edit",
        submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
    ])
  );

  registerIpc();
  createWindow();

  adb.on("devices", () => {
    void refreshDevices();
  });
  adb.on("error", (err) => {
    send("adb:error", String(err));
  });
  mirrors.on("session-exit", (serial) => {
    if (restartingSerials.has(serial)) return;
    void (async () => {
      if (recordings.has(serial)) {
        await stopRecordingInternal(serial).catch(() => undefined);
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
    void stopRecordingInternal(serial).catch(() => undefined);
  }
  adb?.stopWatching();
  mirrors?.stopAll();
});
