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
  const [progress, setProgress] = useState<{
    message: string;
    percent?: number | null;
  } | null>(null);
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
  const [fileInfo, setFileInfo] = useState<null | {
    path: string;
    name: string;
    isDirectory: boolean;
    size: number | null;
    modifiedAt: number | null;
    permissions: string | null;
    owner: string | null;
    group: string | null;
    itemCount: number | null;
    noPreview?: boolean;
    tempPath?: string;
  }>(null);
  const [filePreview, setFilePreview] = useState<null | {
    kind: "image" | "text";
    name: string;
    remotePath: string;
    tempPath: string;
    size: number;
    dataUrl?: string;
    text?: string;
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

  useEffect(() => {
    return window.mirrox.onFsProgress((p) => {
      if (p.done || p.canceled) {
        setProgress(null);
        return;
      }
      if (p.message) {
        setProgress({ message: p.message, percent: p.percent });
      }
    });
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, filter]);

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
      const failed = results.filter((r) => r.error);
      const ok = results.filter((r) => !r.error);
      if (failed.length) {
        onToast(
          "error",
          failed.map((r) => `${r.localPath.split("/").pop()}: ${r.error}`).join("\n")
        );
      }
      if (ok.length) {
        const summary = ok
          .map((r) => `${r.action}: ${r.localPath.split("/").pop()}`)
          .join("\n");
        onToast("ok", summary || "Uploaded");
      }
      await load(path);
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function onUpload() {
    const paths = await window.mirrox.pickUploadFiles();
    await uploadPaths(paths);
  }

  async function onUploadFolder() {
    const paths = await window.mirrox.pickUploadFolder();
    await uploadPaths(paths);
  }

  async function onDownload() {
    await onDownloadItems(selectedItems);
  }

  async function cancelTransfer() {
    await window.mirrox.cancelTransfer();
    setProgress(null);
    setBusy(false);
    onToast("info", "Transfer canceled");
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
    const menuH = entry ? 300 : 120;
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

  async function onGetInfo(
    item?: FsEntry,
    opts?: { noPreview?: boolean; tempPath?: string }
  ) {
    const target = item ?? (selectedItems.length === 1 ? selectedItems[0] : null);
    if (!target) return;
    setBusy(true);
    try {
      const info = await window.mirrox.statFs(serial, target.path);
      setFileInfo({
        path: info.path,
        name: info.name,
        isDirectory: info.isDirectory,
        size: info.size,
        modifiedAt: info.modifiedAt,
        permissions: info.permissions,
        owner: info.owner,
        group: info.group,
        itemCount: info.itemCount,
        noPreview: opts?.noPreview,
        tempPath: opts?.tempPath,
      });
    } catch (err) {
      if (opts?.tempPath) void window.mirrox.discardPreview(opts.tempPath);
      onToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPreview(item?: FsEntry) {
    const target = item ?? (selectedItems.length === 1 ? selectedItems[0] : null);
    if (!target || target.isDirectory) return;
    setBusy(true);
    try {
      const result = await window.mirrox.previewFs(serial, target.path);
      if (result.kind === "unsupported") {
        setBusy(false);
        await onGetInfo(target, { noPreview: true, tempPath: result.tempPath });
        return;
      }
      setFilePreview({
        kind: result.kind,
        name: result.name,
        remotePath: result.remotePath,
        tempPath: result.tempPath,
        size: result.size,
        dataUrl: result.dataUrl,
        text: result.text,
      });
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setBusy(false);
    }
  }

  function closeFileInfo() {
    if (fileInfo?.tempPath) {
      void window.mirrox.discardPreview(fileInfo.tempPath);
    }
    setFileInfo(null);
  }

  async function closeFilePreview() {
    if (filePreview?.tempPath) {
      void window.mirrox.discardPreview(filePreview.tempPath);
    }
    setFilePreview(null);
  }

  async function openPreviewExternally() {
    if (!filePreview?.tempPath) return;
    await window.mirrox.openPath(filePreview.tempPath);
  }

  async function openInfoExternally() {
    if (!fileInfo?.tempPath) return;
    await window.mirrox.openPath(fileInfo.tempPath);
  }

  function formatBytes(n: number): string {
    if (n < 0 || !Number.isFinite(n)) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatModified(ms: number | null): string {
    if (ms == null || !Number.isFinite(ms)) return "—";
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "—";
    }
  }

  async function onDownloadItems(items: FsEntry[]) {
    if (!items.length) return;
    const folders = items.filter((i) => i.isDirectory);
    if (folders.length >= 2) {
      const ok = window.confirm(`Download ${folders.length} folders?`);
      if (!ok) return;
    } else if (folders.length === 1 && items.length === 1) {
      const ok = window.confirm(`Download folder “${folders[0].name}”?`);
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await window.mirrox.downloadFs(
        serial,
        items.map((f) => f.path)
      );
      if (result.canceled) return;
      const failed = result.results.filter((r) => r.error);
      const okCount = result.results.length - failed.length;
      if (failed.length) {
        onToast(
          "error",
          failed.map((r) => `${r.remotePath.split("/").pop()}: ${r.error}`).join("\n")
        );
      }
      if (okCount > 0) {
        onToast("ok", `Downloaded ${okCount} item(s) to ${result.destDir}`);
        if (result.destDir) void window.mirrox.openPath(result.destDir);
      }
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setBusy(false);
      setProgress(null);
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

  const menuDownloadable = menuTargets;
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
            Upload files…
          </button>
          <button className="btn" disabled={disabled || busy} onClick={() => void onUploadFolder()}>
            Upload folder…
          </button>
          <button
            className="btn primary"
            disabled={disabled || busy || selectedItems.length === 0}
            onClick={() => void onDownload()}
          >
            Download{selectedItems.length ? ` (${selectedItems.length})` : ""}
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
            disabled={
              disabled || busy || selectedItems.length !== 1 || Boolean(selectedItems[0]?.isDirectory)
            }
            onClick={() => void onPreview()}
          >
            Preview
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

      {progress && (
        <div className="transfer-progress">
          <div className="transfer-progress-row">
            <span>
              {progress.message}
              {progress.percent != null ? ` ${Math.round(progress.percent)}%` : ""}
            </span>
            <button type="button" className="btn" onClick={() => void cancelTransfer()}>
              Cancel
            </button>
          </div>
          {progress.percent != null && (
            <div className="transfer-bar">
              <div
                className="transfer-bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
              />
            </div>
          )}
        </div>
      )}

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
                  else void onPreview(entry);
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
        Double-click a folder to open, or a file to preview. Right-click for actions. Click to
        select (⌘/Ctrl for multi). Drop files or folders onto the list to upload. APKs install
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
                {menuSingle && !menuSingle.isDirectory && (
                  <button
                    type="button"
                    className="fs-menu-item"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      void onPreview(menuSingle);
                    }}
                  >
                    Preview
                  </button>
                )}
                {menuDownloadable.length > 0 && (
                  <button
                    type="button"
                    className="fs-menu-item"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      void onDownloadItems(menuDownloadable);
                    }}
                  >
                    Download{menuDownloadable.length > 1 ? ` (${menuDownloadable.length})` : ""}
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
                    <button
                      type="button"
                      className="fs-menu-item"
                      role="menuitem"
                      onClick={() => {
                        closeMenu();
                        void onGetInfo(menuSingle);
                      }}
                    >
                      Get Info
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

      {fileInfo && (
        <div className="fs-dialog-backdrop" onClick={() => !busy && closeFileInfo()}>
          <div
            className="fs-dialog fs-info-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={fileInfo.noPreview ? "Can't preview" : "Get Info"}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeFileInfo();
            }}
          >
            <h4>{fileInfo.noPreview ? "Can't preview" : "Get Info"}</h4>
            {fileInfo.noPreview && (
              <p className="fs-dialog-body">No in-app preview for this file type.</p>
            )}
            <dl className="fs-info-grid">
              <div className="fs-info-row">
                <dt>Name</dt>
                <dd>{fileInfo.name}</dd>
              </div>
              <div className="fs-info-row">
                <dt>Kind</dt>
                <dd>{fileInfo.isDirectory ? "Folder" : "File"}</dd>
              </div>
              <div className="fs-info-row">
                <dt>Path</dt>
                <dd className="fs-info-path">{fileInfo.path}</dd>
              </div>
              <div className="fs-info-row">
                <dt>Size</dt>
                <dd>
                  {fileInfo.size != null ? formatBytes(fileInfo.size) : "—"}
                  {fileInfo.isDirectory && fileInfo.itemCount != null
                    ? ` · ${fileInfo.itemCount} item${fileInfo.itemCount === 1 ? "" : "s"}`
                    : ""}
                </dd>
              </div>
              <div className="fs-info-row">
                <dt>Modified</dt>
                <dd>{formatModified(fileInfo.modifiedAt)}</dd>
              </div>
              {fileInfo.permissions && (
                <div className="fs-info-row">
                  <dt>Permissions</dt>
                  <dd>{fileInfo.permissions}</dd>
                </div>
              )}
              {(fileInfo.owner || fileInfo.group) && (
                <div className="fs-info-row">
                  <dt>Owner</dt>
                  <dd>
                    {[fileInfo.owner, fileInfo.group].filter(Boolean).join(" : ")}
                  </dd>
                </div>
              )}
            </dl>
            <div className="fs-dialog-actions">
              {fileInfo.noPreview && !fileInfo.isDirectory && (
                <>
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => {
                      void onDownloadItems([
                        {
                          name: fileInfo.name,
                          path: fileInfo.path,
                          isDirectory: false,
                        },
                      ]);
                    }}
                  >
                    Download…
                  </button>
                  <button
                    className="btn"
                    disabled={busy || !fileInfo.tempPath}
                    onClick={() => void openInfoExternally()}
                  >
                    Open externally
                  </button>
                </>
              )}
              <button
                className={`btn ${fileInfo.noPreview ? "" : "primary"}`}
                disabled={busy}
                autoFocus
                onClick={closeFileInfo}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {filePreview && (
        <div className="modal-backdrop" onClick={() => void closeFilePreview()}>
          <div
            className="modal file-preview-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="File preview"
          >
            <div className="modal-header">
              <div className="file-preview-title">
                <h3>{filePreview.name}</h3>
                {filePreview.size > 0 && (
                  <span className="file-preview-meta">{formatBytes(filePreview.size)}</span>
                )}
              </div>
              <button className="btn" onClick={() => void closeFilePreview()} disabled={busy}>
                Close
              </button>
            </div>
            <div className="modal-preview file-preview-body">
              {filePreview.kind === "image" && filePreview.dataUrl && (
                <img src={filePreview.dataUrl} alt={filePreview.name} />
              )}
              {filePreview.kind === "text" && (
                <pre className="file-preview-text">{filePreview.text}</pre>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => {
                  void onDownloadItems([
                    {
                      name: filePreview.name,
                      path: filePreview.remotePath,
                      isDirectory: false,
                    },
                  ]);
                }}
              >
                Download…
              </button>
              <button className="btn" disabled={busy} onClick={() => void openPreviewExternally()}>
                Open externally
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
