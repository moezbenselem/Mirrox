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
  updateBannerDismissedVersion?: string | null;
}

const DEFAULTS: Required<
  Pick<
    AppSettings,
    | "onboardingDismissed"
    | "navBarEnabled"
    | "clipboardAutosyncDefault"
    | "screenshotCopyToClipboard"
    | "updateBannerDismissedVersion"
  >
> = {
  onboardingDismissed: false,
  navBarEnabled: false,
  clipboardAutosyncDefault: true,
  screenshotCopyToClipboard: false,
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
