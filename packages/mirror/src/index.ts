import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import fs from "node:fs";
import { prepareMacMirrorApp } from "./macAppBundle";

export type QualityPreset = "low" | "medium" | "high";

export type VideoSource = "display" | "camera";
export type CameraFacing = "front" | "back";

export interface MirrorOptions {
  serial: string;
  scrcpyPath?: string;
  scrcpyServerPath?: string;
  adbPath?: string;
  quality?: QualityPreset;
  maxSize?: number;
  bitRate?: number;
  alwaysOnTop?: boolean;
  stayAwake?: boolean;
  windowTitle?: string;
  fullscreen?: boolean;
  audio?: boolean;
  /** Default true — pass false to disable scrcpy clipboard autosync */
  clipboardAutosync?: boolean;
  videoSource?: VideoSource;
  cameraFacing?: CameraFacing;
  cameraId?: string;
  /** Directory containing scrcpy.png (and optionally disconnected.png) */
  iconDir?: string;
  /** macOS .icns used for the transient dock .app wrapper */
  iconIcnsPath?: string;
}

export interface QualityConfig {
  maxSize: number;
  bitRate: number;
}

const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  low: { maxSize: 800, bitRate: 2_000_000 },
  medium: { maxSize: 1024, bitRate: 8_000_000 },
  high: { maxSize: 1920, bitRate: 16_000_000 },
};

function resolveDefaultScrcpy(): string {
  const candidates = [
    process.env.SCRCPY_PATH,
    path.join(process.cwd(), "vendor", "bin", "scrcpy"),
    path.join(__dirname, "..", "..", "..", "vendor", "bin", "scrcpy"),
    "/opt/homebrew/bin/scrcpy",
    "/usr/local/bin/scrcpy",
    "scrcpy",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === "scrcpy") return candidate;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return "scrcpy";
}

export class MirrorSession extends EventEmitter {
  readonly serial: string;
  private process: ChildProcess | null = null;
  private options: MirrorOptions;
  private stopping: Promise<void> | null = null;

  constructor(options: MirrorOptions) {
    super();
    this.serial = options.serial;
    this.options = options;
  }

  get running(): boolean {
    return this.process !== null && !this.process.killed && this.process.exitCode === null;
  }

  get fullscreen(): boolean {
    return Boolean(this.options.fullscreen);
  }

  get windowTitle(): string {
    return this.options.windowTitle ?? `Mirrox — ${this.serial}`;
  }

  get audioEnabled(): boolean {
    return this.options.audio !== false;
  }

  get videoSource(): VideoSource {
    return this.options.videoSource ?? "display";
  }

  start(): void {
    if (this.running) return;

    const quality = this.options.quality ?? "medium";
    const preset = QUALITY_PRESETS[quality];
    const maxSize = this.options.maxSize ?? preset.maxSize;
    const bitRate = this.options.bitRate ?? preset.bitRate;
    const scrcpyPath = this.options.scrcpyPath ?? resolveDefaultScrcpy();
    const audio = this.options.audio !== false;
    const clipboardAutosync = this.options.clipboardAutosync !== false;
    const videoSource = this.options.videoSource ?? "display";

    const args = [
      "--serial",
      this.serial,
      "--max-size",
      String(maxSize),
      "--video-bit-rate",
      String(bitRate),
      "--window-title",
      this.windowTitle,
    ];

    if (this.options.stayAwake !== false) {
      // --stay-awake alone only works while charging; keep-active + timeout cover the rest
      args.push("--stay-awake");
      args.push("--keep-active");
      args.push("--screen-off-timeout=86400");
    }
    if (this.options.alwaysOnTop) args.push("--always-on-top");
    if (this.options.fullscreen) args.push("--fullscreen");
    if (!audio) args.push("--no-audio");
    if (!clipboardAutosync) args.push("--no-clipboard-autosync");

    if (videoSource === "camera") {
      args.push("--video-source=camera");
      if (this.options.cameraFacing) {
        args.push(`--camera-facing=${this.options.cameraFacing}`);
      }
      if (this.options.cameraId) {
        args.push(`--camera-id=${this.options.cameraId}`);
      }
      // Prefer device mic for camera preview; avoid echoing display audio.
      if (audio) {
        args.push("--audio-source=mic");
      }
    }

    const env = { ...process.env };
    if (this.options.adbPath) {
      env.ADB = this.options.adbPath;
      const adbDir = path.dirname(this.options.adbPath);
      env.PATH = `${adbDir}${path.delimiter}${env.PATH ?? ""}`;
      env.ANDROID_HOME = env.ANDROID_HOME ?? path.dirname(adbDir);
    }

    const serverPath =
      this.options.scrcpyServerPath ||
      path.join(path.dirname(scrcpyPath), "scrcpy-server");
    if (fs.existsSync(serverPath)) {
      env.SCRCPY_SERVER_PATH = serverPath;
    }

    if (this.options.iconDir && fs.existsSync(this.options.iconDir)) {
      env.SCRCPY_ICON_DIR = this.options.iconDir;
    }

    const libDir = path.join(path.dirname(scrcpyPath), "lib");
    if (fs.existsSync(libDir)) {
      const prev = env.DYLD_LIBRARY_PATH ? `${path.delimiter}${env.DYLD_LIBRARY_PATH}` : "";
      const prevFb = env.DYLD_FALLBACK_LIBRARY_PATH
        ? `${path.delimiter}${env.DYLD_FALLBACK_LIBRARY_PATH}`
        : "";
      env.DYLD_LIBRARY_PATH = `${libDir}${prev}`;
      env.DYLD_FALLBACK_LIBRARY_PATH = `${libDir}${prevFb}`;
    }

    let launchPath = scrcpyPath;
    if (process.platform === "darwin") {
      try {
        launchPath = prepareMacMirrorApp({
          serial: this.serial,
          title: this.windowTitle,
          scrcpyPath,
          iconIcnsPath: this.options.iconIcnsPath,
          iconPngPath: this.options.iconDir
            ? path.join(this.options.iconDir, "scrcpy.png")
            : undefined,
        });
      } catch (err) {
        this.emit("stderr", `macOS dock wrapper failed: ${String(err)}\n`);
        launchPath = scrcpyPath;
      }
    }

    const child = spawn(launchPath, args, {
      env,
      cwd: path.dirname(scrcpyPath),
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process = child;

    let stderrBuf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      this.emit("stdout", chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      this.emit("stderr", text);
    });
    child.on("error", (err) => {
      this.emit("error", err);
      this.process = null;
    });
    child.on("exit", (code, signal) => {
      this.process = null;
      this.emit("exit", { code, signal, stderr: stderrBuf });
    });

    this.emit("started");
  }

  /** Kill the process and resolve once it has fully exited. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (!this.process) return Promise.resolve();

    const proc = this.process;
    this.stopping = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.process = null;
        this.stopping = null;
        resolve();
      };

      proc.once("exit", finish);
      try {
        proc.kill("SIGTERM");
      } catch {
        finish();
        return;
      }

      setTimeout(() => {
        if (settled) return;
        try {
          if (!proc.killed) proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        // Failsafe if the process never emits exit
        setTimeout(finish, 500);
      }, 1500);
    });

    return this.stopping;
  }
}

export class MirrorManager extends EventEmitter {
  private sessions = new Map<string, MirrorSession>();
  private defaults: Partial<MirrorOptions>;

  constructor(defaults: Partial<MirrorOptions> = {}) {
    super();
    this.defaults = defaults;
  }

  list(): string[] {
    return [...this.sessions.keys()];
  }

  isRunning(serial: string): boolean {
    return this.sessions.get(serial)?.running ?? false;
  }

  isFullscreen(serial: string): boolean {
    return this.sessions.get(serial)?.fullscreen ?? false;
  }

  getSession(serial: string): MirrorSession | undefined {
    return this.sessions.get(serial);
  }

  start(options: MirrorOptions): MirrorSession {
    const existing = this.sessions.get(options.serial);
    if (existing?.running) return existing;

    if (existing) {
      existing.removeAllListeners();
      this.sessions.delete(options.serial);
    }

    const session = new MirrorSession({ ...this.defaults, ...options });
    session.on("exit", (info) => {
      // Only clear if this session is still the mapped one (avoids wiping a replacement).
      if (this.sessions.get(options.serial) !== session) return;
      this.sessions.delete(options.serial);
      this.emit("session-exit", options.serial, info);
    });
    session.on("error", (err) => {
      if (this.sessions.get(options.serial) !== session) return;
      this.emit("session-error", options.serial, err);
    });
    this.sessions.set(options.serial, session);
    session.start();
    this.emit("session-started", options.serial);
    return session;
  }

  async restart(serial: string, patch: Partial<MirrorOptions> = {}): Promise<MirrorSession> {
    const current = this.sessions.get(serial);
    const next: MirrorOptions = {
      serial,
      ...this.defaults,
      fullscreen: current?.fullscreen,
      ...patch,
      windowTitle: patch.windowTitle ?? current?.windowTitle,
    };
    if (current) {
      current.removeAllListeners();
      const stopPromise = current.stop();
      this.sessions.delete(serial);
      await stopPromise;
    }
    return this.start(next);
  }

  async stop(serial: string): Promise<void> {
    const session = this.sessions.get(serial);
    if (!session) return;
    session.removeAllListeners();
    this.sessions.delete(serial);
    await session.stop();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((serial) => this.stop(serial)));
  }

  updateDefaults(partial: Partial<MirrorOptions>): void {
    this.defaults = { ...this.defaults, ...partial };
  }
}

export { QUALITY_PRESETS, resolveDefaultScrcpy };
