import { useCallback, useEffect, useMemo, useState } from "react";
import AboutModal from "./AboutModal";
import FileTransfer from "./FileTransfer";
import DeviceInfoCard from "./DeviceInfoCard";
import NavBar from "./NavBar";
import Onboarding from "./Onboarding";
import WirelessPairModal from "./WirelessPairModal";
import UpdateBanner from "./UpdateBanner";
import logoUrl from "./assets/logo.png";

const GITHUB_REPO_URL = "https://github.com/moezbenselem/Mirrox";
const GITHUB_RELEASES_URL = "https://github.com/moezbenselem/Mirrox/releases";

type DeviceState = "device" | "unauthorized" | "offline" | "unknown";
type QualityPreset = "low" | "medium" | "high";
type VideoSource = "display" | "camera";
type CameraFacing = "front" | "back";
type OrientationDegrees = 0 | 90 | 180 | 270;

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
  orientation?: OrientationDegrees;
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

function MediaFrameControls({
  applyFrame,
  onApplyChange,
  fitMode,
  onFitModeChange,
  frameId,
  frameDataUrl,
  builtins,
  busy,
  onSelectBuiltin,
  onPick,
  onClear,
}: {
  applyFrame: boolean;
  onApplyChange: (next: boolean) => void;
  fitMode: "media-to-frame" | "frame-to-media";
  onFitModeChange: (next: "media-to-frame" | "frame-to-media") => void;
  frameId: string | null;
  frameDataUrl: string | null;
  builtins: Array<{ id: string; name: string; dataUrl: string }>;
  busy: boolean;
  onSelectBuiltin: (id: string) => void;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="frame-options">
      <label className="modal-check frame-check">
        <input
          type="checkbox"
          checked={applyFrame}
          disabled={busy}
          onChange={(e) => onApplyChange(e.target.checked)}
        />
        Apply frame
      </label>
      {applyFrame && (
        <div className="frame-picker">
          {builtins.length > 0 && (
            <div className="frame-builtin-row" role="listbox" aria-label="Pixel frames">
              {builtins.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`frame-builtin${frameId === f.id ? " selected" : ""}`}
                  disabled={busy}
                  title={f.name}
                  aria-label={f.name}
                  aria-selected={frameId === f.id}
                  onClick={() => onSelectBuiltin(f.id)}
                >
                  <img src={f.dataUrl} alt="" className="frame-builtin-img" draggable={false} />
                  <span className="frame-builtin-label">{f.name.replace(/^Pixel · /, "")}</span>
                </button>
              ))}
            </div>
          )}
          <div className="frame-fit-modes" role="radiogroup" aria-label="Frame fit mode">
            <label className="frame-fit-option">
              <input
                type="radio"
                name="frame-fit"
                checked={fitMode === "media-to-frame"}
                disabled={busy}
                onChange={() => onFitModeChange("media-to-frame")}
              />
              Fit media to frame
            </label>
            <label className="frame-fit-option">
              <input
                type="radio"
                name="frame-fit"
                checked={fitMode === "frame-to-media"}
                disabled={busy}
                onChange={() => onFitModeChange("frame-to-media")}
              />
              Fit frame to media
            </label>
          </div>
          <div className="frame-custom-row">
            {frameId === "custom" && frameDataUrl ? (
              <img src={frameDataUrl} alt="Custom frame" className="frame-thumb" />
            ) : (
              <span className="frame-hint">
                Or upload a PNG/JPEG with a green (#00FF00) placeholder
              </span>
            )}
            <div className="frame-picker-actions">
              <button className="btn" type="button" disabled={busy} onClick={onPick}>
                {frameId === "custom" && frameDataUrl ? "Change…" : "Upload…"}
              </button>
              {frameId && (
                <button className="btn" type="button" disabled={busy} onClick={onClear}>
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MirrorShortcuts({ navBarEnabled }: { navBarEnabled: boolean }) {
  return (
    <div className="card mirror-shortcuts">
      <h3>Mirror shortcuts</h3>
      <p className="mirror-shortcuts-hint">
        Work while the mirror window is focused. Target is the selected mirroring device.
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
          Enable the optional nav bar in Quality for Back / Home / Recents without focusing the mirror.
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
  const [applyFrame, setApplyFrame] = useState(false);
  const [frameFitMode, setFrameFitMode] = useState<"media-to-frame" | "frame-to-media">(
    "media-to-frame"
  );
  const [frameId, setFrameId] = useState<string | null>(null);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [builtinFrames, setBuiltinFrames] = useState<
    Array<{ id: string; name: string; dataUrl: string }>
  >([]);
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
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [githubStats, setGithubStats] = useState<{
    stars: number;
    forks: number;
    url: string;
    fullName: string;
  } | null>(null);
  const [githubStatsLoading, setGithubStatsLoading] = useState(false);
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
  const [recordingSave, setRecordingSave] = useState<{
    path: string;
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
      setApplyFrame(Boolean(s.mediaFrameApplyDefault));
      setFrameFitMode(
        s.mediaFrameFitMode === "frame-to-media" ? "frame-to-media" : "media-to-frame"
      );
      setFrameDataUrl(s.mediaFrameDataUrl ?? null);
      setFrameId(s.mediaFrameId ?? null);
      setShowOnboarding(!s.onboardingDismissed);
      setAppVersion(s.appVersion);
    });
    void window.mirrox.getMediaFrame().then((f) => {
      setFrameDataUrl(f.dataUrl);
      setFrameId(f.id);
      setApplyFrame(Boolean(f.applyDefault));
      setFrameFitMode(f.fitMode === "frame-to-media" ? "frame-to-media" : "media-to-frame");
      setBuiltinFrames(f.builtins ?? []);
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
    const offAbout = window.mirrox.onAboutOpen(() => setAboutOpen(true));
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
            tempPath?: string;
            serial?: string;
          };
          if (p.started) showToast("ok", "Recording…");
          else if (p.tempPath && (p.serial || serial)) {
            setRecordingSave({ path: p.tempPath, serial: p.serial ?? serial });
            showToast("info", "Recording ready to save");
          } else if (p.saved && p.path) showToast("ok", `Saved ${p.path}`);
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
      offAbout();
      offMirrorShortcut();
    };
  }, [selected, showToast]);

  useEffect(() => {
    if (!aboutOpen) return;
    let cancelled = false;
    setGithubStatsLoading(true);
    void window.mirrox.getGithubStats().then((res) => {
      if (cancelled) return;
      setGithubStats({
        stars: res.stars,
        forks: res.forks,
        url: res.url || GITHUB_REPO_URL,
        fullName: res.fullName || "moezbenselem/Mirrox",
      });
      setGithubStatsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [aboutOpen]);

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
  const orientation = (selectedDevice?.orientation ?? 0) as OrientationDegrees;
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
        showToast("ok", `Wireless ready — use Pair or connect to ${result.hint}`);
      } else {
        showToast("info", "TCP/IP enabled on port 5555. Use Pair in the title bar.");
      }
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

  async function setApplyFrameDefault(next: boolean) {
    setApplyFrame(next);
    await window.mirrox.setSettings({ mediaFrameApplyDefault: next });
    if (next && !frameId && builtinFrames[0]) {
      await selectBuiltinFrame(builtinFrames[0].id);
    }
  }

  async function setFrameFitModeDefault(next: "media-to-frame" | "frame-to-media") {
    setFrameFitMode(next);
    await window.mirrox.setSettings({ mediaFrameFitMode: next });
  }

  async function pickFrame() {
    setBusy(true);
    try {
      const result = await window.mirrox.pickMediaFrame();
      if (result.ok && result.dataUrl) {
        setFrameDataUrl(result.dataUrl);
        setFrameId(result.id ?? "custom");
        showToast("ok", "Custom frame loaded — green area auto-detected");
      }
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function selectBuiltinFrame(id: string) {
    setBusy(true);
    try {
      const result = await window.mirrox.selectMediaFrame(id);
      setFrameDataUrl(result.dataUrl);
      setFrameId(result.id);
      showToast("ok", `${result.name} selected`);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearFrame() {
    setBusy(true);
    try {
      await window.mirrox.clearMediaFrame();
      setFrameDataUrl(null);
      setFrameId(null);
      showToast("info", "Frame cleared");
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
        const result = await window.mirrox.stopRecording(selectedDevice.serial);
        if (result.tempPath) {
          setRecordingSave({
            path: result.tempPath,
            serial: result.serial ?? selectedDevice.serial,
          });
          showToast("info", "Recording ready to save");
        } else {
          showToast("info", "Recording stopped");
        }
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

  async function setOrientation(next: OrientationDegrees) {
    if (!selectedDevice || !canControl) return;
    setBusy(true);
    try {
      await window.mirrox.setOrientation(selectedDevice.serial, next);
      showToast("ok", `Rotated to ${next}°`);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  function stepOrientation(delta: 90 | -90) {
    const next = ((((orientation + delta) % 360) + 360) % 360) as OrientationDegrees;
    void setOrientation(next);
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
    if (applyFrame && !frameDataUrl) {
      showToast("error", "Choose a Pixel frame or upload a custom one first");
      return;
    }
    setBusy(true);
    try {
      const result = await window.mirrox.saveScreenshot(
        preview.path,
        preview.serial,
        applyFrame
      );
      if (result.ok && result.path) showToast("ok", `Saved ${result.path}`);
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyPreview() {
    if (!preview) return;
    if (applyFrame && !frameDataUrl) {
      showToast("error", "Choose a Pixel frame or upload a custom one first");
      return;
    }
    setBusy(true);
    try {
      await window.mirrox.copyScreenshot(preview.path, applyFrame);
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

  async function saveRecordingPreview() {
    if (!recordingSave) return;
    if (applyFrame && !frameDataUrl) {
      showToast("error", "Choose a Pixel frame or upload a custom one first");
      return;
    }
    setBusy(true);
    try {
      const result = await window.mirrox.saveRecording(
        recordingSave.path,
        recordingSave.serial,
        applyFrame
      );
      if (result.saved && result.path) {
        setRecordingSave(null);
        showToast("ok", `Saved ${result.path}`);
      } else if (result.canceled) {
        showToast("info", "Save canceled");
      }
    } catch (err) {
      showToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function discardRecordingPreview() {
    if (recordingSave) void window.mirrox.discardRecording(recordingSave.path);
    setRecordingSave(null);
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
          {appVersion && (
            <div className="sidebar-version">
              <span>v{appVersion}</span>
              <button
                type="button"
                className="sidebar-releases"
                title="GitHub Releases"
                aria-label="Open GitHub Releases"
                onClick={() => void window.mirrox.openExternal(GITHUB_RELEASES_URL)}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.58c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
                  />
                </svg>
              </button>
            </div>
          )}
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
                        : "Ready to mirror. Click View to open a native mirror window."}
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
                    <div className="row">
                      <span className="label">Rotate</span>
                      <button
                        className="btn"
                        disabled={busy}
                        title="Rotate counter-clockwise 90°"
                        onClick={() => stepOrientation(-90)}
                      >
                        ⟲ 90°
                      </button>
                      <span className="label" aria-live="polite">
                        {orientation}°
                      </span>
                      <button
                        className="btn"
                        disabled={busy}
                        title="Rotate clockwise 90°"
                        onClick={() => stepOrientation(90)}
                      >
                        ⟳ 90°
                      </button>
                      {orientation !== 0 && (
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() => void setOrientation(0)}
                        >
                          Reset
                        </button>
                      )}
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
                  <div className="cards-row">
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

                    <div className="card">
                      <h3>Quality</h3>
                      <div className="quality-stack">
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
                        </div>
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
                  </div>
                )}

                {canControl && mirroring && <MirrorShortcuts navBarEnabled={navBarEnabled} />}

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

      {aboutOpen && (
        <AboutModal
          version={appVersion ?? "…"}
          stats={githubStats}
          loading={githubStatsLoading}
          onClose={() => setAboutOpen(false)}
          onOpenRepo={() =>
            void window.mirrox.openExternal(githubStats?.url ?? GITHUB_REPO_URL)
          }
        />
      )}

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
            <MediaFrameControls
              applyFrame={applyFrame}
              onApplyChange={(next) => void setApplyFrameDefault(next)}
              fitMode={frameFitMode}
              onFitModeChange={(next) => void setFrameFitModeDefault(next)}
              frameId={frameId}
              frameDataUrl={frameDataUrl}
              builtins={builtinFrames}
              busy={busy}
              onSelectBuiltin={(id) => void selectBuiltinFrame(id)}
              onPick={() => void pickFrame()}
              onClear={() => void clearFrame()}
            />
          </div>
        </div>
      )}

      {recordingSave && (
        <div className="modal-backdrop" onClick={() => void discardRecordingPreview()}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Save recording"
          >
            <div className="modal-header">
              <h3>Save recording</h3>
              <button className="btn" onClick={() => void discardRecordingPreview()} disabled={busy}>
                Discard
              </button>
            </div>
            <p className="frame-hint" style={{ margin: 0 }}>
              Recording pulled from the device. Optionally apply a green-space frame before saving.
            </p>
            <MediaFrameControls
              applyFrame={applyFrame}
              onApplyChange={(next) => void setApplyFrameDefault(next)}
              fitMode={frameFitMode}
              onFitModeChange={(next) => void setFrameFitModeDefault(next)}
              frameId={frameId}
              frameDataUrl={frameDataUrl}
              builtins={builtinFrames}
              busy={busy}
              onSelectBuiltin={(id) => void selectBuiltinFrame(id)}
              onPick={() => void pickFrame()}
              onClear={() => void clearFrame()}
            />
            <div className="modal-actions">
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void saveRecordingPreview()}
              >
                Save…
              </button>
              <button className="btn" disabled={busy} onClick={() => void discardRecordingPreview()}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
