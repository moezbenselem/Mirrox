interface Props {
  version: string;
  progress?: number | null;
  downloading?: boolean;
  ready?: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner({
  version,
  progress,
  downloading,
  ready,
  onInstall,
  onDismiss,
}: Props) {
  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">
        {ready
          ? `Mirrox ${version} ready to install`
          : downloading
            ? `Downloading Mirrox ${version}${progress != null ? `… ${Math.round(progress)}%` : "…"}`
            : `Mirrox ${version} available`}
      </span>
      <div className="update-banner-actions">
        {ready ? (
          <button type="button" className="btn primary" onClick={onInstall}>
            Restart &amp; install
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
