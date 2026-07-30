import { useCallback, useEffect, useMemo, useState } from "react";

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

const SHORTCUTS = [
  { label: "Internal", path: "/sdcard" },
  { label: "Download", path: "/sdcard/Download" },
  { label: "DCIM", path: "/sdcard/DCIM" },
  { label: "Pictures", path: "/sdcard/Pictures" },
  { label: "Documents", path: "/sdcard/Documents" },
];

function parentPath(p: string): string {
  if (p === "/" || p === "") return "/";
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx) || "/";
}

function crumbs(current: string): Array<{ label: string; path: string }> {
  const parts = current.replace(/\/+$/, "").split("/").filter(Boolean);
  const items: Array<{ label: string; path: string }> = [];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    items.push({ label: part, path: acc });
  }
  return items.length ? items : [{ label: "/", path: "/" }];
}

interface Props {
  serial: string;
  disabled?: boolean;
  onToast: (kind: "ok" | "error" | "info", text: string) => void;
}

export default function FileTransfer({ serial, disabled, onToast }: Props) {
  const [path, setPath] = useState("/sdcard/Download");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<
    | null
    | { type: "rename"; item: FsEntry; value: string }
    | { type: "mkdir"; value: string }
    | { type: "delete"; items: FsEntry[] }
  >(null);
  const [menu, setMenu] = useState<null | {
    x: number;
    y: number;
    entry: FsEntry | null;
  }>(null);

  const load = useCallback(
    async (nextPath: string) => {
      setLoading(true);
      setError(null);
      setSelected(new Set());
      try {
        const result = await window.mirrox.listFs(serial, nextPath);
        setPath(result.path);
        setEntries(result.entries);
      } catch (err) {
        setEntries([]);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [serial]
  );

  useEffect(() => {
    void load(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, filter]);

  const selectedFiles = useMemo(
    () => entries.filter((e) => selected.has(e.path) && !e.isDirectory),
    [entries, selected]
  );

  const selectedItems = useMemo(
    () => entries.filter((e) => selected.has(e.path)),
    [entries, selected]
  );

  function toggleSelect(entry: FsEntry, additive: boolean) {
    setSelected((prev) => {
      const next = new Set(additive ? prev : []);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  }

  async function goTo(next: string) {
    await load(next);
  }

  async function uploadPaths(localPaths: string[]) {
    if (!localPaths.length || disabled) return;
    setBusy(true);
    try {
      const { results } = await window.mirrox.uploadFs(serial, path, localPaths);
      const summary = results
        .map((r) => `${r.action}: ${r.localPath.split("/").pop()}`)
        .join("\n");
      onToast("ok", summary || "Uploaded");
      await load(path);
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onUpload() {
    const paths = await window.mirrox.pickUploadFiles();
    await uploadPaths(paths);
  }

  async function onDownload() {
    await onDownloadItems(selectedFiles);
  }

  function onNewFolder() {
    setDialog({ type: "mkdir", value: "" });
  }

  function onDelete(items?: FsEntry[]) {
    const targets = items?.length ? items : selectedItems;
    if (!targets.length) return;
    setDialog({ type: "delete", items: targets });
  }

  function onRename(item?: FsEntry) {
    const target = item ?? (selectedItems.length === 1 ? selectedItems[0] : null);
    if (!target) return;
    setDialog({ type: "rename", item: target, value: target.name });
  }

  function closeMenu() {
    setMenu(null);
  }

  function openContextMenu(e: React.MouseEvent, entry: FsEntry | null) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || busy) return;

    if (entry) {
      setSelected((prev) => {
        if (prev.has(entry.path)) return prev;
        return new Set([entry.path]);
      });
    }

    const pad = 8;
    const menuW = 180;
    const menuH = entry ? 220 : 120;
    const x = Math.min(e.clientX, window.innerWidth - menuW - pad);
    const y = Math.min(e.clientY, window.innerHeight - menuH - pad);
    setMenu({ x: Math.max(pad, x), y: Math.max(pad, y), entry });
  }

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onScroll = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu]);

  async function submitDialog() {
    if (!dialog) return;

    if (dialog.type === "mkdir") {
      const name = dialog.value.trim();
      if (!name) return;
      setBusy(true);
      try {
        const remote = `${path.replace(/\/+$/, "")}/${name}`;
        await window.mirrox.mkdirFs(serial, remote);
        onToast("ok", `Created ${name}`);
        setDialog(null);
        await load(path);
      } catch (err) {
        onToast("error", String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (dialog.type === "rename") {
      const trimmed = dialog.value.trim();
      if (!trimmed || trimmed === dialog.item.name) {
        setDialog(null);
        return;
      }
      if (trimmed.includes("/")) {
        onToast("error", "Name cannot contain /");
        return;
      }
      setBusy(true);
      try {
        await window.mirrox.renameFs(serial, dialog.item.path, trimmed);
        onToast("ok", `Renamed to ${trimmed}`);
        setDialog(null);
        await load(path);
      } catch (err) {
        onToast("error", String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (dialog.type === "delete") {
      setBusy(true);
      try {
        await window.mirrox.deleteFs(
          serial,
          dialog.items.map((i) => ({ path: i.path, isDirectory: i.isDirectory }))
        );
        onToast("ok", `Deleted ${dialog.items.length} item(s)`);
        setDialog(null);
        await load(path);
      } catch (err) {
        onToast("error", String(err));
      } finally {
        setBusy(false);
      }
    }
  }

  async function onDuplicate(item?: FsEntry) {
    const target = item ?? (selectedItems.length === 1 ? selectedItems[0] : null);
    if (!target) return;
    setBusy(true);
    try {
      const result = await window.mirrox.duplicateFs(serial, {
        path: target.path,
        isDirectory: target.isDirectory,
      });
      const name = result.path.split("/").pop() ?? "copy";
      onToast("ok", `Duplicated as ${name}`);
      await load(path);
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDownloadItems(items: FsEntry[]) {
    const files = items.filter((i) => !i.isDirectory);
    if (!files.length) return;
    setBusy(true);
    try {
      const result = await window.mirrox.downloadFs(
        serial,
        files.map((f) => f.path)
      );
      if (result.canceled) return;
      onToast(
        "ok",
        `Downloaded ${result.results.length} file(s) to ${result.destDir}`
      );
      if (result.destDir) void window.mirrox.openPath(result.destDir);
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.mirrox.getPathForFile(f))
      .filter((p): p is string => Boolean(p));
    void uploadPaths(paths);
  }

  const trail = crumbs(path);

  const menuTargets = useMemo(() => {
    if (!menu?.entry) return [] as FsEntry[];
    if (selected.has(menu.entry.path) && selected.size > 1) {
      return entries.filter((e) => selected.has(e.path));
    }
    return [menu.entry];
  }, [menu, selected, entries]);

  const menuFiles = useMemo(
    () => menuTargets.filter((e) => !e.isDirectory),
    [menuTargets]
  );
  const menuSingle = menuTargets.length === 1 ? menuTargets[0] : null;

  return (
    <div className="card file-transfer">
      <div className="file-transfer-header">
        <h3>Files</h3>
        <div className="file-transfer-actions">
          <button className="btn" disabled={disabled || busy || loading} onClick={() => void load(path)}>
            Refresh
          </button>
          <button className="btn" disabled={disabled || busy} onClick={() => void onUpload()}>
            Upload…
          </button>
          <button
            className="btn primary"
            disabled={disabled || busy || selectedFiles.length === 0}
            onClick={() => void onDownload()}
          >
            Download{selectedFiles.length ? ` (${selectedFiles.length})` : ""}
          </button>
          <button
            className="btn danger"
            disabled={disabled || busy || selectedItems.length === 0}
            onClick={() => void onDelete()}
          >
            Delete{selectedItems.length ? ` (${selectedItems.length})` : ""}
          </button>
          <button
            className="btn"
            disabled={disabled || busy || selectedItems.length !== 1}
            onClick={() => void onRename()}
          >
            Rename
          </button>
          <button
            className="btn"
            disabled={disabled || busy || selectedItems.length !== 1}
            onClick={() => void onDuplicate()}
          >
            Duplicate
          </button>
        </div>
      </div>

      <div className="file-shortcuts">
        {SHORTCUTS.map((s) => (
          <button
            key={s.path}
            className={`chip ${path === s.path ? "active" : ""}`}
            disabled={disabled || busy}
            onClick={() => void goTo(s.path)}
          >
            {s.label}
          </button>
        ))}
        <button className="chip" disabled={disabled || busy} onClick={() => void onNewFolder()}>
          New folder
        </button>
      </div>

      <div className="file-breadcrumbs">
        <button
          className="crumb"
          disabled={disabled || busy || path === "/sdcard"}
          onClick={() => void goTo(parentPath(path))}
        >
          ↑
        </button>
        {trail.map((c, i) => (
          <button
            key={c.path}
            className="crumb"
            disabled={disabled || busy}
            onClick={() => void goTo(c.path)}
          >
            {i > 0 ? "/" : ""}
            {c.label}
          </button>
        ))}
      </div>

      <input
        className="file-filter"
        type="text"
        placeholder="Filter files…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        disabled={disabled}
      />

      <div
        className={`file-list ${dropActive ? "drop-active" : ""}`}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onContextMenu={(e) => openContextMenu(e, null)}
      >
        {loading ? (
          <div className="file-empty">Loading…</div>
        ) : error ? (
          <div className="file-empty error">{error}</div>
        ) : visible.length === 0 ? (
          <div className="file-empty">
            Empty folder. Drop files here or click Upload.
          </div>
        ) : (
          visible.map((entry) => {
            const isSelected = selected.has(entry.path);
            return (
              <button
                key={entry.path}
                type="button"
                className={`file-row ${entry.isDirectory ? "dir" : ""} ${isSelected ? "selected" : ""}`}
                disabled={disabled || busy}
                onClick={(e) => {
                  // Single click selects; folders open on double-click only
                  toggleSelect(entry, e.metaKey || e.ctrlKey || e.shiftKey);
                }}
                onDoubleClick={() => {
                  if (entry.isDirectory) void goTo(entry.path);
                }}
                onContextMenu={(e) => openContextMenu(e, entry)}
              >
                <span className={`file-icon ${entry.isDirectory ? "is-dir" : "is-file"}`} />
                <span className="file-name">{entry.name}</span>
                <span className="file-kind">{entry.isDirectory ? "Folder" : "File"}</span>
              </button>
            );
          })
        )}
      </div>

      <p className="file-hint">
        Double-click a folder to open. Right-click for actions. Click to select
        (⌘/Ctrl for multi). Drop files onto the list to upload. APKs install
        automatically.
      </p>

      {menu && (
        <>
          <div className="fs-menu-backdrop" onMouseDown={closeMenu} onContextMenu={(e) => {
            e.preventDefault();
            closeMenu();
          }} />
          <div
            className="fs-menu"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {menu.entry ? (
              <>
                {menuSingle?.isDirectory && (
                  <button
                    type="button"
                    className="fs-menu-item"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      void goTo(menuSingle.path);
                    }}
                  >
                    Open
                  </button>
                )}
                {menuFiles.length > 0 && (
                  <button
                    type="button"
                    className="fs-menu-item"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      void onDownloadItems(menuFiles);
                    }}
                  >
                    Download{menuFiles.length > 1 ? ` (${menuFiles.length})` : ""}
                  </button>
                )}
                {menuSingle && (
                  <>
                    <button
                      type="button"
                      className="fs-menu-item"
                      role="menuitem"
                      onClick={() => {
                        closeMenu();
                        onRename(menuSingle);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="fs-menu-item"
                      role="menuitem"
                      onClick={() => {
                        closeMenu();
                        void onDuplicate(menuSingle);
                      }}
                    >
                      Duplicate
                    </button>
                  </>
                )}
                <div className="fs-menu-sep" />
                <button
                  type="button"
                  className="fs-menu-item danger"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onDelete(menuTargets);
                  }}
                >
                  Delete{menuTargets.length > 1 ? ` (${menuTargets.length})` : ""}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="fs-menu-item"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onNewFolder();
                  }}
                >
                  New folder
                </button>
                <button
                  type="button"
                  className="fs-menu-item"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void onUpload();
                  }}
                >
                  Upload…
                </button>
                <button
                  type="button"
                  className="fs-menu-item"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void load(path);
                  }}
                >
                  Refresh
                </button>
              </>
            )}
          </div>
        </>
      )}

      {dialog && (
        <div className="fs-dialog-backdrop" onClick={() => !busy && setDialog(null)}>
          <div
            className="fs-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {dialog.type === "rename" && (
              <>
                <h4>Rename</h4>
                <input
                  autoFocus
                  className="file-filter"
                  value={dialog.value}
                  onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitDialog();
                    if (e.key === "Escape") setDialog(null);
                  }}
                />
              </>
            )}
            {dialog.type === "mkdir" && (
              <>
                <h4>New folder</h4>
                <input
                  autoFocus
                  className="file-filter"
                  placeholder="Folder name"
                  value={dialog.value}
                  onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitDialog();
                    if (e.key === "Escape") setDialog(null);
                  }}
                />
              </>
            )}
            {dialog.type === "delete" && (
              <>
                <h4>Delete {dialog.items.length} item(s)?</h4>
                <p className="fs-dialog-body">
                  {dialog.items.map((i) => i.name).join(", ")}
                </p>
              </>
            )}
            <div className="fs-dialog-actions">
              <button className="btn" disabled={busy} onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                className={`btn ${dialog.type === "delete" ? "danger" : "primary"}`}
                disabled={busy}
                onClick={() => void submitDialog()}
              >
                {dialog.type === "delete" ? "Delete" : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
