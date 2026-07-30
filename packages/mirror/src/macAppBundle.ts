import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeSerial(serial: string): string {
  return serial.replace(/[^\w.-]+/g, "_").slice(0, 64) || "device";
}

/** Safe .app folder name — Dock tooltip uses this filename, not CFBundleName. */
function sanitizeAppFileName(title: string): string {
  const cleaned = title
    .replace(/[/:\\]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (cleaned || "Mirrox Mirror").slice(0, 100);
}

function shortId(serial: string): string {
  return createHash("sha1").update(serial).digest("hex").slice(0, 6);
}

function cacheBase(): string {
  return path.join(os.homedir(), "Library", "Caches", "Mirrox", "mirror-apps");
}

function ownerFile(appPath: string): string {
  return path.join(appPath, "Contents", "Resources", ".mirrox-serial");
}

function removeApp(appPath: string): void {
  try {
    fs.rmSync(appPath, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Drop stale wrappers for this serial (old serial-named or previous titles). */
function cleanupOwnedApps(serial: string, keepPath: string): void {
  const base = cacheBase();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(base);
  } catch {
    return;
  }

  const serialKey = sanitizeSerial(serial);
  for (const name of entries) {
    if (!name.endsWith(".app")) continue;
    const appPath = path.join(base, name);
    if (path.resolve(appPath) === path.resolve(keepPath)) continue;

    // Legacy: Mirrox-<serial>.app
    if (name === `Mirrox-${serialKey}.app`) {
      removeApp(appPath);
      continue;
    }

    try {
      const owned = fs.readFileSync(ownerFile(appPath), "utf8").trim();
      if (owned === serial) removeApp(appPath);
    } catch {
      /* not ours / unreadable */
    }
  }
}

/**
 * Build (or refresh) a transient macOS .app named after the window title
 * (e.g. "Note 16 Pro — Wireless.app"). Dock labels use the .app filename.
 * Returns the path of the executable inside the bundle.
 */
export function prepareMacMirrorApp(options: {
  serial: string;
  title: string;
  scrcpyPath: string;
  iconIcnsPath?: string;
  iconPngPath?: string;
}): string {
  const base = cacheBase();
  fs.mkdirSync(base, { recursive: true });

  const title = options.title.slice(0, 120).trim() || "Mirrox Mirror";
  let fileName = sanitizeAppFileName(title);
  let appPath = path.join(base, `${fileName}.app`);

  // Avoid colliding with another device that shares the same display title.
  try {
    if (fs.existsSync(appPath)) {
      const owned = fs.readFileSync(ownerFile(appPath), "utf8").trim();
      if (owned && owned !== options.serial) {
        fileName = sanitizeAppFileName(`${title} (${shortId(options.serial)})`);
        appPath = path.join(base, `${fileName}.app`);
      }
    }
  } catch {
    /* create fresh */
  }

  cleanupOwnedApps(options.serial, appPath);

  const contents = path.join(appPath, "Contents");
  const macosDir = path.join(contents, "MacOS");
  const resourcesDir = path.join(contents, "Resources");
  fs.mkdirSync(macosDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  const execName = "MirroxMirror";
  const execPath = path.join(macosDir, execName);

  // Copy (don't symlink) so the running Mach-O path stays inside the .app.
  fs.copyFileSync(path.resolve(options.scrcpyPath), execPath);
  fs.chmodSync(execPath, 0o755);

  let iconFile = "";
  if (options.iconIcnsPath && fs.existsSync(options.iconIcnsPath)) {
    const dest = path.join(resourcesDir, "AppIcon.icns");
    fs.copyFileSync(options.iconIcnsPath, dest);
    iconFile = "AppIcon";
  } else if (options.iconPngPath && fs.existsSync(options.iconPngPath)) {
    fs.copyFileSync(options.iconPngPath, path.join(resourcesDir, "AppIcon.png"));
  }

  fs.writeFileSync(ownerFile(appPath), options.serial);

  const bundleId = `com.mirrox.mirror.${sanitizeSerial(options.serial)}`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${escapeXml(title)}</string>
  <key>CFBundleExecutable</key>
  <string>${execName}</string>
  <key>CFBundleIdentifier</key>
  <string>${escapeXml(bundleId)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${escapeXml(title)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
${
  iconFile
    ? `  <key>CFBundleIconFile</key>\n  <string>${iconFile}</string>\n`
    : ""
}
</dict>
</plist>
`;
  fs.writeFileSync(path.join(contents, "Info.plist"), plist);

  try {
    execFileSync(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-f", appPath],
      { stdio: "ignore" }
    );
  } catch {
    /* optional */
  }

  return execPath;
}
