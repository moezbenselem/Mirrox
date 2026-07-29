# Mirrox

**Mirrox** is a macOS desktop app for mirroring and controlling Android phones over USB or Wi‑Fi. It wraps **ADB** and **scrcpy** in a focused Electron UI so you can view, click, type, transfer files, capture screenshots, and record — without juggling terminal commands.

Current version: **1.1.0**

---

## Why Mirrox

- Native scrcpy windows (low latency, multi-device)
- Device manager UI for quality, wireless ADB, and quick actions
- Bundled `adb` / `scrcpy` in the DMG — end users do not need Homebrew
- Practical extras: file browser, APK install, System UI Demo Mode, mirror shortcuts

---

## Features

| Area | What you get |
| --- | --- |
| **Mirror** | Live screen with mouse & keyboard control via scrcpy |
| **Devices** | USB + wireless ADB discovery, multi-device sessions |
| **Quality** | Low / Medium / High bitrate presets |
| **Window** | Always-on-top, keep screen on, fullscreen |
| **Capture** | Screenshots (preview, save, clipboard) |
| **Record** | On-device screenrecord with save dialog |
| **Wireless** | One-click `adb tcpip` + host:port connect |
| **Files** | Browse device storage, upload/download, mkdir, rename, duplicate, delete |
| **APK** | Drop or upload an `.apk` to install |
| **Audio** | Toggle audio mirroring per device |
| **Screen** | Wake / sleep the physical display while mirroring |
| **Demo mode** | Android System UI Demo Mode (clean status bar for screenshots) |
| **Shortcuts** | Global hotkeys while the scrcpy window is focused |

### Mirror shortcuts

| Action | Shortcut (macOS) |
| --- | --- |
| Screenshot | ⌘⇧S |
| Start / stop recording | ⌘⇧R |

---

## Screenshots & packaging

After packaging:

| Arch | Artifact |
| --- | --- |
| Apple Silicon | `apps/desktop/release/Mirrox-1.1.0-arm64.dmg` |
| Intel | `apps/desktop/release/Mirrox-1.1.0.dmg` |

Each DMG embeds matching-architecture `adb`, `scrcpy`, `scrcpy-server`, and required dylibs.

---

## Requirements

### Running a release build

- macOS (Apple Silicon or Intel)
- An Android device with **USB debugging** enabled
- For wireless: same LAN as the Mac after the initial USB handshake

### Developing / packaging

- macOS
- **Node.js 20+**
- Homebrew tools on the **build machine only**:

```bash
brew install scrcpy dylibbundler
```

End users of the DMG do **not** need Homebrew or a system-wide scrcpy install.

For Intel DMGs on an Apple Silicon Mac, Mirrox expects Homebrew **sonoma (x86_64)** bottles under `vendor/staging-x64/` (fetched once; see packaging below).

---

## Quick start (development)

```bash
git clone https://github.com/<you>/mirrox.git
cd mirrox
npm install
brew install scrcpy dylibbundler   # build machine
npm run vendor                     # host arch → vendor/bin
npm run dev
```

On first USB connect, unlock the phone and accept the RSA debugging prompt.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Build packages + start Electron in dev mode |
| `npm run build` | Production build of packages + desktop app |
| `npm run vendor` | Vendor adb/scrcpy for the host architecture |
| `npm run vendor:arm64` | Vendor Apple Silicon binaries |
| `npm run vendor:x64` | Vendor Intel binaries from `vendor/staging-x64` |
| `npm run package:dmg` | Build Apple Silicon DMG |
| `npm run package:intel` | Build Intel DMG |
| `npm run package:all` | Build both DMGs |

---

## Architecture

npm workspaces monorepo:

```
mirrox/
├── apps/desktop/          Electron app (main / preload / React renderer)
├── packages/adb/          ADB client wrapper (devices, shell, fs, install…)
├── packages/mirror/       scrcpy session manager
├── scripts/               vendor-binaries.mjs
└── vendor/                generated binaries (gitignored)
```

### Process layout

1. **Main process** — ADB watchers, scrcpy spawn/restart, IPC, screenshots/recording, global shortcuts  
2. **Preload** — `contextBridge` API (`window.vysor`)  
3. **Renderer** — React device manager, settings, file transfer UI  
4. **Native mirror** — one scrcpy window per device serial

### Packages

- **`@vysor/adb`** — `AdbClient`: device list, wireless, screencap, stay-awake, demo mode, filesystem helpers  
- **`@vysor/mirror`** — `MirrorManager`: quality presets, audio, always-on-top, restart on setting changes  

Internal package scope remains `@vysor/*`; the product name is **Mirrox** (`com.mirrox.app`).

---

## Packaging notes

### Apple Silicon

```bash
npm run package:dmg
```

Uses Homebrew arm64 `scrcpy` and bundles dylibs with `dylibbundler`.

### Intel (from Apple Silicon)

1. Ensure x64 bottles exist under `vendor/staging-x64/bottles/` (Homebrew sonoma bottles for `scrcpy` + deps).  
2. `npm run vendor:x64` extracts them into `cellar/` if needed, relocates install names, and bundles a portable x86_64 scrcpy.  
3. `npm run package:intel`

Or build both:

```bash
npm run package:all
```

Code signing is currently disabled (`identity: null`) for local/distribution builds. Enable notarization before wide public distribution.

---

## Device tips

- Prefer a **data** USB cable (charge-only cables will not appear in ADB).  
- **Unauthorized** → unlock phone → allow USB debugging.  
- **Go Wireless** enables TCP/IP on port `5555`, then disconnect USB and Connect with `IP:5555`.  
- **Demo mode** uses Android System UI Demo Mode broadcasts. Stock AOSP/Pixel usually work; some OEM skins ignore it.  
- **Keep screen on** combines stay-awake settings; useful for long mirror sessions.

---

## Troubleshooting

| Symptom | Things to try |
| --- | --- |
| No devices | Cable, USB debugging, `adb devices`, accept RSA prompt |
| Mirror fails to start | Re-run `npm run vendor`, check scrcpy in `vendor/bin`, reboot adb (`adb kill-server`) |
| Black / frozen mirror | Wake device, toggle quality, stop/start View |
| Wireless connect fails | Same Wi‑Fi, firewall, `IP:5555`, re-run Go Wireless over USB |
| Intel package fails | Populate `vendor/staging-x64/bottles` or set `SCRCPY_PATH` to an x86_64 scrcpy |
| Demo mode no effect | OEM SystemUI; try Pixel/AOSP or ignore for that device |

---

## License

Private / unpublished unless you add a license file. scrcpy and ADB remain under their upstream licenses; redistribute binaries accordingly.

---

## Credits

- [scrcpy](https://github.com/Genymobile/scrcpy) — Genymobile  
- [Android platform-tools (adb)](https://developer.android.com/tools/releases/platform-tools)  
- Electron + React
