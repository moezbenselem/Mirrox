#!/usr/bin/env node
/**
 * Vendors adb + portable scrcpy + ffmpeg (with dylibs) into vendor/bin-<arch>.
 *
 * Usage:
 *   npm run vendor              # host arch (arm64 or x64)
 *   npm run vendor:arm64
 *   npm run vendor:x64          # uses vendor/staging-x64 cellar bottles
 *
 * Env:
 *   SCRCPY_PATH, ADB_PATH, FFMPEG_PATH, VENDOR_ARCH=arm64|x64
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArch() {
  const arg = process.argv.find((a) => a.startsWith("--arch="));
  if (arg) return arg.slice("--arch=".length);
  if (process.env.VENDOR_ARCH) return process.env.VENDOR_ARCH;
  return process.arch === "x64" || process.arch === "ia32" ? "x64" : "arm64";
}

const arch = parseArch();
if (arch !== "arm64" && arch !== "x64") {
  console.error(`Unsupported arch: ${arch}`);
  process.exit(1);
}

const outDir = path.join(root, "vendor", `bin-${arch}`);
const libDir = path.join(outDir, "lib");
const stagingCellar = path.join(root, "vendor", "staging-x64", "cellar");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(libDir, { recursive: true });

function which(cmd) {
  const result = spawnSync("which", [cmd], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function copyBinary(src, destName) {
  const dest = path.join(outDir, destName);
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`vendored ${destName} <- ${src}`);
  return dest;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (result.status !== 0) {
    const err = result.stderr || result.stdout || `${cmd} failed`;
    throw new Error(err.trim());
  }
  return result.stdout;
}

function fileArch(filePath) {
  const out = run("file", [filePath]);
  if (out.includes("x86_64") && out.includes("arm64")) return "universal";
  if (out.includes("x86_64")) return "x64";
  if (out.includes("arm64")) return "arm64";
  return "unknown";
}

function ensureX64Prefix(cellar, prefix) {
  fs.mkdirSync(path.join(prefix, "opt"), { recursive: true });
  if (!fs.existsSync(cellar)) return;
  for (const formula of fs.readdirSync(cellar)) {
    const formulaDir = path.join(cellar, formula);
    if (!fs.statSync(formulaDir).isDirectory()) continue;
    const versions = fs.readdirSync(formulaDir).filter((v) =>
      fs.statSync(path.join(formulaDir, v)).isDirectory()
    );
    if (!versions.length) continue;
    const target = path.join(formulaDir, versions[0]);
    const link = path.join(prefix, "opt", formula);
    fs.rmSync(link, { recursive: true, force: true });
    fs.symlinkSync(target, link);
  }
}

function rewriteStagingInstallName(dep, stagingRoot) {
  const marker = `${path.sep}vendor${path.sep}staging-x64${path.sep}`;
  const idx = dep.indexOf(marker);
  if (idx === -1) return dep;
  return path.join(stagingRoot, dep.slice(idx + marker.length));
}

function relocateHomebrewPlaceholders(cellar, prefix) {
  const stagingRoot = path.dirname(prefix);
  const stagingMarker = "/vendor/staging-x64/";
  const replacements = [
    ["@@HOMEBREW_PREFIX@@", prefix],
    ["@@HOMEBREW_CELLAR@@", cellar],
  ];
  const out = spawnSync("find", [cellar, "-type", "f"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const files = (out.stdout || "").split("\n").filter(Boolean);
  let changes = 0;
  for (const file of files) {
    const kind = spawnSync("file", ["-b", file], { encoding: "utf8" }).stdout || "";
    if (!kind.includes("Mach-O")) continue;
    const libs =
      spawnSync("otool", ["-L", file], { encoding: "utf8" }).stdout || "";
    const idOut = spawnSync("otool", ["-D", file], { encoding: "utf8" }).stdout || "";
    const needs =
      replacements.some(([ph]) => libs.includes(ph) || idOut.includes(ph)) ||
      libs.includes(stagingMarker) ||
      idOut.includes(stagingMarker);
    if (!needs) continue;

    const idLines = idOut.trim().split("\n");
    const curId = idLines.length >= 2 ? idLines[idLines.length - 1].trim() : "";
    let newId = curId;
    for (const [ph, to] of replacements) newId = newId.replaceAll(ph, to);
    newId = rewriteStagingInstallName(newId, stagingRoot);
    if (newId !== curId && curId) {
      spawnSync("install_name_tool", ["-id", newId, file], { encoding: "utf8" });
      changes += 1;
    }

    for (const line of libs.trim().split("\n").slice(1)) {
      const dep = line.trim().split(/\s+/)[0];
      let next = dep;
      for (const [ph, to] of replacements) next = next.replaceAll(ph, to);
      next = rewriteStagingInstallName(next, stagingRoot);
      if (next === dep) continue;
      const result = spawnSync("install_name_tool", ["-change", dep, next, file], {
        encoding: "utf8",
      });
      if (result.status === 0) changes += 1;
    }
  }
  console.log(`relocated ${changes} bottle install-name(s)`);
}

function collectLibSearchDirs(cellar) {
  if (!fs.existsSync(cellar)) return [];
  const out = spawnSync(
    "find",
    [cellar, "-type", "d", "(", "-name", "lib", "-o", "-name", "libexec", ")"],
    { encoding: "utf8" }
  );
  return (out.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((p) => p && !p.includes(`${path.sep}share${path.sep}`));
}

function findInCellar(cellar, name) {
  if (!fs.existsSync(cellar)) return null;
  const out = spawnSync("find", [cellar, "-type", "f", "-name", name], {
    encoding: "utf8",
  });
  const matches = (out.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (name === "scrcpy") {
    return (
      matches.find((p) => p.includes(`${path.sep}bin${path.sep}scrcpy`)) ??
      matches[0] ??
      null
    );
  }
  if (name === "scrcpy-server") {
    return (
      matches.find((p) => p.includes(`${path.sep}share${path.sep}scrcpy${path.sep}`)) ??
      matches[0] ??
      null
    );
  }
  if (name === "ffmpeg") {
    return (
      matches.find((p) => p.includes(`${path.sep}bin${path.sep}ffmpeg`)) ??
      matches[0] ??
      null
    );
  }
  return matches[0] ?? null;
}

function bundleDylibs(binaryOut, destLibDir, installPath, searchDirs, { overwriteDest = false } = {}) {
  const dylibbundler = which("dylibbundler");
  if (!dylibbundler) {
    throw new Error("dylibbundler not found. Run: brew install dylibbundler");
  }
  fs.mkdirSync(destLibDir, { recursive: true });
  console.log(`Bundling dylibs for ${path.basename(binaryOut)} → ${path.basename(destLibDir)}…`);
  const bundlerArgs = [
    ...(overwriteDest ? ["-od"] : ["-cd"]),
    "-b",
    "-x",
    binaryOut,
    "-d",
    destLibDir,
    "-p",
    installPath,
  ];
  for (const dir of searchDirs) {
    bundlerArgs.push("-s", dir);
  }
  run(dylibbundler, bundlerArgs);
  try {
    run("install_name_tool", [
      "-add_rpath",
      installPath.replace(/\/$/, ""),
      binaryOut,
    ]);
  } catch {
    /* already present */
  }
}

const adb =
  process.env.ADB_PATH ||
  which("adb") ||
  path.join(process.env.HOME ?? "", "Library/Android/sdk/platform-tools/adb");

if (!adb || !fs.existsSync(adb)) {
  console.error("adb not found. Install Android platform-tools or set ADB_PATH.");
  process.exit(1);
}
const adbArch = fileArch(adb);
if (adbArch !== "universal" && adbArch !== arch) {
  console.warn(`warning: adb is ${adbArch}, packaging for ${arch}`);
}
copyBinary(adb, "adb");

let scrcpy = process.env.SCRCPY_PATH || null;
let serverFrom = null;
const searchDirs = [];

function ensureX64CellarFromBottles(stagingRoot, cellar) {
  if (findInCellar(cellar, "scrcpy")) return;
  const bottlesDir = path.join(stagingRoot, "bottles");
  if (!fs.existsSync(bottlesDir)) return;
  const archives = fs
    .readdirSync(bottlesDir)
    .filter((f) => f.endsWith(".tar.gz"));
  if (!archives.length) return;

  console.log("Extracting x64 bottles into cellar…");
  fs.mkdirSync(cellar, { recursive: true });
  for (const archive of archives) {
    console.log(`extract ${archive}`);
    run("tar", ["-xzf", path.join(bottlesDir, archive), "-C", cellar]);
  }
}

if (arch === "x64") {
  const stagingRoot = path.join(root, "vendor", "staging-x64");
  const prefix = path.join(stagingRoot, "prefix");
  ensureX64CellarFromBottles(stagingRoot, stagingCellar);
  ensureX64Prefix(stagingCellar, prefix);
  relocateHomebrewPlaceholders(stagingCellar, prefix);

  if (!scrcpy) {
    scrcpy = findInCellar(stagingCellar, "scrcpy");
  }
  serverFrom = findInCellar(stagingCellar, "scrcpy-server");
  searchDirs.push(...collectLibSearchDirs(stagingCellar));
  searchDirs.push(...collectLibSearchDirs(path.join(prefix, "opt")));
  if (!scrcpy || !fs.existsSync(scrcpy)) {
    console.error(
      "x64 scrcpy not found. Populate vendor/staging-x64/bottles (or cellar) with Homebrew sonoma bottles, or set SCRCPY_PATH."
    );
    process.exit(1);
  }
} else {
  scrcpy = scrcpy || which("scrcpy");
  if (!scrcpy || !fs.existsSync(scrcpy)) {
    console.error("scrcpy not found. Run: brew install scrcpy");
    process.exit(1);
  }
}

const scrcpyArchInfo = run("file", [scrcpy]).trim();
console.log("scrcpy arch:", scrcpyArchInfo);
const resolvedArch = fileArch(scrcpy);
if (resolvedArch !== "universal" && resolvedArch !== arch) {
  console.error(`scrcpy is ${resolvedArch}, expected ${arch}`);
  process.exit(1);
}
copyBinary(scrcpy, "scrcpy");

const scrcpyDir = path.dirname(scrcpy);
const serverCandidates = [
  serverFrom,
  path.join(scrcpyDir, "scrcpy-server"),
  path.join(scrcpyDir, "../share/scrcpy/scrcpy-server"),
  "/opt/homebrew/share/scrcpy/scrcpy-server",
  "/usr/local/share/scrcpy/scrcpy-server",
].filter(Boolean);

let serverFound = false;
for (const candidate of serverCandidates) {
  if (fs.existsSync(candidate)) {
    fs.copyFileSync(candidate, path.join(outDir, "scrcpy-server"));
    console.log(`vendored scrcpy-server <- ${candidate}`);
    serverFound = true;
    break;
  }
}
if (!serverFound) {
  console.error("scrcpy-server not found");
  process.exit(1);
}

const dylibbundler = which("dylibbundler");
if (!dylibbundler) {
  console.error("dylibbundler not found. Run: brew install dylibbundler");
  process.exit(1);
}

const scrcpyOut = path.join(outDir, "scrcpy");
bundleDylibs(scrcpyOut, libDir, "@executable_path/lib/", searchDirs, {
  overwriteDest: true,
});

let ffmpeg =
  process.env.FFMPEG_PATH ||
  (arch === "x64" ? findInCellar(stagingCellar, "ffmpeg") : null) ||
  which("ffmpeg");
if (!ffmpeg || !fs.existsSync(ffmpeg)) {
  console.error(
    "ffmpeg not found. Run: brew install ffmpeg (or set FFMPEG_PATH)."
  );
  process.exit(1);
}
const ffmpegArchInfo = run("file", [ffmpeg]).trim();
console.log("ffmpeg arch:", ffmpegArchInfo);
const ffmpegArch = fileArch(ffmpeg);
if (ffmpegArch !== "universal" && ffmpegArch !== arch) {
  console.error(`ffmpeg is ${ffmpegArch}, expected ${arch}`);
  process.exit(1);
}
const ffmpegOut = copyBinary(ffmpeg, "ffmpeg");
const ffmpegLibDir = path.join(outDir, "ffmpeg-lib");
const ffmpegSearchDirs = [...searchDirs];
const ffmpegDir = path.dirname(ffmpeg);
ffmpegSearchDirs.push(ffmpegDir);
ffmpegSearchDirs.push(path.join(ffmpegDir, "..", "lib"));
if (arch === "x64") {
  ffmpegSearchDirs.push(...collectLibSearchDirs(stagingCellar));
}
bundleDylibs(
  ffmpegOut,
  ffmpegLibDir,
  "@executable_path/ffmpeg-lib/",
  ffmpegSearchDirs,
  { overwriteDest: true }
);

const libs = [
  ...fs.readdirSync(libDir).filter((f) => f.endsWith(".dylib")).map((f) => path.join(libDir, f)),
  ...fs
    .readdirSync(ffmpegLibDir)
    .filter((f) => f.endsWith(".dylib"))
    .map((f) => path.join(ffmpegLibDir, f)),
];
console.log(`bundled ${libs.length} dylib(s)`);

console.log("Re-signing binaries + dylibs…");
run("codesign", ["--force", "--sign", "-", scrcpyOut]);
run("codesign", ["--force", "--sign", "-", ffmpegOut]);
for (const lib of libs) {
  run("codesign", ["--force", "--sign", "-", lib]);
}

const smokeCmd =
  arch === "x64" && process.arch !== "x64"
    ? ["arch", ["-x86_64", scrcpyOut, "--version"]]
    : [scrcpyOut, ["--version"]];

const smoke = spawnSync(smokeCmd[0], smokeCmd[1], {
  encoding: "utf8",
  env: {
    ...process.env,
    SCRCPY_SERVER_PATH: path.join(outDir, "scrcpy-server"),
    ADB: path.join(outDir, "adb"),
  },
});
if (smoke.status !== 0) {
  console.error("Bundled scrcpy failed --version:");
  console.error(smoke.stderr || smoke.stdout || `exit ${smoke.status}`);
  process.exit(1);
}
console.log((smoke.stdout || smoke.stderr).trim().split("\n")[0]);

const ffmpegSmokeCmd =
  arch === "x64" && process.arch !== "x64"
    ? ["arch", ["-x86_64", ffmpegOut, "-version"]]
    : [ffmpegOut, ["-version"]];
const ffmpegSmoke = spawnSync(ffmpegSmokeCmd[0], ffmpegSmokeCmd[1], {
  encoding: "utf8",
});
if (ffmpegSmoke.status !== 0) {
  console.error("Bundled ffmpeg failed -version:");
  console.error(
    ffmpegSmoke.stderr || ffmpegSmoke.stdout || `exit ${ffmpegSmoke.status}`
  );
  process.exit(1);
}
console.log((ffmpegSmoke.stdout || ffmpegSmoke.stderr).trim().split("\n")[0]);

// Convenience symlink/copy for packaging scripts that expect vendor/bin
const alias = path.join(root, "vendor", "bin");
fs.rmSync(alias, { recursive: true, force: true });
fs.cpSync(outDir, alias, { recursive: true });

fs.writeFileSync(
  path.join(outDir, "README.txt"),
  [
    "Bundled adb + portable scrcpy + ffmpeg (+ dylibs) for Mirrox.",
    "Generated by: npm run vendor",
    `Target arch: ${arch}`,
    `Host arch: ${process.arch}`,
    `scrcpy: ${scrcpyArchInfo}`,
    `ffmpeg: ${ffmpegArchInfo}`,
    "",
  ].join("\n")
);

console.log("Done:", outDir);
console.log("Also synced:", alias);
