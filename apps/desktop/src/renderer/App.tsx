import { useCallback, useEffect, useMemo, useState } from "react";
import FileTransfer from "./FileTransfer";

type DeviceState = "device" | "unauthorized" | "offline" | "unknown";
type QualityPreset = "low" | "medium" | "high";

interface DeviceInfo {
  serial: string;
  state: DeviceState;
  model?: string;
  product?: string;
  device?: string;
  mirroring?: boolean;
  audio?: boolean;
  recording?: boolean;
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

function MirrorShortcuts() {
  return (
    <div className="card mirror-shortcuts">
      <h3>Mirror shortcuts</h3>
      <p className="mirror-shortcuts-hint">
        Work while the scrcpy window is focused. Target is the selected mirroring device.
      </p>
      <div className="shortcut-grid">
        {MIRROR_SHORTCUTS.map((s) => (
          <div className="shortcut-row" key={s.action}>
            <span className="shortcut-label">{s.label}</span>
            <kbd className="shortcut-key">{formatAccelerator(s.accelerator)}</kbd>
          </div>
        ))}
      </div>
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
  const [wirelessHost, setWirelessHost] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [screenOn, setScreenOn] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
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
    void window.vysor.listDevices().then((list) => {
      setDevices(list);
      if (!selected && list[0]) setSelected(list[0].serial);
    });
    void window.vysor.getSettings().then((s) => {
      setQuality(s.quality);
      setAlwaysOnTop(s.alwaysOnTop);
      setKeepScreenOn(s.keepScreenOn);
    });

    const offDevices = window.vysor.onDevicesUpdated((list) => {
      setDevices(list);
      setSelected((prev) => {
        if (prev && list.some((d) => d.serial === prev)) return prev;
        return list[0]?.serial ?? null;
      });
    });
    const offAdb = window.vysor.onAdbError((message) => showToast("error", message));
    const offMirrorErr = window.vysor.onMirrorError(({ serial, error }) =>
      showToast("error", `${serial}: ${error}`)
    );
    const offMirrorExit = window.vysor.onMirrorExit(({ serial }) =>
      showToast("info", `Mirror closed for ${serial}`)
    );
    const offMirrorShortcut = window.vysor.onMirrorShortcut(
      ({ action, serial, error, payload }) => {
        if (error) {
          showToast("error", error);
          return;
        }
        if (action === "screenshot" && payload && typeof payload === "object") {
          const p = payload as { path?: string; dataUrl?: string };
          if (p.path && p.dataUrl) {
            setPreview({ path: p.path, dataUrl: p.dataUrl, serial });
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
      offMirrorShortcut();
    };
  }, [selected, showToast]);

  useEffect(() => {
    if (!selectedDevice?.mirroring) return;
    void window.vysor.setShortcutTarget(selectedDevice.serial);
  }, [selectedDevice?.serial, selectedDevice?.mirroring]);

  useEffect(() => {
    if (!selectedDevice || selectedDevice.state !== "device") return;
    void window.vysor.getDeviceScreen(selectedDevice.serial).then((s) => setScreenOn(s.on));
    void window.vysor.getDemoMode(selectedDevice.serial).then((s) => setDemoMode(s.enabled));
  }, [selectedDevice?.serial, selectedDevice?.state]);

  const canControl = selectedDevice?.state === "device";
  const mirroring = Boolean(selectedDevice?.mirroring);
  const recording = Boolean(selectedDevice?.recording);
  const audioOn = selectedDevice?.audio !== false;

  async function startMirror() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      await window.vysor.startMirror(selectedDevice.serial);
      showToast("ok", `Mirroring ${selectedDevice.model ?? selectedDevice.serial}`);
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
      await window.vysor.stopMirror(selectedDevice.serial);
      showToast("info", "Mirror stopped");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function fullscreen() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      await window.vysor.fullscreenMirror(selectedDevice.serial);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateQuality(next: QualityPreset) {
    setQuality(next);
    await window.vysor.setSettings({ quality: next });
  }

  async function updateAlwaysOnTop(next: boolean) {
    setAlwaysOnTop(next);
    await window.vysor.setSettings({ alwaysOnTop: next });
  }

  async function updateKeepScreenOn(next: boolean) {
    setKeepScreenOn(next);
    await window.vysor.setSettings({ keepScreenOn: next });
  }

  async function enableWireless() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      const result = await window.vysor.enableWireless(selectedDevice.serial);
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
      const { result } = await window.vysor.connectWireless(wirelessHost.trim());
      showToast("ok", result || `Connected to ${wirelessHost}`);
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
      const result = await window.vysor.takeScreenshot(selectedDevice.serial);
      if (result.ok && result.path && result.dataUrl) {
        setPreview({
          path: result.path,
          dataUrl: result.dataUrl,
          serial: selectedDevice.serial,
        });
      }
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecord() {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      if (recording) {
        const result = await window.vysor.stopRecording(selectedDevice.serial);
        showToast(
          result.saved ? "ok" : "info",
          result.saved ? `Saved ${result.path}` : "Recording stopped"
        );
      } else {
        await window.vysor.startRecording(selectedDevice.serial);
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
      await window.vysor.setDeviceAudio(selectedDevice.serial, !audioOn);
      showToast("ok", !audioOn ? "Audio mirroring on" : "Audio mirroring off");
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
      await window.vysor.setDeviceScreen(selectedDevice.serial, next);
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
      await window.vysor.setDemoMode(selectedDevice.serial, next);
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
      const result = await window.vysor.saveScreenshot(preview.path, preview.serial);
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
      await window.vysor.copyScreenshot(preview.path);
      showToast("ok", "Copied to clipboard");
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function closePreview() {
    if (preview) void window.vysor.discardScreenshot(preview.path);
    setPreview(null);
  }

  return (
    <div className="app">
      <header className="titlebar">
        <h1>Mirrox</h1>
        <div className="actions">
          <button className="btn" onClick={() => void window.vysor.listDevices()} disabled={busy}>
            Refresh
          </button>
        </div>
      </header>

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
                  Connect with a data cable and enable USB debugging. Accept the RSA prompt on the
                  phone.
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
                      <div className="device-icon" />
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
                        ? `Native mirror window is open. Shortcuts: ${formatAccelerator("CommandOrControl+Shift+S")} screenshot, ${formatAccelerator("CommandOrControl+Shift+R")} record.`
                        : "Ready to mirror. Click View to open a native scrcpy window."}
                  </p>
                </div>

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
                  <button
                    className="btn"
                    disabled={!canControl || busy}
                    onClick={() => void enableWireless()}
                  >
                    Go Wireless
                  </button>
                </div>

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
                        className="btn"
                        disabled={!mirroring || busy}
                        onClick={() => void fullscreen()}
                        title="Fullscreen mirror"
                      >
                        Fullscreen
                      </button>
                    </div>
                  </div>
                )}

                {canControl && mirroring && <MirrorShortcuts />}

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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
