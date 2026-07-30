interface Props {
  serial: string;
  disabled?: boolean;
  onToast: (kind: "ok" | "error" | "info", text: string) => void;
}

const NAV = [
  { id: "back", label: "Back", action: "back" as const },
  { id: "home", label: "Home", action: "home" as const },
  { id: "recents", label: "Recents", action: "recents" as const },
  { id: "notifications", label: "Notifications", action: "notifications" as const },
];

export default function NavBar({ serial, disabled, onToast }: Props) {
  async function send(action: (typeof NAV)[number]["action"]) {
    try {
      await window.mirrox.sendNav(serial, action);
    } catch (err) {
      onToast("error", String(err));
    }
  }

  return (
    <div className="nav-bar" role="toolbar" aria-label="Device navigation">
      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          className="btn nav-bar-btn"
          disabled={disabled}
          onClick={() => void send(item.action)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
