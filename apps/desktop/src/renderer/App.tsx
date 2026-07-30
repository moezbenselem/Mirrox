import { useCallback, useEffect, useMemo, useState } from "react";
import FileTransfer from "./FileTransfer";
import DeviceInfoCard from "./DeviceInfoCard";
import NavBar from "./NavBar";
import Onboarding from "./Onboarding";
import WirelessPairModal from "./WirelessPairModal";
import UpdateBanner from "./UpdateBanner";
import logoUrl from "./assets/logo.png";

type DeviceState = "device" | "unauthorized" | "offline" | "unknown";
type QualityPreset = "low" | "medium" | "high";
type VideoSource = "display" | "camera";
type CameraFacing = "front" | "back";

interface DeviceInfo {
  serial: string;
  state: DeviceState;
  model?: string;
  product?: string;
  device?: string;
  mirroring?: boolean;
  fullscreen?: boolean;
  audio?: boolean;
  clipboardAutosync?: boolean;
  videoSource?: VideoSource;
  cameraFacing?: CameraFacing;
  recording?: boolean;
  connection?: "Cable" | "Wireless";
}

const MIRROR_SHORTCUTS = [
  { action: "screenshot", label: "Screenshot", accelerator: "CommandOrControl+Shift+S" },
  { action: "toggleRecord", label: "Record / Stop", accelerator: "CommandOrControl+Shift+R" },
] as const;

function formatAccelerator(accelerator: string): string {
  const isMac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
  if (isMac) {
    return accelerator
      .replace(/CommandOrControl/g, "⌘")
      .replace(/Shift/g, "⇧")
      .replace(/\+/g, "");
  }
  return accelerator.replace(/CommandOrControl/g, "Ctrl");
}

function MirrorShortcuts({ navBarEnabled }: { navBarEnabled: boolean }) {
  return (
    <div className="card mirror-shortcuts">
      <h3>Mirror shortcuts</h3>
      <p className="mirror-shortcuts-hint">
        Work while the scrcpy window is focused. Target is the selected mirroring device.
        Clipboard syncs Mac ↔ phone while mirroring (MOD+c / MOD+x / MOD+v in the mirror).
        Fullscreen: button here, MOD+f in the mirror, or Esc to exit. Rotate: MOD+r. Pinch zoom:
        Ctrl+drag.
      </p>
      <div className="shortcut-grid">
        {MIRROR_SHORTCUTS.map((s) => (
          <div className="shortcut-row" key={s.action}>
            <span className="shortcut-label">{s.label}</span>
            <kbd className="shortcut-key">{formatAccelerator(s.accelerator)}</kbd>
          </div>
        ))}
        <div className="shortcut-row">
          <span className="shortcut-label">Rotate</span>
          <kbd className="shortcut-key">MOD+r</kbd>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-label">Pinch zoom</span>
          <kbd className="shortcut-key">Ctrl+drag</kbd>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-label">Exit fullscreen</span>
          <kbd className="shortcut-key">Esc</kbd>
        </div>
      </div>
      {!navBarEnabled && (
        <p className="mirror-shortcuts-hint" style={{ marginTop: 8, marginBottom: 0 }}>
          Enable the optional nav bar in Quality for Back / Home / Recents without focusing scrcpy.
        </p>
      )}
    </div>
  );
}

function statusLabel(device: DeviceInfo): { text: string; className: string } {
  if (device.mirroring) return { text: "Mirroring", className: "mirroring" };
  if (device.state === "device") return { text: "Ready", className: "ready" };
  if (device.state === "unauthorized") return { text: "Unauthorized", className: "unauthorized" };
  return { text: device.state, className: "" };
}

export default function App() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityPreset>("medium");
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [keepScreenOn, setKeepScreenOn] = useState(true);
  const [navBarEnabled, setNavBarEnabled] = useState(false);
  const [screenshotCopyToClipboard, setScreenshotCopyToClipboard] = useState(false);
  const [wirelessHost, setWirelessHost] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [screenOn, setScreenOn] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [cameraEmptyHint, setCameraEmptyHint] = useState(false);
  const [update, setUpdate] = useState<{
    version: string;
    progress: number | null;
    downloading: boolean;
    ready: boolean;
  } | null>(null);
  const [preview, setPreview] = useState<{
    path: string;
    dataUrl: string;
    serial: string;
  } | null>(null);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.serial === selected) ?? null,
    [devices, selected]
  );

  const showToast = useCallback((kind: "ok" | "error" | "info", text: string) => {
    setToast({ kind, text });
  }, []);

  useEffect(() => {
    void window.mirrox.listDevices().then((list) => {
      setDevices(list);
      if (!selected && list[0]) setSelected(list[0].serial);
    });
    void window.mirrox.getSettings().then((s) => {
      setQuality(s.quality);
      setAlwaysOnTop(s.alwaysOnTop);
      setKeepScreenOn(s.keepScreenOn);
      setNavBarEnabled(s.navBarEnabled);
      setScreenshotCopyToClipboard(Boolean(s.screenshotCopyToClipboard));
      setShowOnboarding(!s.onboardingDismissed);
    });

    const offDevices = window.mirrox.onDevicesUpdated((list) => {
      setDevices(list);
      setSelected((prev) => {
        if (prev && list.some((d) => d.serial === prev)) return prev;
        return list[0]?.serial ?? null;
      });
    });
    const offAdb = window.mirrox.onAdbError((message) => showToast("error", message));
    const offMirrorErr = window.mirrox.onMirrorError(({ serial, error }) =>
      showToast("error", `${serial}: ${error}`)
    );
    const offMirrorExit = window.mirrox.onMirrorExit(({ serial }) =>
      showToast("info", `Mirror closed for ${serial}`)
    );
    const offClipboard = window.mirrox.onClipboardHint(() =>
      showToast("info", "Clipboard syncs with this device while mirroring.")
    );
    const offUpdateAvail = window.mirrox.onUpdateAvailable(({ version }) => {
      setUpdate({ version, progress: null, downloading: true, ready: false });
    });
    const offUpdateProg = window.mirrox.onUpdateProgress(({ percent }) => {
      setUpdate((prev) =>
        prev ? { ...prev, progress: percent, downloading: true, ready: false } : prev
      );
    });
    const offUpdateReady = window.mirrox.onUpdateReady(({ version }) => {
      setUpdate({ version, progress: 100, downloading: false, ready: true });
    });
    const offUpdateErr = window.mirrox.onUpdateError((message) =>
      showToast("error", `Update failed — ${message}. Download DMG from GitHub if needed.`)
    );
    const offMirrorShortcut = window.mirrox.onMirrorShortcut(
      ({ action, serial, error, payload }) => {
        if (error) {
          showToast("error", error);
          return;
        }
        if (action === "screenshot" && payload && typeof payload === "object") {
          const p = payload as {
            path?: string;
            dataUrl?: string;
            copiedToClipboard?: boolean;
          };
          if (p.path && p.dataUrl) {
            setPreview({ path: p.path, dataUrl: p.dataUrl, serial });
            if (p.copiedToClipboard) showToast("ok", "Screenshot copied to clipboard");
          }
          return;
        }
        if (action === "toggleRecord" && payload && typeof payload === "object") {
          const p = payload as {
            started?: boolean;
            saved?: boolean;
            path?: string;
          };
          if (p.started) showToast("ok", "Recording…");
          else if (p.saved && p.path) showToast("ok", `Saved ${p.path}`);
          else showToast("info", "Recording stopped");
        }
      }
    );

    return () => {
      offDevices();
      offAdb();
      offMirrorErr();
      offMirrorExit();
      offClipboard();
      offUpdateAvail();
      offUpdateProg();
      offUpdateReady();
      offUpdateErr();
      offMirrorShortcut();
    };
  }, [selected, showToast]);

  useEffect(() => {
    if (!selectedDevice?.mirroring) return;
    void window.mirrox.setShortcutTarget(selectedDevice.serial);
  }, [selectedDevice?.serial, selectedDevice?.mirroring]);

  useEffect(() => {
    if (!selectedDevice || selectedDevice.state !== "device") return;
    void window.mirrox.getDeviceScreen(selectedDevice.serial).then((s) => setScreenOn(s.on));
    void window.mirrox.getDemoMode(selectedDevice.serial).then((s) => setDemoMode(s.enabled));
  }, [selectedDevice?.serial, selectedDevice?.state]);

  const canControl = selectedDevice?.state === "device";
  const mirroring = Boolean(selectedDevice?.mirroring);
  const isFullscreen = Boolean(selectedDevice?.fullscreen);
  const recording = Boolean(selectedDevice?.recording);
  const audioOn = selectedDevice?.audio !== false;
  const clipboardOn = selectedDevice?.clipboardAutosync !== false;
  const videoSource = selectedDevice?.videoSource ?? "display";
  const cameraFacing = selectedDevice?.cameraFacing ?? "back";
  const hasReadyDevice = devices.some((d) => d.state === "device");
  const isWireless = selectedDevice?.connection === "Wireless" || /:\d+$/.test(selectedDevice?.serial ?? "");

  async function startMirror() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      await window.mirrox.startMirror(selectedDevice.serial);
      showToast(
        "ok",
        `Mirroring ${selectedDevice.model ?? selectedDevice.serial}${videoSource === "camera" ? " (camera)" : ""}`
      );
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stopMirror() {
    if (!selectedDevice) return;
    setBusy(true);
    try {
      await window.mirrox.stopMirror(selectedDevice.serial);
      showToast("info", "Mirror stopped");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function fullscreen() {
    if (!selectedDevice || !canControl || !mirroring) return;
    setBusy(true);
    try {
      const result = await window.mirrox.fullscreenMirror(selectedDevice.serial);
      showToast(
        "info",
        result.fullscreen ? "Fullscreen on — click again to exit" : "Exited fullscreen"
      );
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateQuality(next: QualityPreset) {
    setQuality(next);
    await window.mirrox.setSettings({ quality: next });
  }

  async function updateAlwaysOnTop(next: boolean) {
    setAlwaysOnTop(next);
    await window.mirrox.setSettings({ alwaysOnTop: next });
  }

  async function updateKeepScreenOn(next: boolean) {
    setKeepScreenOn(next);
    await window.mirrox.setSettings({ keepScreenOn: next });
  }

  async function updateNavBar(next: boolean) {
    setNavBarEnabled(next);
    await window.mirrox.setSettings({ navBarEnabled: next });
  }

  async function enableWireless() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      const result = await window.mirrox.enableWireless(selectedDevice.serial);
      if (result.hint) {
        setWirelessHost(result.hint);
        showToast("ok", `TCP/IP enabled. Unplug USB, then Connect ${result.hint}`);
      } else {
        showToast("info", "TCP/IP mode enabled on port 5555. Enter device IP:5555 below.");
      }
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function connectWireless() {
    if (!wirelessHost.trim()) return;
    setBusy(true);
    try {
      const { result } = await window.mirrox.connectWireless(wirelessHost.trim());
      showToast("ok", result || `Connected to ${wirelessHost}`);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnectWireless() {
    if (!selectedDevice || !isWireless) return;
    setBusy(true);
    try {
      await window.mirrox.disconnectWireless(selectedDevice.serial);
      showToast("info", "Disconnected wireless device");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function screenshot() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      const result = await window.mirrox.takeScreenshot(selectedDevice.serial);
      if (result.ok && result.path && result.dataUrl) {
        setPreview({
          path: result.path,
          dataUrl: result.dataUrl,
          serial: selectedDevice.serial,
        });
        if (result.copiedToClipboard) {
          showToast("ok", "Screenshot copied to clipboard");
        }
      }
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function setScreenshotClipboardDefault(next: boolean) {
    setScreenshotCopyToClipboard(next);
    await window.mirrox.setSettings({ screenshotCopyToClipboard: next });
  }

  async function toggleRecord() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      if (recording) {
        const result = await window.mirrox.stopRecording(selectedDevice.serial);
        showToast(
          result.saved ? "ok" : "info",
          result.saved ? `Saved ${result.path}` : "Recording stopped"
        );
      } else {
        await window.mirrox.startRecording(selectedDevice.serial);
        showToast("ok", "Recording…");
      }
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleAudio() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      await window.mirrox.setDeviceAudio(selectedDevice.serial, !audioOn);
      showToast("ok", !audioOn ? "Audio mirroring on" : "Audio mirroring off");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleClipboard() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      await window.mirrox.setDeviceClipboard(selectedDevice.serial, !clipboardOn);
      showToast("ok", !clipboardOn ? "Clipboard sync on" : "Clipboard sync off");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function setSource(next: VideoSource) {
    if (!selectedDevice || !canControl) return;
    if (mirroring && videoSource !== next) {
      const ok = window.confirm(
        next === "camera"
          ? "Switch to camera preview? The mirror will restart."
          : "Switch back to screen mirror? The mirror will restart."
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await window.mirrox.setVideoSource(selectedDevice.serial, next);
      if (next === "camera") {
        const listed = await window.mirrox.listCameras(selectedDevice.serial);
        setCameras(listed.cameras);
        setCameraEmptyHint(listed.cameras.length === 0);
        if (listed.cameras.length === 0) {
          showToast(
            "info",
            "No cameras reported — open the Camera app once on the phone and retry."
          );
        }
      } else {
        setCameraEmptyHint(false);
      }
      showToast("ok", next === "camera" ? "Camera preview mode" : "Screen mirror mode");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function setFacing(facing: CameraFacing) {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      await window.mirrox.setCameraFacing(selectedDevice.serial, facing);
      showToast("ok", facing === "front" ? "Front camera" : "Back camera");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshCameras() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      const listed = await window.mirrox.listCameras(selectedDevice.serial);
      setCameras(listed.cameras);
      setCameraEmptyHint(listed.cameras.length === 0);
      if (listed.cameras.length === 0) {
        showToast(
          "info",
          "No cameras reported — open the Camera app once on the phone and retry."
        );
      } else {
        showToast("ok", `${listed.cameras.length} camera(s) found`);
      }
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleScreen() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      const next = !screenOn;
      await window.mirrox.setDeviceScreen(selectedDevice.serial, next);
      setScreenOn(next);
      showToast("ok", next ? "Device screen on" : "Device screen off");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDemoMode() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      const next = !demoMode;
      await window.mirrox.setDemoMode(selectedDevice.serial, next);
      setDemoMode(next);
      showToast("ok", next ? "Demo mode on" : "Demo mode off");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePreview() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await window.mirrox.saveScreenshot(preview.path, preview.serial);
      if (result.ok && result.path) showToast("ok", `Saved ${result.path}`);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyPreview() {
    if (!preview) return;
    setBusy(true);
    try {
      await window.mirrox.copyScreenshot(preview.path);
      showToast("ok", "Copied to clipboard");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function closePreview() {
    if (preview) void window.mirrox.discardScreenshot(preview.path);
    setPreview(null);
  }

  async function dismissOnboarding(permanent: boolean) {
    setShowOnboarding(false);
    if (permanent) {
      await window.mirrox.setSettings({ onboardingDismissed: true });
    }
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="" draggable={false} />
          <h1>Mirrox</h1>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setPairOpen(true)} disabled={busy}>
            Pair
          </button>
          <button className="btn" onClick={() => void window.mirrox.listDevices()} disabled={busy}>
            Refresh
          </button>
        </div>
      </header>

      {update && (
        <UpdateBanner
          version={update.version}
          progress={update.progress}
          downloading={update.downloading}
          ready={update.ready}
          onInstall={() => void window.mirrox.installUpdate()}
          onDismiss={() => {
            void window.mirrox.setSettings({
              updateBannerDismissedVersion: update.version,
            });
            setUpdate(null);
          }}
        />
      )}

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Android Devices</h2>
            <p>{devices.length} connected</p>
          </div>
          <div className="device-list">
            {devices.length === 0 ? (
              <div className="empty">
                <h3>No devices found</h3>
                <p>
                  Connect with a data cable and enable USB debugging, or{" "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => setPairOpen(true)}
                  >
                    pair wirelessly
                  </button>
                  .
                </p>
              </div>
            ) : (
              devices.map((device) => {
                const status = statusLabel(device);
                return (
                  <button
                    key={device.serial}
                    className={`device-card ${selected === device.serial ? "active" : ""}`}
                    onClick={() => setSelected(device.serial)}
                  >
                    <div className="device-top">
                      <img className="device-icon" src={logoUrl} alt="" draggable={false} />
                      <div className="device-meta">
                        <div className="device-name">
                          {device.model ?? device.product ?? "Android"}
                        </div>
                        <div className="device-serial">{device.serial}</div>
                      </div>
                      <span className={`status-pill ${status.className}`}>{status.text}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="main">
          <div className="panel">
            {!selectedDevice ? (
              <div className="hero">
                <img className="hero-logo" src={logoUrl} alt="Mirrox" draggable={false} />
                <h2>Put your phone on your desktop</h2>
                <p>
                  Mirror and control Android over USB or Wi‑Fi. The mirror uses a native system
                  window — move and resize it normally.
                </p>
              </div>
            ) : (
              <>
                <div className="hero">
                  <h2>{selectedDevice.model ?? "Android device"}</h2>
                  <p>
                    {selectedDevice.state === "unauthorized"
                      ? "Unauthorized — unlock the phone and allow USB debugging."
                      : mirroring
                        ? `Native mirror window is open${videoSource === "camera" ? " (camera)" : ""}. Shortcuts: ${formatAccelerator("CommandOrControl+Shift+S")} screenshot, ${formatAccelerator("CommandOrControl+Shift+R")} record.`
                        : "Ready to mirror. Click View to open a native scrcpy window."}
                  </p>
                </div>

                {canControl && (
                  <DeviceInfoCard
                    serial={selectedDevice.serial}
                    state={selectedDevice.state}
                    disabled={busy}
                  />
                )}

                <div className="toolbar">
                  {mirroring ? (
                    <button className="btn danger" disabled={busy} onClick={() => void stopMirror()}>
                      Stop
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      disabled={!canControl || busy}
                      onClick={() => void startMirror()}
                    >
                      View
                    </button>
                  )}
                  {canControl && (
                    <div className="segmented" role="group" aria-label="Mirror source">
                      <button
                        type="button"
                        className={`seg ${videoSource === "display" ? "active" : ""}`}
                        disabled={busy}
                        onClick={() => void setSource("display")}
                      >
                        Screen
                      </button>
                      <button
                        type="button"
                        className={`seg ${videoSource === "camera" ? "active" : ""}`}
                        disabled={busy}
                        onClick={() => void setSource("camera")}
                      >
                        Camera
                      </button>
                    </div>
                  )}
                  <button
                    className="btn"
                    disabled={!canControl || busy}
                    onClick={() => void enableWireless()}
                  >
                    Go Wireless
                  </button>
                  {isWireless && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => void disconnectWireless()}
                    >
                      Disconnect
                    </button>
                  )}
                </div>

                {canControl && videoSource === "camera" && (
                  <div className="card">
                    <h3>Camera</h3>
                    <div className="row">
                      <span className="label">Facing</span>
                      <button
                        className={`btn ${cameraFacing === "back" ? "active-toggle" : ""}`}
                        disabled={busy}
                        onClick={() => void setFacing("back")}
                      >
                        Back
                      </button>
                      <button
                        className={`btn ${cameraFacing === "front" ? "active-toggle" : ""}`}
                        disabled={busy}
                        onClick={() => void setFacing("front")}
                      >
                        Front
                      </button>
                      <button className="btn" disabled={busy} onClick={() => void refreshCameras()}>
                        List cameras
                      </button>
                    </div>
                    {cameraEmptyHint && (
                      <p className="mirror-shortcuts-hint" style={{ margin: 0 }}>
                        No cameras reported — open the Camera app once on the phone and retry.
                      </p>
                    )}
                    {cameras.length > 0 && (
                      <div className="row">
                        <span className="label">Camera id</span>
                        <select
                          disabled={busy}
                          defaultValue=""
                          onChange={(e) => {
                            const id = e.target.value || null;
                            void window.mirrox.setCameraId(selectedDevice.serial, id);
                          }}
                        >
                          <option value="">Auto (facing)</option>
                          {cameras.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.id}: {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {canControl && navBarEnabled && (
                  <NavBar serial={selectedDevice.serial} disabled={busy} onToast={showToast} />
                )}

                {canControl && (
                  <div className="card">
                    <h3>Quick actions</h3>
                    <div className="quick-actions">
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void screenshot()}
                        title={`Screenshot (${formatAccelerator("CommandOrControl+Shift+S")})`}
                      >
                        Screenshot
                      </button>
                      <button
                        className={`btn ${recording ? "danger" : ""}`}
                        disabled={busy}
                        onClick={() => void toggleRecord()}
                        title={`Record (${formatAccelerator("CommandOrControl+Shift+R")})`}
                      >
                        {recording ? "Stop record" : "Record"}
                      </button>
                      <button
                        className={`btn ${audioOn ? "active-toggle" : ""}`}
                        disabled={busy}
                        onClick={() => void toggleAudio()}
                        title="Audio mirroring"
                      >
                        Audio {audioOn ? "on" : "off"}
                      </button>
                      <button
                        className={`btn ${clipboardOn ? "active-toggle" : ""}`}
                        disabled={busy}
                        onClick={() => void toggleClipboard()}
                        title="Clipboard sync Mac ↔ phone"
                      >
                        Clipboard {clipboardOn ? "on" : "off"}
                      </button>
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void toggleScreen()}
                        title="Device screen on/off"
                      >
                        Screen {screenOn ? "off" : "on"}
                      </button>
                      <button
                        className={`btn ${demoMode ? "active-toggle" : ""}`}
                        disabled={busy}
                        onClick={() => void toggleDemoMode()}
                        title="System UI Demo Mode — clean status bar for screenshots"
                      >
                        Demo {demoMode ? "on" : "off"}
                      </button>
                      <button
                        className={`btn ${isFullscreen ? "active-toggle" : ""}`}
                        disabled={!mirroring || busy}
                        onClick={() => void fullscreen()}
                        title={
                          isFullscreen
                            ? "Exit fullscreen (Esc)"
                            : "Fullscreen mirror (Esc to exit)"
                        }
                      >
                        {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                      </button>
                    </div>
                  </div>
                )}

                {canControl && mirroring && <MirrorShortcuts navBarEnabled={navBarEnabled} />}

                <div className="card">
                  <h3>Quality</h3>
                  <div className="row">
                    <span className="label">Bitrate</span>
                    <select
                      value={quality}
                      onChange={(e) => void updateQuality(e.target.value as QualityPreset)}
                    >
                      <option value="low">Low (2 Mbps)</option>
                      <option value="medium">Medium (8 Mbps)</option>
                      <option value="high">High (16 Mbps)</option>
                    </select>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={alwaysOnTop}
                        onChange={(e) => void updateAlwaysOnTop(e.target.checked)}
                      />
                      Always on top
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={keepScreenOn}
                        onChange={(e) => void updateKeepScreenOn(e.target.checked)}
                      />
                      Keep screen on
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={navBarEnabled}
                        onChange={(e) => void updateNavBar(e.target.checked)}
                      />
                      Nav bar
                    </label>
                  </div>
                </div>

                <div className="card">
                  <h3>Wireless ADB</h3>
                  <div className="row">
                    <span className="label">Host:port</span>
                    <input
                      type="text"
                      placeholder="192.168.1.20:5555"
                      value={wirelessHost}
                      onChange={(e) => setWirelessHost(e.target.value)}
                    />
                    <button className="btn" disabled={busy} onClick={() => void connectWireless()}>
                      Connect
                    </button>
                    <button className="btn" disabled={busy} onClick={() => setPairOpen(true)}>
                      Pair with code…
                    </button>
                  </div>
                </div>

                {canControl && (
                  <FileTransfer serial={selectedDevice.serial} disabled={busy} onToast={showToast} />
                )}
              </>
            )}

            {toast && (
              <div
                className={`toast ${toast.kind === "error" ? "error" : toast.kind === "ok" ? "ok" : ""}`}
              >
                {toast.text}
              </div>
            )}
          </div>
        </main>
      </div>

      {showOnboarding && (
        <Onboarding
          hasReadyDevice={hasReadyDevice}
          onSkip={() => void dismissOnboarding(false)}
          onDontShowAgain={() => void dismissOnboarding(true)}
          onOpenWirelessPair={() => setPairOpen(true)}
        />
      )}

      <WirelessPairModal
        open={pairOpen}
        busy={busy}
        onClose={() => setPairOpen(false)}
        onToast={showToast}
      />

      {preview && (
        <div className="modal-backdrop" onClick={() => void closePreview()}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Screenshot preview"
          >
            <div className="modal-header">
              <h3>Screenshot</h3>
              <button className="btn" onClick={() => void closePreview()} disabled={busy}>
                Close
              </button>
            </div>
            <div className="modal-preview">
              <img src={preview.dataUrl} alt="Screenshot preview" />
            </div>
            <div className="modal-actions">
              <button className="btn primary" disabled={busy} onClick={() => void savePreview()}>
                Save…
              </button>
              <button className="btn" disabled={busy} onClick={() => void copyPreview()}>
                Copy to clipboard
              </button>
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={screenshotCopyToClipboard}
                  disabled={busy}
                  onChange={(e) => void setScreenshotClipboardDefault(e.target.checked)}
                />
                Always copy to clipboard
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
