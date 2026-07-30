import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export interface AppSettings {
  quality?: "low" | "medium" | "high";
  alwaysOnTop?: boolean;
  keepScreenOn?: boolean;
  onboardingDismissed?: boolean;
  navBarEnabled?: boolean;
  clipboardAutosyncDefault?: boolean;
  screenshotCopyToClipboard?: boolean;
  mediaFrameApplyDefault?: boolean;
  mediaFrameFitMode?: "media-to-frame" | "frame-to-media";
  mediaFrameId?: string | null;
  mediaFramePath?: string | null;
  updateBannerDismissedVersion?: string | null;
}

const DEFAULTS: Required<
  Pick<
    AppSettings,
    | "onboardingDismissed"
    | "navBarEnabled"
    | "clipboardAutosyncDefault"
    | "screenshotCopyToClipboard"
    | "mediaFrameApplyDefault"
    | "mediaFrameFitMode"
    | "updateBannerDismissedVersion"
  >
> = {
  onboardingDismissed: false,
  navBarEnabled: false,
  clipboardAutosyncDefault: true,
  screenshotCopyToClipboard: false,
  mediaFrameApplyDefault: false,
  mediaFrameFitMode: "media-to-frame",
  updateBannerDismissedVersion: null,
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function loadSettings(): AppSettings {
  try {
    const file = settingsPath();
    if (!fs.existsSync(file)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as AppSettings;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(partial: AppSettings): AppSettings {
  const next = { ...loadSettings(), ...partial };
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  } catch {
    /* ignore persistence failures */
  }
  return next;
}
