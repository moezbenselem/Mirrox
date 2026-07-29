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
}

/**
 * Registers OS-level accelerators so Screenshot / Record work while the
 * native scrcpy window (not Electron) has keyboard focus.
 */
export class MirrorShortcutManager {
  private active = false;
  private readonly busy = new Set<MirrorShortcutAction>();
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

  dispose(): void {
    this.unregister();
    this.active = false;
    this.busy.clear();
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
}
