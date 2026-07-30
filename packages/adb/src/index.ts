import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import path from "node:path";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

export type DeviceState = "device" | "unauthorized" | "offline" | "unknown";

export interface AdbDevice {
  serial: string;
  state: DeviceState;
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
  usb?: string;
}

export interface DeviceStorageInfo {
  used?: string;
  total?: string;
  available?: string;
  raw?: string;
}

export interface DeviceBatteryInfo {
  level?: number;
  charging?: boolean;
  status?: string;
}

export interface DeviceDetails {
  serial: string;
  model?: string;
  androidVersion?: string;
  sdk?: string;
  battery?: DeviceBatteryInfo;
  ip?: string | null;
  storage?: DeviceStorageInfo;
  connection: "Cable" | "Wireless";
  available: boolean;
  unavailableReason?: string;
}

export type TransferProgress = {
  phase: "push" | "pull";
  localPath?: string;
  remotePath?: string;
  percent?: number;
  message?: string;
};

export interface AdbFsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface AdbClientOptions {
  adbPath?: string;
  pollIntervalMs?: number;
}

function resolveDefaultAdb(): string {
  const home = process.env.HOME ?? "";
  const candidates = [
    process.env.ADB_PATH,
    path.join(process.cwd(), "vendor", "bin", "adb"),
    path.join(__dirname, "..", "..", "..", "vendor", "bin", "adb"),
    path.join(home, "Library/Android/sdk/platform-tools/adb"),
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
    "adb",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate === "adb") return candidate;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return "adb";
}

/** Quote a path/arg for Android /system/bin/sh so spaces and () are safe. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseDevicesLong(stdout: string): AdbDevice[] {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("List of devices"));

  const devices: AdbDevice[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [serial, stateRaw, ...rest] = parts;
    const state = (["device", "unauthorized", "offline"].includes(stateRaw)
      ? stateRaw
      : "unknown") as DeviceState;

    const meta: Record<string, string> = {};
    for (const token of rest) {
      const eq = token.indexOf(":");
      if (eq > 0) {
        meta[token.slice(0, eq)] = token.slice(eq + 1);
      }
    }

    devices.push({
      serial,
      state,
      model: meta.model?.replace(/_/g, " "),
      product: meta.product,
      device: meta.device,
      transportId: meta.transport_id,
      usb: meta.usb,
    });
  }
  return devices;
}

export class AdbClient extends EventEmitter {
  readonly adbPath: string;
  private pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private lastFingerprint = "";
  private savedScreenOffTimeout = new Map<string, number>();
  private batteryUnpluggedMock = new Set<string>();
  private demoModeActive = new Set<string>();

  constructor(options: AdbClientOptions = {}) {
    super();
    this.adbPath = options.adbPath ?? resolveDefaultAdb();
    this.pollIntervalMs = options.pollIntervalMs ?? 1500;
  }

  async run(args: string[], serial?: string): Promise<{ stdout: string; stderr: string }> {
    const fullArgs = serial ? ["-s", serial, ...args] : args;
    try {
      const { stdout, stderr } = await execFileAsync(this.adbPath, fullArgs, {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 120_000,
      });
      return { stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
      const stderr = e.stderr?.toString() ?? "";
      const stdout = e.stdout?.toString() ?? "";
      throw new Error(stderr || stdout || e.message || "adb command failed");
    }
  }

  /** Run one remote shell command string (paths must already be shellQuote'd). */
  async shell(command: string, serial?: string): Promise<{ stdout: string; stderr: string }> {
    return this.run(["shell", command], serial);
  }

  async listDevices(): Promise<AdbDevice[]> {
    const { stdout } = await this.run(["devices", "-l"]);
    return parseDevicesLong(stdout);
  }

  startWatching(): void {
    if (this.timer) return;
    const tick = async () => {
      try {
        const devices = await this.listDevices();
        const fingerprint = JSON.stringify(devices);
        if (fingerprint !== this.lastFingerprint) {
          this.lastFingerprint = fingerprint;
          this.emit("devices", devices);
        }
      } catch (err) {
        this.emit("error", err);
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), this.pollIntervalMs);
  }

  stopWatching(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getProp(serial: string, prop: string): Promise<string> {
    const { stdout } = await this.run(["shell", "getprop", prop], serial);
    return stdout.trim();
  }

  async enrichDevice(device: AdbDevice): Promise<AdbDevice> {
    if (device.state !== "device") return device;
    try {
      const model =
        device.model ||
        (await this.getProp(device.serial, "ro.product.model")) ||
        undefined;
      return { ...device, model };
    } catch {
      return device;
    }
  }

  async enableTcpip(serial: string, port = 5555): Promise<void> {
    await this.run(["tcpip", String(port)], serial);
  }

  async connect(hostPort: string): Promise<string> {
    const { stdout, stderr } = await this.run(["connect", hostPort]);
    return (stdout || stderr).trim();
  }

  async pair(hostPort: string, code: string): Promise<string> {
    const { stdout, stderr } = await this.run(["pair", hostPort, code]);
    return (stdout || stderr).trim();
  }

  async disconnect(hostPort?: string): Promise<void> {
    await this.run(hostPort ? ["disconnect", hostPort] : ["disconnect"]);
  }

  async keyevent(serial: string, code: number | string): Promise<void> {
    await this.run(["shell", "input", "keyevent", String(code)], serial);
  }

  async expandNotifications(serial: string): Promise<void> {
    try {
      await this.shell("cmd statusbar expand-notifications", serial);
    } catch {
      await this.keyevent(serial, 83);
    }
  }

  async getDeviceIp(serial: string): Promise<string | null> {
    try {
      const { stdout } = await this.run(
        ["shell", "ip", "-f", "inet", "addr", "show", "wlan0"],
        serial
      );
      const match = stdout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
      if (match?.[1]) return match[1];
    } catch {
      /* try fallback */
    }
    try {
      const { stdout } = await this.shell(
        "ip -f inet addr show | grep -oE 'inet [0-9.]+' | grep -v '127.0.0.1' | head -1",
        serial
      );
      const match = stdout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  private isWirelessSerial(serial: string): boolean {
    return /:\d+$/.test(serial) || /adb-tls-connect|_adb-tls-pairing/i.test(serial);
  }

  async getBatteryInfo(serial: string): Promise<DeviceBatteryInfo> {
    try {
      const { stdout } = await this.run(["shell", "dumpsys", "battery"], serial);
      const levelMatch = stdout.match(/level:\s*(\d+)/i);
      const statusMatch = stdout.match(/status:\s*(\d+)/i);
      const pluggedMatch = stdout.match(/powered:\s*(true|false)/i);
      const usbMatch = stdout.match(/USB powered:\s*(true|false)/i);
      const acMatch = stdout.match(/AC powered:\s*(true|false)/i);
      const wirelessMatch = stdout.match(/Wireless powered:\s*(true|false)/i);
      const level = levelMatch ? Number.parseInt(levelMatch[1], 10) : undefined;
      const statusCode = statusMatch ? Number.parseInt(statusMatch[1], 10) : undefined;
      // BatteryManager: 2=CHARGING, 5=FULL
      const chargingFromStatus = statusCode === 2 || statusCode === 5;
      const plugged =
        pluggedMatch?.[1] === "true" ||
        usbMatch?.[1] === "true" ||
        acMatch?.[1] === "true" ||
        wirelessMatch?.[1] === "true";
      const statusNames: Record<number, string> = {
        1: "Unknown",
        2: "Charging",
        3: "Discharging",
        4: "Not charging",
        5: "Full",
      };
      return {
        level: Number.isFinite(level) ? level : undefined,
        charging: chargingFromStatus || plugged,
        status: statusCode != null ? statusNames[statusCode] : undefined,
      };
    } catch {
      return {};
    }
  }

  async getStorageInfo(serial: string): Promise<DeviceStorageInfo> {
    try {
      const { stdout } = await this.shell("df -h /sdcard 2>/dev/null || df -h /data", serial);
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const dataLine = lines.find((l) => !l.toLowerCase().startsWith("filesystem")) ?? lines[1];
      if (!dataLine) return {};
      const parts = dataLine.split(/\s+/);
      // Filesystem Size Used Avail Use% Mounted
      if (parts.length >= 4) {
        return {
          total: parts[1],
          used: parts[2],
          available: parts[3],
          raw: dataLine,
        };
      }
      return { raw: dataLine };
    } catch {
      return {};
    }
  }

  async getDeviceDetails(serial: string): Promise<DeviceDetails> {
    const connection = this.isWirelessSerial(serial) ? "Wireless" : "Cable";
    try {
      const devices = await this.listDevices();
      const found = devices.find((d) => d.serial === serial);
      if (!found) {
        return {
          serial,
          connection,
          available: false,
          unavailableReason: "Device not found",
        };
      }
      if (found.state !== "device") {
        return {
          serial,
          model: found.model,
          connection,
          available: false,
          unavailableReason:
            found.state === "unauthorized"
              ? "Unauthorized — allow USB debugging on the phone"
              : `Device is ${found.state}`,
        };
      }

      const [model, androidVersion, sdk, battery, ip, storage] = await Promise.all([
        found.model
          ? Promise.resolve(found.model)
          : this.getProp(serial, "ro.product.model").catch(() => ""),
        this.getProp(serial, "ro.build.version.release").catch(() => ""),
        this.getProp(serial, "ro.build.version.sdk").catch(() => ""),
        this.getBatteryInfo(serial),
        this.getDeviceIp(serial),
        this.getStorageInfo(serial),
      ]);

      return {
        serial,
        model: model || found.model || found.product,
        androidVersion: androidVersion || undefined,
        sdk: sdk || undefined,
        battery,
        ip,
        storage,
        connection,
        available: true,
      };
    } catch (err) {
      return {
        serial,
        connection,
        available: false,
        unavailableReason: String(err),
      };
    }
  }

  /**
   * Push a file or directory. adb push is recursive for directories.
   * Progress is best-effort from adb stderr percentage lines.
   */
  pushWithProgress(
    serial: string,
    localPath: string,
    remotePath: string,
    onProgress?: (p: TransferProgress) => void
  ): { promise: Promise<void>; child: ReturnType<AdbClient["spawnShell"]> } {
    const fullArgs = ["-s", serial, "push", localPath, remotePath];
    const child = spawn(this.adbPath, fullArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const promise = new Promise<void>((resolve, reject) => {
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        const match = text.match(/(\d+)%/);
        if (match) {
          onProgress?.({
            phase: "push",
            localPath,
            remotePath,
            percent: Number.parseInt(match[1], 10),
            message: path.basename(localPath),
          });
        }
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `adb push failed (${code})`));
      });
    });
    return { promise, child };
  }

  pullWithProgress(
    serial: string,
    remotePath: string,
    localPath: string,
    onProgress?: (p: TransferProgress) => void
  ): { promise: Promise<void>; child: ReturnType<AdbClient["spawnShell"]> } {
    const fullArgs = ["-s", serial, "pull", remotePath, localPath];
    const child = spawn(this.adbPath, fullArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const promise = new Promise<void>((resolve, reject) => {
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        const match = text.match(/(\d+)%/);
        if (match) {
          onProgress?.({
            phase: "pull",
            localPath,
            remotePath,
            percent: Number.parseInt(match[1], 10),
            message: path.basename(remotePath),
          });
        }
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `adb pull failed (${code})`));
      });
    });
    return { promise, child };
  }

  async screencap(serial: string, destPath: string): Promise<string> {
    const remote = "/sdcard/mirrox-shot.png";
    await this.shell(`screencap -p -- ${shellQuote(remote)}`, serial);
    await this.run(["pull", remote, destPath], serial);
    await this.shell(`rm -f -- ${shellQuote(remote)}`, serial).catch(() => undefined);
    return destPath;
  }

  /** Turn device display off/on (mirror can keep running). */
  async setDisplayPower(serial: string, on: boolean): Promise<void> {
    // 224 KEYCODE_WAKEUP, 223 KEYCODE_SLEEP
    await this.run(["shell", "input", "keyevent", on ? "224" : "223"], serial);
  }

  /**
   * Keep the device screen from sleeping.
   * Uses multiple strategies because stay_on_while_plugged_in only works while
   * charging, and many hubs / wireless ADB sessions don't report as plugged in.
   */
  async setStayAwake(serial: string, enabled: boolean): Promise<void> {
    if (enabled) {
      if (!this.savedScreenOffTimeout.has(serial)) {
        try {
          const { stdout } = await this.run(
            ["shell", "settings", "get", "system", "screen_off_timeout"],
            serial
          );
          const value = Number.parseInt(stdout.trim(), 10);
          if (Number.isFinite(value) && value > 0 && value < 2_147_483_647) {
            this.savedScreenOffTimeout.set(serial, value);
          }
        } catch {
          /* ignore */
        }
      }

      await this.shell("svc power stayon true", serial).catch(() => undefined);
      await this.run(
        ["shell", "settings", "put", "global", "stay_on_while_plugged_in", "7"],
        serial
      ).catch(() => undefined);
      // Max timeout (~24 days). Works even when not charging.
      await this.run(
        ["shell", "settings", "put", "system", "screen_off_timeout", "2147483647"],
        serial
      ).catch(() => undefined);
      // Make stay_on_while_plugged_in take effect over Wi‑Fi / non-charging USB.
      await this.shell("dumpsys battery set usb 1", serial)
        .then(() => {
          this.batteryUnpluggedMock.add(serial);
        })
        .catch(() => undefined);
      await this.setDisplayPower(serial, true).catch(() => undefined);
      return;
    }

    await this.shell("svc power stayon false", serial).catch(() => undefined);
    await this.run(
      ["shell", "settings", "put", "global", "stay_on_while_plugged_in", "0"],
      serial
    ).catch(() => undefined);
    const previous = this.savedScreenOffTimeout.get(serial) ?? 60_000;
    this.savedScreenOffTimeout.delete(serial);
    await this.run(
      ["shell", "settings", "put", "system", "screen_off_timeout", String(previous)],
      serial
    ).catch(() => undefined);
    if (this.batteryUnpluggedMock.has(serial)) {
      this.batteryUnpluggedMock.delete(serial);
      await this.shell("dumpsys battery reset", serial).catch(() => undefined);
    }
  }

  async getStayAwake(serial: string): Promise<boolean> {
    try {
      const { stdout } = await this.run(
        ["shell", "settings", "get", "global", "stay_on_while_plugged_in"],
        serial
      );
      const value = Number.parseInt(stdout.trim(), 10);
      return Number.isFinite(value) && value > 0;
    } catch {
      return false;
    }
  }

  async isDisplayOn(serial: string): Promise<boolean> {
    try {
      const { stdout } = await this.run(["shell", "dumpsys", "power"], serial);
      if (/mWakefulness=Asleep/i.test(stdout) || /mHoldingDisplaySuspendBlocker=false/i.test(stdout)) {
        if (/mWakefulness=Awake/i.test(stdout)) return true;
        if (/mWakefulness=Asleep/i.test(stdout) || /mWakefulness=Dozing/i.test(stdout)) {
          return false;
        }
      }
      if (/Display Power: state=OFF/i.test(stdout) || /mScreenOn=false/i.test(stdout)) {
        return false;
      }
      if (/Display Power: state=ON/i.test(stdout) || /mScreenOn=true/i.test(stdout)) {
        return true;
      }
      return true;
    } catch {
      return true;
    }
  }

  /**
   * Android System UI Demo Mode (Developer options → Demo mode).
   * Cleans the status bar for screenshots: fixed clock, full signal/battery, no notifications.
   */
  async setDemoMode(serial: string, enabled: boolean): Promise<void> {
    const demo = (command: string, extras = ""): Promise<unknown> =>
      this.shell(
        `am broadcast -a com.android.systemui.demo -e command ${command}${extras ? ` ${extras}` : ""}`,
        serial
      ).catch(() => undefined);

    if (enabled) {
      await this.run(
        ["shell", "settings", "put", "global", "sysui_demo_allowed", "1"],
        serial
      ).catch(() => undefined);
      await demo("enter");
      await demo("clock", "-e hhmm 1200");
      await demo("network", "-e wifi show -e level 4");
      await demo("network", "-e mobile show -e level 4 -e datatype lte");
      await demo("battery", "-e level 100 -e plugged false");
      await demo("notifications", "-e visible false");
      this.demoModeActive.add(serial);
      return;
    }

    await demo("exit");
    this.demoModeActive.delete(serial);
  }

  isDemoMode(serial: string): boolean {
    return this.demoModeActive.has(serial);
  }

  startScreenrecord(serial: string, remotePath: string) {
    // Passed as separate argv so spawn doesn't re-parse; still quote for safety via shell -c
    return this.spawnShell(
      ["shell", `screenrecord --bit-rate 8000000 --time-limit 180 -- ${shellQuote(remotePath)}`],
      serial
    );
  }

  /**
   * Stop on-device screenrecord so it can finalize the MP4 (write moov atom).
   * Killing the host adb process first drops the session and leaves a corrupt file.
   */
  async stopScreenrecordProcess(
    serial: string,
    child: ReturnType<AdbClient["spawnShell"]>
  ): Promise<void> {
    // Signal the device-side process first (SIGINT = clean finalize).
    await this.shell(
      "pkill -INT screenrecord 2>/dev/null || kill -INT $(pidof screenrecord) 2>/dev/null || true",
      serial
    ).catch(() => undefined);

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      if (!child.killed && child.exitCode === null) {
        child.once("exit", () => done());
        setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
          done();
        }, 5000);
      } else {
        done();
      }
    });

    // Give the filesystem a moment to flush the moov atom before pull.
    await new Promise((r) => setTimeout(r, 500));
  }

  async push(serial: string, localPath: string, remotePath: string): Promise<void> {
    await this.run(["push", localPath, remotePath], serial);
  }

  async pull(serial: string, remotePath: string, localPath: string): Promise<void> {
    await this.run(["pull", remotePath, localPath], serial);
  }

  async listDir(serial: string, remotePath: string): Promise<AdbFsEntry[]> {
    const target = remotePath.replace(/\/+$/, "") || "/";
    let stdout = "";
    try {
      ({ stdout } = await this.shell(`ls -1pA -- ${shellQuote(target)}`, serial));
    } catch {
      ({ stdout } = await this.shell(`ls -1pA ${shellQuote(target)}`, serial));
    }

    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "./" && l !== "../");

    const entries: AdbFsEntry[] = [];
    for (const nameRaw of lines) {
      const isDir = nameRaw.endsWith("/");
      const name = isDir ? nameRaw.slice(0, -1) : nameRaw;
      if (!name || name === "." || name === "..") continue;
      const fullPath = target === "/" ? `/${name}` : `${target}/${name}`;
      entries.push({
        name,
        path: fullPath,
        isDirectory: isDir,
      });
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return entries;
  }

  async mkdir(serial: string, remotePath: string): Promise<void> {
    await this.shell(`mkdir -p -- ${shellQuote(remotePath)}`, serial);
  }

  async remove(serial: string, remotePath: string, recursive = false): Promise<void> {
    const flag = recursive ? "-rf" : "-f";
    await this.shell(`rm ${flag} -- ${shellQuote(remotePath)}`, serial);
  }

  async rename(serial: string, fromPath: string, toPath: string): Promise<void> {
    await this.shell(`mv -- ${shellQuote(fromPath)} ${shellQuote(toPath)}`, serial);
  }

  async copy(serial: string, fromPath: string, toPath: string, recursive = false): Promise<void> {
    const flag = recursive ? "-r" : "";
    await this.shell(
      `cp ${flag} -- ${shellQuote(fromPath)} ${shellQuote(toPath)}`.replace(/\s+/g, " ").trim(),
      serial
    );
  }

  async exists(serial: string, remotePath: string): Promise<boolean> {
    try {
      const { stdout } = await this.shell(
        `if [ -e ${shellQuote(remotePath)} ]; then echo yes; else echo no; fi`,
        serial
      );
      return stdout.trim() === "yes";
    } catch {
      return false;
    }
  }

  async uniqueCopyPath(serial: string, remotePath: string): Promise<string> {
    const dir = remotePath.includes("/")
      ? remotePath.slice(0, remotePath.lastIndexOf("/")) || "/"
      : "/";
    const base = remotePath.slice(remotePath.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    const hasExt = dot > 0;
    const stem = hasExt ? base.slice(0, dot) : base;
    const ext = hasExt ? base.slice(dot) : "";

    let candidate = `${dir}/${stem} copy${ext}`;
    let n = 2;
    while (await this.exists(serial, candidate)) {
      candidate = `${dir}/${stem} copy ${n}${ext}`;
      n += 1;
      if (n > 100) throw new Error("Could not find a free duplicate name");
    }
    return candidate;
  }

  async install(serial: string, apkPath: string): Promise<string> {
    const { stdout, stderr } = await this.run(["install", "-r", apkPath], serial);
    return (stdout || stderr).trim();
  }

  async pushOrInstall(serial: string, localPath: string): Promise<{ action: "install" | "push"; detail: string }> {
    const ext = path.extname(localPath).toLowerCase();
    if (ext === ".apk") {
      const detail = await this.install(serial, localPath);
      return { action: "install", detail };
    }
    const base = path.basename(localPath);
    const remote = `/sdcard/Download/${base}`;
    await this.push(serial, localPath, remote);
    return { action: "push", detail: remote };
  }

  spawnShell(args: string[], serial?: string) {
    const fullArgs = serial ? ["-s", serial, ...args] : args;
    return spawn(this.adbPath, fullArgs, { stdio: ["ignore", "pipe", "pipe"] });
  }
}

export { resolveDefaultAdb, parseDevicesLong };
