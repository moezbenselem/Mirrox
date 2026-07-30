import { useCallback, useEffect, useState } from "react";

interface Props {
  serial: string;
  state: string;
  disabled?: boolean;
}

export default function DeviceInfoCard({ serial, state, disabled }: Props) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.mirrox.getDeviceInfo>> | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
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

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

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

  return (
    <div className="card device-info-card">
      <div className="device-info-header">
        <h3>Device</h3>
        <button
          className="btn"
          disabled={disabled || loading}
          onClick={() => void refresh()}
          title="Refresh device info"
        >
          Refresh
        </button>
      </div>

      {!info?.available ? (
        <p className="device-info-unavailable">
          {info?.unavailableReason ??
            (state === "unauthorized"
              ? "Unauthorized — allow USB debugging on the phone."
              : "Device details unavailable.")}
        </p>
      ) : (
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
      )}
    </div>
  );
}
