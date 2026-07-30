import logoUrl from "./assets/logo.png";

interface GithubStats {
  stars: number;
  forks: number;
  url: string;
  fullName: string;
}

interface Props {
  version: string;
  stats: GithubStats | null;
  loading: boolean;
  onClose: () => void;
  onOpenRepo: () => void;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.5l1.76 3.56 3.93.57-2.84 2.77.67 3.91L8 10.77l-3.52 1.85.67-3.91L2.31 5.63l3.93-.57L8 1.5z"
      />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm3-8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.58c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

export default function AboutModal({
  version,
  stats,
  loading,
  onClose,
  onOpenRepo,
}: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal about-modal"
        role="dialog"
        aria-label="About Mirrox"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="about-hero">
          <img className="about-logo" src={logoUrl} alt="" draggable={false} />
          <div className="about-titles">
            <h3>Mirrox</h3>
            <p className="about-version">Version {version}</p>
            <p className="about-tagline">Mirror Android to your Mac desktop</p>
          </div>
        </div>

        <button type="button" className="about-repo" onClick={onOpenRepo}>
          <span className="about-repo-icon">
            <GithubIcon />
          </span>
          <span className="about-repo-meta">
            <span className="about-repo-label">GitHub</span>
            <span className="about-repo-name">
              {stats?.fullName ?? "moezbenselem/Mirrox"}
            </span>
          </span>
          <span className="about-repo-chevron" aria-hidden="true">
            →
          </span>
        </button>

        <div className="about-stats" aria-live="polite">
          <div className="about-stat">
            <span className="about-stat-icon">
              <StarIcon />
            </span>
            <div>
              <div className="about-stat-value">
                {loading ? "…" : stats ? formatCount(stats.stars) : "—"}
              </div>
              <div className="about-stat-label">Stars</div>
            </div>
          </div>
          <div className="about-stat">
            <span className="about-stat-icon">
              <ForkIcon />
            </span>
            <div>
              <div className="about-stat-value">
                {loading ? "…" : stats ? formatCount(stats.forks) : "—"}
              </div>
              <div className="about-stat-label">Forks</div>
            </div>
          </div>
        </div>

        <div className="modal-actions about-actions">
          <button type="button" className="btn" onClick={onOpenRepo}>
            View on GitHub
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
