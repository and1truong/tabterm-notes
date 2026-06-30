import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpToLine,
  Check,
  ChevronDown,
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  MoreHorizontal,
  Plus,
  Shapes,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useHost } from "./useHost.ts";
import { shallowEqual } from "@tabterm/module-host/client";
import { useNotesAll, useFoldersAll } from "./store.ts";
import { uuid } from "./uuid.ts";
import type { Note, NoteFolder } from "../shared.ts";
import { EditableLabel } from "./EditableLabel.tsx";
import type { NoteEditorAPI } from "./noteEditor.tsx";
import { NewNoteMenu } from "./noteEditor.tsx";
import { Tooltip } from "./Tooltip.tsx";
import { relTime } from "./relTime.ts";

type Scope = "workspace" | "sessions";

// Drag payload + the collapse key for the virtual "Unsorted" bucket (folderId
// null can't index a Set, so it gets a reserved string key).
const NOTE_MIME = "text/note-id";
const UNSORTED_KEY = "__unsorted__";

// WorkspaceNotesList receives the editor API from its parent (Task 16 wires
// main+list to ONE shared useNoteEditor instance). The prop interface matches
// the fields WorkspaceNotesList uses from the editor.
export function WorkspaceNotesList({
  tabId,
  editor,
}: {
  tabId: string;
  editor: NoteEditorAPI;
}) {
  const host = useHost();
  // Notes + folders reactive via host.store (15c selectors — no allocation inside selector).
  // Sessions map selected reactively (shallow eq) so group headers update live when a
  // session is renamed/closed, not just on the next unrelated render.
  const allNotes = useNotesAll(host);
  const allFolders = useFoldersAll(host);
  const sessions = host.context.select((s) => s.sessions, shallowEqual);
  const {
    notes: ownNotesUnsorted,
    resolvedActiveId,
    onCreate, onSwitch, onDelete, onRename,
  } = editor;

  const [scope, setScope] = useState<Scope>("workspace");
  const [confirmPromoteId, setConfirmPromoteId] = useState<string | null>(null);
  // Collapsed folder keys (folder id or UNSORTED_KEY); default = all expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // When set, the inline create-folder row is shown. `forNoteId` (if present) is
  // moved into the freshly-created folder, so "New folder…" in a note's move
  // menu both creates and files in one step.
  const [creating, setCreating] = useState<{ forNoteId: string | null } | null>(null);
  // Which note's move-to-folder popover is open (one at a time).
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  // Which note's title is being renamed — disables that row's drag so text
  // selection in the input doesn't start a drag (mirrors the bookmarks panel).
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  // Drop-target highlight key while dragging a note over a folder header.
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const ownNotes = useMemo<Note[]>(
    () =>
      [...ownNotesUnsorted].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.position - b.position;
      }),
    [ownNotesUnsorted],
  );

  const folders = useMemo<NoteFolder[]>(
    () =>
      Object.values(allFolders)
        .filter((f) => f.primaryTabId === tabId)
        .sort((a, b) => a.position - b.position),
    [allFolders, tabId],
  );

  // Group other-session notes by session. Reads the reactively-selected sessions
  // map so renames/closes reflect live (memo re-runs when `sessions` changes).
  const otherSessionsNotes = useMemo<{ sessionId: string; label: string; kind: string; position: number; notes: Note[] }[]>(() => {
    const byId: Record<string, Note[]> = {};
    for (const n of Object.values(allNotes)) {
      if (n.sessionId === null) continue;
      const sess = sessions[n.sessionId];
      if (!sess || sess.primaryTabId !== tabId || sess.closedAt != null) continue;
      (byId[n.sessionId] ??= []).push(n);
    }
    return Object.entries(byId)
      .map(([sid, ns]) => {
        const sess = sessions[sid];
        return {
          sessionId: sid,
          label: sess?.label ?? sid,
          kind: sess?.kind ?? "",
          position: sess?.position ?? 0,
          notes: ns.sort((a, b) => a.position - b.position),
        };
      })
      .sort((a, b) => a.position - b.position);
  }, [allNotes, tabId, sessions]);
  const totalOther = otherSessionsNotes.reduce((a, g) => a + g.notes.length, 0);

  useEffect(() => {
    if (!confirmPromoteId) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-promote-wrap]")) setConfirmPromoteId(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirmPromoteId(null); };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }, [confirmPromoteId]);

  useEffect(() => {
    if (!moveMenuFor) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-move-wrap]")) setMoveMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoveMenuFor(null); };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }, [moveMenuFor]);

  const onTogglePin = (note: Note) =>
    host.send({ type: "note:setPinned", noteId: note.id, pinned: !note.pinned });
  const onPromote = (noteId: string) => {
    host.send({ type: "note:promote", noteId, targetPrimaryTabId: tabId });
    setConfirmPromoteId(null);
  };
  const onMoveNote = (noteId: string, folderId: string | null) => {
    host.send({ type: "note:move", noteId, folderId });
    setMoveMenuFor(null);
  };
  const onRenameFolder = (f: NoteFolder, label: string) => {
    const trimmed = label.trim();
    if (!trimmed || trimmed === f.label) return;
    host.send({ type: "noteFolder:update", folderId: f.id, label: trimmed });
  };
  const onDeleteFolder = (f: NoteFolder) => {
    if (!window.confirm(`Delete folder "${f.label}"? Notes inside move to Unsorted.`)) return;
    host.send({ type: "noteFolder:delete", folderId: f.id });
  };
  // Create a folder, optionally moving a note into it once it exists. Messages
  // are processed in order, so the move lands after the create.
  const commitNewFolder = (label: string) => {
    const id = uuid();
    host.send({ type: "noteFolder:create", id, primaryTabId: tabId, label });
    if (creating?.forNoteId) host.send({ type: "note:move", noteId: creating.forNoteId, folderId: id });
    setCreating(null);
  };
  const toggleCollapse = (key: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Drag-and-drop: a note dropped on a folder header (or Unsorted) is moved there.
  const isNoteDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(NOTE_MIME);
  const onRowDragStart = (noteId: string) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(NOTE_MIME, noteId);
  };
  const onFolderDragOver = (key: string) => (e: React.DragEvent) => {
    if (!isNoteDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverKey !== key) setDragOverKey(key);
  };
  const onFolderDrop = (folderId: string | null) => (e: React.DragEvent) => {
    if (!isNoteDrag(e)) return;
    e.preventDefault();
    const id = e.dataTransfer.getData(NOTE_MIME);
    setDragOverKey(null);
    if (id) onMoveNote(id, folderId);
  };

  const pinned = ownNotes.filter((n) => n.pinned);
  const unpinned = ownNotes.filter((n) => !n.pinned);
  const unsorted = unpinned.filter((n) => n.folderId === null);
  const hasFolders = folders.length > 0;

  const renderNote = (n: Note) => (
    <NoteRow
      key={n.id}
      note={n}
      active={n.id === resolvedActiveId}
      folders={folders}
      draggable={editingTitleId !== n.id}
      menuOpen={moveMenuFor === n.id}
      editing={editingTitleId === n.id}
      onEditingChange={(v) => setEditingTitleId(v ? n.id : null)}
      onDragStart={onRowDragStart(n.id)}
      onToggleMenu={() => setMoveMenuFor((cur) => (cur === n.id ? null : n.id))}
      onMove={onMoveNote}
      onNewFolder={() => { setMoveMenuFor(null); setCreating({ forNoteId: n.id }); }}
      onSwitch={onSwitch}
      onRename={onRename}
      onDelete={onDelete}
      onTogglePin={onTogglePin}
    />
  );

  return (
    <div className="w-60 shrink-0 float-card overflow-hidden flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] shrink-0">
        <span className="text-xs text-[var(--muted)]">
          {scope === "workspace"
            ? `${ownNotes.length} note${ownNotes.length === 1 ? "" : "s"}${
                hasFolders ? ` · ${folders.length} folder${folders.length === 1 ? "" : "s"}` : ""
              }`
            : `${totalOther} note${totalOther === 1 ? "" : "s"} · ${otherSessionsNotes.length} session${otherSessionsNotes.length === 1 ? "" : "s"}`}
        </span>
        {scope === "workspace" && (
          <NewNoteMenu
            key={scope}
            onPick={onCreate}
            onNewFolder={() => setCreating({ forNoteId: null })}
            buttonClassName="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
          >
            <Plus size={13} /> New
          </NewNoteMenu>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {scope === "workspace" ? (
          <>
            {creating && (
              <NewFolderRow onCommit={commitNewFolder} onCancel={() => setCreating(null)} />
            )}

            {pinned.length > 0 && <SectionLabel>Pinned</SectionLabel>}
            {pinned.map(renderNote)}

            {hasFolders ? (
              <>
                {folders.map((f) => {
                  const kids = unpinned.filter((n) => n.folderId === f.id);
                  const open = !collapsed.has(f.id);
                  return (
                    <div key={f.id}>
                      <FolderHeader
                        label={f.label}
                        count={kids.length}
                        open={open}
                        dragOver={dragOverKey === f.id}
                        onToggle={() => toggleCollapse(f.id)}
                        onRename={(v) => onRenameFolder(f, v)}
                        onDelete={() => onDeleteFolder(f)}
                        onDragOver={onFolderDragOver(f.id)}
                        onDragLeave={() => setDragOverKey(null)}
                        onDrop={onFolderDrop(f.id)}
                      />
                      {open && <div className="pl-3">{kids.map(renderNote)}</div>}
                    </div>
                  );
                })}
                <FolderHeader
                  label="Unsorted"
                  count={unsorted.length}
                  open={!collapsed.has(UNSORTED_KEY)}
                  dragOver={dragOverKey === UNSORTED_KEY}
                  muted
                  onToggle={() => toggleCollapse(UNSORTED_KEY)}
                  onDragOver={onFolderDragOver(UNSORTED_KEY)}
                  onDragLeave={() => setDragOverKey(null)}
                  onDrop={onFolderDrop(null)}
                />
                {!collapsed.has(UNSORTED_KEY) && <div className="pl-3">{unsorted.map(renderNote)}</div>}
              </>
            ) : (
              <>
                <SectionLabel>{pinned.length > 0 ? "All" : "Notes"}</SectionLabel>
                {unpinned.length === 0 && pinned.length === 0 && !creating && (
                  <div className="px-3 py-6 text-xs text-[var(--faint)] text-center">
                    No notes yet — start writing.
                  </div>
                )}
                {unpinned.map(renderNote)}
              </>
            )}
          </>
        ) : (
          <>
            {otherSessionsNotes.length === 0 && (
              <div className="px-3 py-6 text-xs text-[var(--faint)] text-center">
                No notes in other sessions of this workspace.
              </div>
            )}
            {otherSessionsNotes.map(({ sessionId, label, kind, notes: list }) => (
              <div key={sessionId}>
                <SectionLabel>
                  <span className="truncate">
                    {label}
                    <span className="text-[var(--faint)] font-normal"> · {kind}</span>
                  </span>
                </SectionLabel>
                {list.map((n) => (
                  <PromoteRow key={n.id} note={n} sourceLabel={label}
                    confirming={confirmPromoteId === n.id}
                    onAsk={() => setConfirmPromoteId((cur) => (cur === n.id ? null : n.id))}
                    onConfirm={() => onPromote(n.id)}
                    onCancel={() => setConfirmPromoteId(null)} />
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-2 shrink-0">
        <div className="flex bg-[var(--bg)] border border-[var(--border)] rounded-lg p-0.5 gap-0.5">
          {(["workspace", "sessions"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`flex-1 text-[11px] font-medium py-1 rounded-md ${
                scope === s
                  ? "bg-[var(--panel)] text-[var(--text)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {s === "workspace" ? "Workspace" : "Sessions"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--faint)] font-semibold flex items-center gap-1.5">
      {children}
    </div>
  );
}

// Collapsible folder (or the virtual "Unsorted") header. Doubles as a drop
// target: dragging a note onto it files the note into this folder.
function FolderHeader({
  label,
  count,
  open,
  dragOver,
  muted,
  onToggle,
  onRename,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  label: string;
  count: number;
  open: boolean;
  dragOver: boolean;
  muted?: boolean;
  onToggle: () => void;
  onRename?: (v: string) => void;
  onDelete?: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onClick={onToggle}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group flex items-center gap-1.5 px-2 py-1.5 mt-1 rounded-lg cursor-pointer text-[12px] font-semibold select-none ${
        dragOver
          ? "bg-[var(--brand-bg)] text-[var(--brand-fg)] outline-2 outline-dashed outline-[var(--accent)] -outline-offset-2"
          : `text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]`
      }`}
    >
      <ChevronDown
        size={13}
        className={`shrink-0 text-[var(--faint)] transition-transform ${open ? "" : "-rotate-90"}`}
      />
      <span className={`shrink-0 ${muted ? "text-[var(--faint)]" : "text-[var(--accent)]"}`}>
        {muted ? <Inbox size={13} /> : <Folder size={13} />}
      </span>
      {onRename ? (
        <EditableLabel value={label} onCommit={onRename} className="truncate flex-1" bubble />
      ) : (
        <span className="truncate flex-1">{label}</span>
      )}
      <span className="text-[11px] text-[var(--faint)] font-normal">{count}</span>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 shrink-0 text-[var(--faint)] hover:text-red-400"
          title="Delete folder"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// Inline "name a new folder" row: an auto-focused input that creates on commit
// and dismisses on Esc/blur (reuses EditableLabel's controlled edit mode).
function NewFolderRow({
  onCommit,
  onCancel,
}: {
  onCommit: (label: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 mt-1 rounded-lg border border-[var(--accent)] bg-[var(--bg)]">
      <Folder size={13} className="shrink-0 text-[var(--accent)]" />
      <EditableLabel
        value=""
        editing
        onCommit={onCommit}
        onEditingChange={(v) => { if (!v) onCancel(); }}
        className="flex-1"
      />
    </div>
  );
}

function NoteRow({
  note,
  active,
  folders,
  draggable,
  menuOpen,
  editing,
  onEditingChange,
  onDragStart,
  onToggleMenu,
  onMove,
  onNewFolder,
  onSwitch,
  onRename,
  onDelete,
  onTogglePin,
}: {
  note: Note;
  active: boolean;
  folders: NoteFolder[];
  draggable: boolean;
  menuOpen: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onDragStart: (e: React.DragEvent) => void;
  onToggleMenu: () => void;
  onMove: (noteId: string, folderId: string | null) => void;
  onNewFolder: () => void;
  onSwitch: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (note: Note) => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={() => onSwitch(note.id)}
      className={`group relative flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm mb-0.5 ${
        active
          ? "bg-[var(--panel)] border border-[var(--border-2)] text-[var(--text)] font-medium shadow-sm"
          : "border border-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
      }`}
    >
      <span className="shrink-0 text-[var(--faint)]">
        {note.type === "excalidraw" ? <Shapes size={12} /> : <FileText size={12} />}
      </span>
      <EditableLabel
        value={note.title}
        onCommit={(v) => onRename(note.id, v)}
        editing={editing}
        onEditingChange={onEditingChange}
        className="truncate flex-1"
        bubble
      />
      {/* Rest state of the trailing slot: a pinned note shows its orange star
          indicator, others show last-edited time. The action cluster overlays
          this on hover (or when the move menu is pinned open); both share the
          slot so the swap causes no layout shift. */}
      {note.pinned ? (
        <span className="shrink-0 text-[var(--orange)] group-hover:opacity-0 hover-none:opacity-0" title="Pinned">
          <Star size={12} fill="currentColor" />
        </span>
      ) : (
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--faint)] group-hover:opacity-0 hover-none:opacity-0">
          {relTime(note.updatedAt)}
        </span>
      )}
      <span
        className={`absolute right-2 flex items-center gap-1.5 ${
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 hover-none:opacity-100"
        }`}
      >
        <span className="relative shrink-0" data-move-wrap>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
            className={`shrink-0 p-0.5 rounded ${
              menuOpen
                ? "text-[var(--text)] bg-[var(--hover)]"
                : "text-[var(--faint)] hover:text-[var(--text)]"
            }`}
            title="Move to folder"
          >
            <MoreHorizontal size={13} />
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-full right-0 mt-1 z-40 w-48 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] p-1 shadow-xl"
            >
              <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-[var(--faint)] font-semibold">
                Move to folder
              </div>
              {folders.map((f) => (
                <MoveItem
                  key={f.id}
                  icon={<Folder size={13} />}
                  label={f.label}
                  current={note.folderId === f.id}
                  onClick={() => onMove(note.id, f.id)}
                />
              ))}
              <MoveItem
                icon={<Inbox size={13} />}
                label="Unsorted"
                muted
                current={note.folderId === null}
                onClick={() => onMove(note.id, null)}
              />
              <div className="h-px bg-[var(--border)] my-1" />
              <button
                onClick={onNewFolder}
                className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-[13px] text-[var(--accent)] hover:bg-[var(--hover)]"
              >
                <FolderPlus size={13} /> New folder…
              </button>
            </div>
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(note); }}
          className={`shrink-0 ${
            note.pinned
              ? "text-[var(--orange)]"
              : "text-[var(--faint)] hover:text-[var(--text)]"
          }`}
          title={note.pinned ? "Unpin" : "Pin to top"}
        >
          <Star size={12} fill={note.pinned ? "currentColor" : "none"} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}
          className="text-[var(--faint)] hover:text-red-400 shrink-0"
          title="Delete note"
        >
          <Trash2 size={12} />
        </button>
      </span>
    </div>
  );
}

function MoveItem({
  icon,
  label,
  current,
  muted,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  current: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-[13px] hover:bg-[var(--hover)] ${
        muted ? "text-[var(--muted)]" : "text-[var(--text)]"
      }`}
    >
      <span className="shrink-0 text-[var(--faint)]">{icon}</span>
      <span className="truncate flex-1">{label}</span>
      {current && <Check size={13} className="shrink-0 text-[var(--accent)]" />}
    </button>
  );
}

function PromoteRow({
  note,
  sourceLabel,
  confirming,
  onAsk,
  onConfirm,
  onCancel,
}: {
  note: Note;
  sourceLabel: string;
  confirming: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-promote-wrap
      className="group relative flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm mb-0.5 border border-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
    >
      <span className="shrink-0 text-[var(--faint)]">
        {note.type === "excalidraw" ? <Shapes size={12} /> : <FileText size={12} />}
      </span>
      <span className="truncate flex-1">{note.title}</span>
      <span className="relative shrink-0">
        <Tooltip
          label={
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold">Promote to workspace notes</span>
              <span className="opacity-70">Shared across all sessions in this workspace</span>
            </div>
          }
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAsk();
            }}
            className={`${
              confirming
                ? "text-[var(--brand-fg)] bg-[var(--brand-bg)] opacity-100"
                : "opacity-0 group-hover:opacity-100 text-[var(--faint)] hover:text-[var(--brand-fg)] hover:bg-[var(--brand-bg)]"
            } p-1 rounded`}
          >
            <ArrowUpToLine size={12} />
          </button>
        </Tooltip>
        {confirming && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-full right-0 mt-2 z-40 w-56 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] p-2.5 shadow-xl"
          >
            <div className="text-xs text-[var(--text)] leading-snug mb-1">
              Promote <span className="font-semibold">{note.title}</span> to workspace notes?
            </div>
            <div className="text-[11px] text-[var(--muted)] mb-2 leading-snug">
              Moves it out of <span className="font-medium">{sourceLabel}</span>.
            </div>
            <div className="flex justify-end gap-1.5">
              <button
                onClick={onCancel}
                className="text-[11px] font-medium px-2 py-1 rounded-md border border-[var(--border-2)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="text-[11px] font-medium px-2 py-1 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-soft)] text-[var(--panel)]"
              >
                Promote
              </button>
            </div>
          </div>
        )}
      </span>
    </div>
  );
}
