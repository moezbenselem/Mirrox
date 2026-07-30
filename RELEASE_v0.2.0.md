# Mirrox v0.2.0

**Mirrox** is a macOS desktop app for mirroring and controlling Android phones over USB or Wi‑Fi. Connect a device, open a native mirror window, and control it with mouse and keyboard — plus files, screenshots, recording, camera preview, and wireless ADB — without terminal commands.

Bundled tools ship inside the DMG (Apple Silicon & Intel). End users do not need Homebrew.

---

## What’s included

### Mirroring & control

- Live screen mirror with mouse and keyboard control (one window per device)
- Multi-device sessions (USB and wireless)
- Quality presets: Low / Medium / High
- Always-on-top mirror window
- Keep screen on during sessions
- Fullscreen (button, `MOD+f`, `Esc` to exit)
- Optional audio mirroring per device
- Mac ↔ phone clipboard sync while mirroring
- Optional nav bar: Back / Home / Recents / Notifications
- Wake / sleep the physical display
- Pinch zoom (`Ctrl+drag`) and rotate (`MOD+r`)

### Camera

- Switch mirror source between display and camera
- Front / back facing, camera id picker
- Orientation: 0° / 90° / 180° / 270°
- Photo capture and video recording from the camera stream

### Capture & media frames

- Screenshots with preview → save or copy to clipboard
- Optional “always copy to clipboard”
- On-device screen recording with save/discard flow
- Pixel bezel frames (Obsidian, Porcelain, Hazel, Pro) + custom PNG/JPEG (green `#00FF00` placeholder)
- Fit media to frame or frame to media; apply on screenshots and recordings
- Shortcuts while the mirror is focused:
  - **⌘⇧S** — screenshot / photo
  - **⌘⇧R** — record / stop

### Devices & wireless

- USB + wireless ADB discovery
- One-click Go Wireless (`tcpip` + connect hint)
- Wireless debugging pair (Android 11+: pair code + connect)
- Disconnect wireless sessions
- First-run USB debugging onboarding

### Device info

- Model, Android version, battery, IP, storage, cable/wireless
- Display size
- Live phone-bezel screen preview (periodic refresh)

### Files & APK

- Browse storage with shortcuts (Internal, Download, DCIM, Pictures, Documents)
- Upload files/folders, download, delete, rename, duplicate, mkdir
- Multi-select, filter, drag-and-drop upload, cancelable progress
- Preview images/text; Get Info for other types (download / open externally)
- Install APK via drop or upload

### Polish & updates

- System UI Demo Mode (clean status bar for screenshots)
- About dialog with version + GitHub stars/forks
- In-app updates from GitHub Releases
- Persistent settings (quality, frames, onboarding, clipboard defaults, etc.)

---

## Requirements

- macOS (Apple Silicon or Intel)
- Android device with USB debugging enabled
- Wireless: same LAN after the initial USB handshake

---

## Downloads

| Arch | Artifact |
| --- | --- |
| Apple Silicon | `Mirrox-0.2.0-arm64.dmg` |
| Intel | `Mirrox-0.2.0.dmg` |

---

## Notes

- Prefer a data USB cable; accept the RSA debugging prompt on first connect.
- Demo Mode works best on stock AOSP/Pixel; some OEM skins ignore it.
- Builds may be unsigned; open via System Settings → Privacy & Security if Gatekeeper blocks the first launch.

---

## Credits

- Android platform-tools (adb)
- Electron + React
