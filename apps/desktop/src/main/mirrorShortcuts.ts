import { globalShortcut } from "electron";

export type MirrorShortcutAction = "screenshot" | "toggleRecord";

export interface MirrorShortcutDef {
  action: MirrorShortcutAction;
  label: string;
  accelerator: string;
}

/** Global shortcuts active only while a scrcpy mirror is running. */
export const MIRROR_SHORTCUTS: MirrorShortcutDef[] = [
  {
    action: "screenshot",
    label: "Screenshot",
    accelerator: "CommandOrControl+Shift+S",
  },
  {
    action: "toggleRecord",
    label: "Record / Stop",
    accelerator: "CommandOrControl+Shift+R",
  },
];

export interface MirrorShortcutHandlers {
  getTargetSerial: () => string | null;
  onAction: (action: MirrorShortcutAction, serial: string) => void | Promise<void>;
  /** Called when Escape is pressed while a mirror is fullscreen. */
  onExitFullscreen?: () => void | Promise<void>;
}

/**
 * Registers OS-level accelerators so Screenshot / Record work while the
 * native scrcpy window (not Electron) has keyboard focus.
 * Escape is registered only while a mirror is in fullscreen.
 */
export class MirrorShortcutManager {
  private active = false;
  private escapeActive = false;
  private readonly busy = new Set<MirrorShortcutAction>();
  private escapeBusy = false;
  private readonly handlers: MirrorShortcutHandlers;

  constructor(handlers: MirrorShortcutHandlers) {
    this.handlers = handlers;
  }

  sync(enabled: boolean): void {
    if (enabled === this.active) return;
    this.active = enabled;
    if (enabled) this.register();
    else this.unregister();
  }

  /** Register Escape to exit fullscreen only while a session is fullscreen. */
  syncEscapeExit(enabled: boolean): void {
    if (enabled === this.escapeActive) return;
    this.escapeActive = enabled;
    if (enabled) this.registerEscape();
    else this.unregisterEscape();
  }

  dispose(): void {
    this.unregister();
    this.unregisterEscape();
    this.active = false;
    this.escapeActive = false;
    this.busy.clear();
    this.escapeBusy = false;
  }

  private register(): void {
    for (const shortcut of MIRROR_SHORTCUTS) {
      if (globalShortcut.isRegistered(shortcut.accelerator)) continue;
      const ok = globalShortcut.register(shortcut.accelerator, () => {
        const serial = this.handlers.getTargetSerial();
        if (!serial) return;
        if (this.busy.has(shortcut.action)) return;
        this.busy.add(shortcut.action);
        void Promise.resolve(this.handlers.onAction(shortcut.action, serial)).finally(() => {
          this.busy.delete(shortcut.action);
        });
      });
      if (!ok) {
        console.warn(`[mirror-shortcuts] Failed to register ${shortcut.accelerator}`);
      }
    }
  }

  private unregister(): void {
    for (const shortcut of MIRROR_SHORTCUTS) {
      if (globalShortcut.isRegistered(shortcut.accelerator)) {
        globalShortcut.unregister(shortcut.accelerator);
      }
    }
  }

  private registerEscape(): void {
    if (globalShortcut.isRegistered("Escape")) return;
    const ok = globalShortcut.register("Escape", () => {
      if (this.escapeBusy) return;
      if (!this.handlers.onExitFullscreen) return;
      this.escapeBusy = true;
      void Promise.resolve(this.handlers.onExitFullscreen()).finally(() => {
        this.escapeBusy = false;
      });
    });
    if (!ok) {
      console.warn("[mirror-shortcuts] Failed to register Escape for exit fullscreen");
      this.escapeActive = false;
    }
  }

  private unregisterEscape(): void {
    if (globalShortcut.isRegistered("Escape")) {
      globalShortcut.unregister("Escape");
    }
  }
}
