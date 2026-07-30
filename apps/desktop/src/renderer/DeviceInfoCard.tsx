import { useCallback, useEffect, useMemo, useState } from "react";

interface Props {
  serial: string;
  state: string;
  disabled?: boolean;
  defaultCollapsed?: boolean;
}

export default function DeviceInfoCard({
  serial,
  state,
  disabled,
  defaultCollapsed = false,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.mirrox.getDeviceInfo>> | null>(
    null
  );
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const refreshInfo = useCallback(async () => {
    if (!serial) return;
    setLoading(true);
    try {
      const next = await window.mirrox.getDeviceInfo(serial);
      setInfo(next);
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [serial]);

  const refreshFrame = useCallback(async () => {
    if (!serial || state !== "device" || collapsed) {
      return;
    }
    setFrameLoading(true);
    try {
      const shot = await window.mirrox.getDeviceFramePreview(serial);
      if (shot.ok && shot.dataUrl) {
        setFrameUrl(shot.dataUrl);
        if (shot.width > 0 && shot.height > 0) {
          setFrameSize({ width: shot.width, height: shot.height });
        }
      }
    } catch {
      /* keep previous frame if capture fails */
    } finally {
      setFrameLoading(false);
    }
  }, [serial, state, collapsed]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshInfo(), refreshFrame()]);
  }, [refreshInfo, refreshFrame]);

  useEffect(() => {
    setFrameUrl(null);
    setFrameSize(null);
  }, [serial]);

  useEffect(() => {
    void refreshInfo();
    const infoId = window.setInterval(() => void refreshInfo(), 15_000);
    return () => window.clearInterval(infoId);
  }, [refreshInfo]);

  useEffect(() => {
    if (collapsed) return;
    void refreshFrame();
    const frameId = window.setInterval(() => void refreshFrame(), 12_000);
    return () => window.clearInterval(frameId);
  }, [collapsed, refreshFrame]);

  const previewW = frameSize?.width ?? info?.displayWidth ?? 0;
  const previewH = frameSize?.height ?? info?.displayHeight ?? 0;
  const isLandscape = previewW > 0 && previewH > 0 && previewW > previewH;

  const aspectRatio = useMemo(() => {
    if (previewW > 0 && previewH > 0) return `${previewW} / ${previewH}`;
    return "9 / 19.5";
  }, [previewW, previewH]);

  const batteryText = (() => {
    if (!info?.available || !info.battery) return "—";
    const level = info.battery.level != null ? `${info.battery.level}%` : "—";
    if (info.battery.charging) return `${level} · Charging`;
    return level;
  })();

  const storageText = (() => {
    if (!info?.storage?.used && !info?.storage?.total) return "—";
    if (info.storage.used && info.storage.total) {
      return `${info.storage.used} / ${info.storage.total}`;
    }
    return info.storage.raw ?? "—";
  })();

  const summary = (() => {
    if (!info?.available) return info?.unavailableReason ?? "Unavailable";
    const parts = [
      info.model,
      info.androidVersion ? `Android ${info.androidVersion}` : null,
      info.battery?.level != null ? `${info.battery.level}%` : null,
      info.connection,
    ].filter(Boolean);
    return parts.join(" · ") || "Device";
  })();

  return (
    <div className={`card device-info-card ${collapsed ? "is-collapsed" : ""}`}>
      <div className="device-info-header">
        <button
          type="button"
          className="device-info-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className="device-info-chevron" aria-hidden>
            {collapsed ? "▸" : "▾"}
          </span>
          <h3>Device</h3>
          {collapsed && <span className="device-info-summary">{summary}</span>}
        </button>
        {!collapsed && (
          <button
            className="btn"
            disabled={disabled || loading || frameLoading}
            onClick={() => void refreshAll()}
            title="Refresh device info and screen preview"
          >
            Refresh
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {!info?.available ? (
            <p className="device-info-unavailable">
              {info?.unavailableReason ??
                (state === "unauthorized"
                  ? "Unauthorized — allow USB debugging on the phone."
                  : "Device details unavailable.")}
            </p>
          ) : (
            <div className="device-info-body">
              <div
                className={`device-frame${isLandscape ? " is-landscape" : ""}`}
                title={info.model ?? "Device"}
              >
                <div className="device-frame-bezel">
                  <div className="device-frame-speaker" />
                  <div className="device-frame-screen" style={{ aspectRatio }}>
                    {frameUrl ? (
                      <img src={frameUrl} alt="" className="device-frame-shot" draggable={false} />
                    ) : (
                      <div className="device-frame-placeholder">
                        {frameLoading ? "Capturing…" : "No preview"}
                      </div>
                    )}
                  </div>
                  <div className="device-frame-home" />
                </div>
                <div className="device-frame-caption">{info.model ?? "Android"}</div>
              </div>

              <div className="device-info-grid">
                <div className="device-info-row">
                  <span className="device-info-label">Model</span>
                  <span className="device-info-value">{info.model ?? "—"}</span>
                </div>
                <div className="device-info-row">
                  <span className="device-info-label">Android</span>
                  <span className="device-info-value">
                    {info.androidVersion
                      ? `${info.androidVersion}${info.sdk ? ` (API ${info.sdk})` : ""}`
                      : "—"}
                  </span>
                </div>
                <div className="device-info-row">
                  <span className="device-info-label">Display</span>
                  <span className="device-info-value mono">
                    {info.displayWidth && info.displayHeight
                      ? `${info.displayWidth}×${info.displayHeight}`
                      : "—"}
                  </span>
                </div>
                <div className="device-info-row">
                  <span className="device-info-label">Battery</span>
                  <span className="device-info-value">{batteryText}</span>
                </div>
                <div className="device-info-row">
                  <span className="device-info-label">IP</span>
                  <span className="device-info-value mono">{info.ip ?? "—"}</span>
                </div>
                <div className="device-info-row">
                  <span className="device-info-label">Storage</span>
                  <span className="device-info-value">{storageText}</span>
                </div>
                <div className="device-info-row">
                  <span className="device-info-label">Connection</span>
                  <span className="device-info-value">{info.connection}</span>
                </div>
                <div className="device-info-row">
                  <span className="device-info-label">Serial</span>
                  <span className="device-info-value mono">{info.serial}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
