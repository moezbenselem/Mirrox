interface Props {
  hasReadyDevice: boolean;
  onSkip: () => void;
  onDontShowAgain: () => void;
  onOpenWirelessPair: () => void;
}

export default function Onboarding({
  hasReadyDevice,
  onSkip,
  onDontShowAgain,
  onOpenWirelessPair,
}: Props) {
  return (
    <div className="onboarding-overlay" role="dialog" aria-label="Welcome to Mirrox">
      <div className="onboarding-card">
        <h2>Welcome to Mirrox</h2>
        <p className="onboarding-lead">
          Three steps to put your Android phone on your Mac desktop.
        </p>

        <ol className="onboarding-steps">
          <li className="onboarding-step done">
            <span className="step-num">1</span>
            <div>
              <strong>Enable USB debugging</strong>
              <p>
                Settings → About phone → tap Build number 7 times, then Developer options → USB
                debugging.
              </p>
            </div>
          </li>
          <li className={`onboarding-step ${hasReadyDevice ? "done" : "active"}`}>
            <span className="step-num">2</span>
            <div>
              <strong>Plug in and allow</strong>
              <p>
                Use a data cable, unlock the phone, and accept the RSA fingerprint prompt.
                {hasReadyDevice ? " Device ready." : ""}
              </p>
            </div>
          </li>
          <li className="onboarding-step">
            <span className="step-num">3</span>
            <div>
              <strong>Optional: Go wireless</strong>
              <p>Android 11+ can pair over Wi‑Fi so you can unplug and keep mirroring.</p>
              <button type="button" className="btn" onClick={onOpenWirelessPair}>
                Set up wireless debugging
              </button>
            </div>
          </li>
        </ol>

        <div className="onboarding-footer">
          <button type="button" className="btn" onClick={onSkip}>
            Skip
          </button>
          <button type="button" className="btn primary" onClick={onDontShowAgain}>
            Don&apos;t show again
          </button>
        </div>
      </div>
    </div>
  );
}
