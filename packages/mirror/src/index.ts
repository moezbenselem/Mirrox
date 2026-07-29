import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import fs from "node:fs";

export type QualityPreset = "low" | "medium" | "high";

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

  constructor(options: MirrorOptions) {
    super();
    this.serial = options.serial;
    this.options = options;
  }

  get running(): boolean {
    return this.process !== null && !this.process.killed;
  }

  get windowTitle(): string {
    return this.options.windowTitle ?? `Mirrox — ${this.serial}`;
  }

  get audioEnabled(): boolean {
    return this.options.audio !== false;
  }

  start(): void {
    if (this.running) return;

    const quality = this.options.quality ?? "medium";
    const preset = QUALITY_PRESETS[quality];
    const maxSize = this.options.maxSize ?? preset.maxSize;
    const bitRate = this.options.bitRate ?? preset.bitRate;
    const scrcpyPath = this.options.scrcpyPath ?? resolveDefaultScrcpy();
    const audio = this.options.audio !== false;

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

    const libDir = path.join(path.dirname(scrcpyPath), "lib");
    if (fs.existsSync(libDir)) {
      const prev = env.DYLD_LIBRARY_PATH ? `${path.delimiter}${env.DYLD_LIBRARY_PATH}` : "";
      const prevFb = env.DYLD_FALLBACK_LIBRARY_PATH
        ? `${path.delimiter}${env.DYLD_FALLBACK_LIBRARY_PATH}`
        : "";
      env.DYLD_LIBRARY_PATH = `${libDir}${prev}`;
      env.DYLD_FALLBACK_LIBRARY_PATH = `${libDir}${prevFb}`;
    }

    const child = spawn(scrcpyPath, args, {
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

  stop(): void {
    if (!this.process) return;
    this.process.kill("SIGTERM");
    const proc = this.process;
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 2000);
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
      this.sessions.delete(options.serial);
      this.emit("session-exit", options.serial, info);
    });
    session.on("error", (err) => {
      this.emit("session-error", options.serial, err);
    });
    this.sessions.set(options.serial, session);
    session.start();
    this.emit("session-started", options.serial);
    return session;
  }

  restart(serial: string, patch: Partial<MirrorOptions> = {}): MirrorSession {
    const current = this.sessions.get(serial);
    const next: MirrorOptions = {
      serial,
      ...this.defaults,
      ...patch,
      windowTitle: patch.windowTitle ?? current?.windowTitle,
    };
    if (current) {
      current.removeAllListeners();
      current.stop();
      this.sessions.delete(serial);
    }
    return this.start(next);
  }

  stop(serial: string): void {
    const session = this.sessions.get(serial);
    if (!session) return;
    session.stop();
    this.sessions.delete(serial);
  }

  stopAll(): void {
    for (const serial of [...this.sessions.keys()]) {
      this.stop(serial);
    }
  }

  updateDefaults(partial: Partial<MirrorOptions>): void {
    this.defaults = { ...this.defaults, ...partial };
  }
}

export { QUALITY_PRESETS, resolveDefaultScrcpy };
