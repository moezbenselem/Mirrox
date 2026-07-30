#!/usr/bin/env node
/**
 * Make the macOS Dock show "Mirrox" instead of "Electron" during development.
 * Dock labels come from the .app bundle filename, so we rename Electron.app → Mirrox.app
 * and update electron's path.txt. Packaged builds already use productName.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = "Mirrox";
const APP_ID = "com.mirrox.app";

function patchPlist(plistPath) {
  if (!fs.existsSync(plistPath)) return false;
  let xml = fs.readFileSync(plistPath, "utf8");
  const before = xml;

  xml = xml.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${APP_NAME}$2`
  );
  xml = xml.replace(
    /(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${APP_NAME}$2`
  );
  xml = xml.replace(
    /(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${APP_ID}$2`
  );

  if (xml === before) return false;
  fs.writeFileSync(plistPath, xml);
  return true;
}

function copyDockIcon(resourcesDir) {
  const src = path.join(__dirname, "../apps/desktop/build/icon.icns");
  const dest = path.join(resourcesDir, "electron.icns");
  if (!fs.existsSync(src) || !fs.existsSync(resourcesDir)) return false;
  fs.copyFileSync(src, dest);
  return true;
}

function renameBundle(distDir) {
  const from = path.join(distDir, "Electron.app");
  const to = path.join(distDir, `${APP_NAME}.app`);
  if (fs.existsSync(to) && !fs.existsSync(from)) {
    return to; // already renamed
  }
  if (!fs.existsSync(from)) return null;
  if (fs.existsSync(to)) {
    fs.rmSync(to, { recursive: true, force: true });
  }
  fs.renameSync(from, to);
  return to;
}

function updatePathTxt(electronRoot) {
  const pathFile = path.join(electronRoot, "path.txt");
  const next = `${APP_NAME}.app/Contents/MacOS/Electron`;
  fs.writeFileSync(pathFile, next);
  return next;
}

function touchBundle(appPath) {
  try {
    // Refresh Launch Services registration so Dock/Finder pick up the new name.
    execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", [
      "-f",
      appPath,
    ], { stdio: "ignore" });
  } catch {
    /* optional */
  }
}

function main() {
  if (process.platform !== "darwin") return;

  let electronRoot;
  try {
    electronRoot = path.dirname(require.resolve("electron/package.json"));
  } catch {
    return;
  }

  const distDir = path.join(electronRoot, "dist");
  const appPath = renameBundle(distDir);
  if (!appPath) {
    console.warn("[mirrox] Electron.app not found — skip dock rename");
    return;
  }

  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const resourcesDir = path.join(appPath, "Contents", "Resources");

  const renamedPlist = patchPlist(plistPath);
  const iconed = copyDockIcon(resourcesDir);
  const pathTxt = updatePathTxt(electronRoot);
  touchBundle(appPath);

  console.log(
    `[mirrox] Dock app bundle → ${path.basename(appPath)} (path.txt=${pathTxt}${
      renamedPlist ? ", plist" : ""
    }${iconed ? ", icon" : ""})`
  );
}

main();
