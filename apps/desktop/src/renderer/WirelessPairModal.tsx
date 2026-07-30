import { useState } from "react";

interface Props {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onToast: (kind: "ok" | "error" | "info", text: string) => void;
}

export default function WirelessPairModal({ open, busy, onClose, onToast }: Props) {
  const [pairHost, setPairHost] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [connectHost, setConnectHost] = useState("");
  const [paired, setPaired] = useState(false);
  const [working, setWorking] = useState(false);

  if (!open) return null;

  async function onPair() {
    if (!pairHost.trim() || !pairCode.trim()) return;
    setWorking(true);
    try {
      const { result } = await window.mirrox.pairWireless(pairHost.trim(), pairCode.trim());
      setPaired(true);
      if (!connectHost && pairHost.includes(":")) {
        const host = pairHost.trim().split(":")[0];
        setConnectHost(`${host}:5555`);
      }
      onToast("ok", result || "Paired successfully — now Connect");
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setWorking(false);
    }
  }

  async function onConnect() {
    if (!connectHost.trim()) return;
    setWorking(true);
    try {
      const { result } = await window.mirrox.connectWireless(connectHost.trim());
      onToast("ok", result || `Connected to ${connectHost}`);
      onClose();
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setWorking(false);
    }
  }

  const disabled = Boolean(busy || working);

  return (
    <div className="modal-backdrop" onClick={() => !disabled && onClose()}>
      <div
        className="modal wireless-pair-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pair wirelessly"
      >
        <div className="modal-header">
          <h3>Pair wirelessly</h3>
          <button className="btn" disabled={disabled} onClick={onClose}>
            Close
          </button>
        </div>

        <p className="wireless-help">
          On the phone: Developer options → Wireless debugging → Pair device with pairing code.
          Enter the pairing IP:port and 6-digit code, then Connect with the wireless debugging
          IP:port (often different from the pairing port).
        </p>

        <div className="card" style={{ padding: 12 }}>
          <h3>1 · Pair</h3>
          <div className="row">
            <span className="label">Host:port</span>
            <input
              type="text"
              placeholder="192.168.1.20:37123"
              value={pairHost}
              disabled={disabled}
              onChange={(e) => setPairHost(e.target.value)}
            />
          </div>
          <div className="row">
            <span className="label">Code</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={pairCode}
              disabled={disabled}
              onChange={(e) => setPairCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button
              className="btn primary"
              disabled={disabled || !pairHost.trim() || pairCode.length < 6}
              onClick={() => void onPair()}
            >
              Pair
            </button>
          </div>
          {paired && <p className="wireless-ok">Paired — continue to Connect.</p>}
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h3>2 · Connect</h3>
          <div className="row">
            <span className="label">Host:port</span>
            <input
              type="text"
              placeholder="192.168.1.20:5555"
              value={connectHost}
              disabled={disabled}
              onChange={(e) => setConnectHost(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={disabled || !connectHost.trim()}
              onClick={() => void onConnect()}
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
