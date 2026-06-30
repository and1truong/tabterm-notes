import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { ClientHost } from "@tabterm/module-host/client";
import type { Note, NoteType, NoteWidthPreset } from "../shared.ts";
import {
  useNotesAll,
  useActiveNoteId,
  useConflictIds,
  clearConflict,
  getConflictNote,
} from "./store.ts";
import { uuid } from "./uuid.ts";
import { TiptapEditor } from "./TiptapEditor.tsx";
import { isBlankNoteContent } from "./noteMarkdown.ts";
import { Tooltip } from "./Tooltip.tsx";
import Notice from "./Notice.tsx";
import type { NoteClientMessage } from "../shared.ts";

// Excalidraw is heavy (~1MB+); load it only when a diagram note is opened.
const ExcalidrawNote = lazy(() => import("./ExcalidrawNote.tsx"));

// Shared editing pipeline for any panel that hosts a session's or workspace's
// notes. Owns the debounced 300ms write queue, optimistic-concurrency base
// versions, conflict handling, and the pending-id dance used by the
// empty-state first-keystroke flow. Returns the active note plus action
// handlers so the consumer only supplies chrome and a way to render the
// rail/list around it.
//
// `resolvedActiveId` is intentionally stricter than the stored activeNoteId:
// a note must still belong to this target for it to resolve as active. This
// keeps the panel honest after a `note:promote` moved a note out from under it
// before the server's patch lands.
export type NoteTarget =
  | { kind: "session"; sessionId: string }
  | { kind: "workspace"; primaryTabId: string };

export function useNoteEditor(host: ClientHost, target: NoteTarget) {
  const scopeId =
    target.kind === "session" ? target.sessionId : target.primaryTabId;

  const storeActiveId = useActiveNoteId(host, scopeId);
  const notesAll = useNotesAll(host);
  const noteConflicts = useConflictIds(host);

  const notes = useMemo<Note[]>(
    () =>
      Object.values(notesAll)
        .filter((n) =>
          target.kind === "session"
            ? n.sessionId === target.sessionId
            : n.sessionId === null && n.primaryTabId === target.primaryTabId,
        )
        .sort((a, b) => a.position - b.position),
    [notesAll, target.kind === "session" ? target.sessionId : target.primaryTabId],
  );

  // Optimistic id minted before the server's note:create broadcast lands —
  // routes buffered edits to the just-created note instead of the previously
  // active one.
  const pendingId = useRef<string | null>(null);
  // Held so onSwitch can force-blur the editor, releasing TiptapEditor's
  // focused-guard so the new note's content actually loads.
  const editorRef = useRef<Editor | null>(null);
  // Pending content edits keyed by note id, flushed 300ms after the last
  // keystroke. Keying by note (not one shared timer) means switching notes
  // flushes the previous note's buffered edit instead of cancelling it.
  const pending = useRef<Map<string, string>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Latest markdown the editor emitted, kept so "keep mine" can force-write it.
  const latestMarkdown = useRef("");
  // Optimistic base version per note for OCC. Each accepted write bumps the
  // server version by one, so we advance our base by one per send (our own
  // echoes therefore don't read as conflicts). The editor re-anchors this to
  // the server's value via onContentLoaded whenever it passively reloads.
  const baseByNote = useRef<Map<string, number>>(new Map());
  // Bumped to force-remount the active diagram (used by conflict "take theirs",
  // since the canvas doesn't live-reload remote edits).
  const [diagramReload, setDiagramReload] = useState(0);

  const resolvedActiveId = useMemo(() => {
    const belongs = (n: Note) =>
      target.kind === "session"
        ? n.sessionId === target.sessionId
        : n.sessionId === null && n.primaryTabId === target.primaryTabId;
    if (storeActiveId && notesAll[storeActiveId] && belongs(notesAll[storeActiveId]))
      return storeActiveId;
    if (
      pendingId.current &&
      notesAll[pendingId.current] &&
      belongs(notesAll[pendingId.current])
    )
      return pendingId.current;
    return notes[0]?.id ?? null;
  }, [storeActiveId, notesAll, notes, target]);

  // Clear the optimistic id once the store has caught up.
  useEffect(() => {
    if (pendingId.current && storeActiveId === pendingId.current) {
      pendingId.current = null;
    }
  }, [storeActiveId]);

  const activeNote = resolvedActiveId ? notesAll[resolvedActiveId] ?? null : null;
  const conflicted = !!activeNote && noteConflicts.has(activeNote.id);

  const noteCreatePayload = (id: string, noteType?: NoteType): NoteClientMessage => {
    if (target.kind === "session") {
      return { type: "note:create", sessionId: target.sessionId, id, noteType };
    }
    return { type: "note:create", primaryTabId: target.primaryTabId, id, noteType };
  };

  // note:setActive now takes scopeId directly — no tab:setActiveNote branch.
  const setActivePayload = (noteId: string): NoteClientMessage =>
    ({ type: "note:setActive", scopeId, noteId }) as const;

  const flushPending = () => {
    clearTimeout(timer.current);
    for (const [noteId, content] of pending.current) {
      // Read the store directly: the unmount cleanup calls this from a closure
      // whose `notesAll` snapshot is stale.
      const base =
        baseByNote.current.get(noteId) ?? host.store.getState().note?.[noteId]?.version ?? 1;
      host.send({ type: "note:update", noteId, content, baseVersion: base });
      baseByNote.current.set(noteId, base + 1); // optimistic: assume accepted
    }
    pending.current.clear();
  };

  const queueContent = (noteId: string, content: string) => {
    pending.current.set(noteId, content);
    clearTimeout(timer.current);
    timer.current = setTimeout(flushPending, 300);
  };

  // Flush buffered edits on unmount so the last keystrokes aren't lost.
  useEffect(() => () => flushPending(), []);

  const handleChange = (markdown: string) => {
    latestMarkdown.current = markdown;
    // No active note yet → mint one. Subsequent keystrokes route normally.
    if (!activeNote && !pendingId.current) {
      // Don't create a note for an empty editor. Session notes emit "" here; workspace
      // notes force a leading heading, so init noise emits "#"/"# ". Both are "no content".
      if (isBlankNoteContent(markdown)) return;
      const id = uuid();
      pendingId.current = id;
      host.send(noteCreatePayload(id));
      queueContent(id, markdown);
      return;
    }
    // Prefer pendingId so keystrokes between "+ New note" click and the
    // server's broadcast route to the just-created note, not the old active one.
    const targetId = pendingId.current ?? activeNote?.id;
    if (!targetId) return;
    queueContent(targetId, markdown);
  };

  // Diagram edits route through the same debounced OCC pipeline as markdown.
  // `latestMarkdown` is reused as "latest content" so conflict "keep mine"
  // force-writes the current scene too.
  const handleDiagramChange = (json: string) => {
    if (!activeNote) return;
    latestMarkdown.current = json;
    queueContent(activeNote.id, json);
  };

  const onCreate = (noteType: NoteType = "markdown") => {
    flushPending();
    const id = uuid();
    pendingId.current = id;
    // Drop editor focus so its content-sync effect picks up the new empty note
    // when the broadcast lands instead of holding the previous note's content.
    editorRef.current?.commands.blur();
    host.send(noteCreatePayload(id, noteType));
  };

  const onSwitch = (noteId: string) => {
    if (noteId === resolvedActiveId) return;
    flushPending();
    editorRef.current?.commands.blur();
    host.send(setActivePayload(noteId));
  };

  const onDelete = (noteId: string) => host.send({ type: "note:delete", noteId });
  const onRename = (noteId: string, title: string) =>
    host.send({ type: "note:update", noteId, title });
  // Width is a per-note view preference. Routed through note:update like the
  // title field; the server applies it without OCC (no baseVersion) and does
  // not bump version, so this can't collide with an in-flight content edit.
  const onSetWidth = (preset: NoteWidthPreset) => {
    if (!resolvedActiveId) return;
    host.send({ type: "note:update", noteId: resolvedActiveId, widthPreset: preset });
  };

  const onContentLoaded = (v: number) => {
    if (resolvedActiveId) baseByNote.current.set(resolvedActiveId, v);
  };

  // Conflict resolution.
  //
  // The module service (Task 13) on a stale write does:
  //   sync.toSender({ type: "module:patch", entity: "conflict", op: "set",
  //                   data: { id: note.id, note: note } })
  // and does NOT emit sync.set("note", ...). So the main `note` store is NOT
  // updated on conflict — the authoritative note lives ONLY in the conflict
  // bucket. keepMine therefore reads the authoritative version from
  // getConflictNote (the conflict bucket) so the force-write is based on the
  // server's current version, not our stale base. takeTheirs patches the
  // authoritative note back into the note store so the editor reloads it.
  const keepMine = () => {
    if (!activeNote) return;
    const authoritative = getConflictNote(host, activeNote.id) ?? activeNote;
    pending.current.delete(activeNote.id);
    host.send({
      type: "note:update",
      noteId: activeNote.id,
      content: latestMarkdown.current,
      baseVersion: authoritative.version,
    });
    baseByNote.current.set(activeNote.id, authoritative.version + 1); // optimistic
    clearConflict(host, activeNote.id);
    editorRef.current?.commands.blur();
  };

  const takeTheirs = () => {
    if (!activeNote) return;
    const authoritative = getConflictNote(host, activeNote.id);
    pending.current.delete(activeNote.id);
    if (authoritative) host.store.patch({ entity: "note", op: "set", data: authoritative });
    clearConflict(host, activeNote.id);
    baseByNote.current.set(activeNote.id, (authoritative ?? activeNote).version);
    editorRef.current?.commands.blur();
    setDiagramReload((n) => n + 1);
  };

  return {
    notes,
    resolvedActiveId,
    activeNote,
    conflicted,
    editorRef,
    diagramReload,
    handleChange,
    handleDiagramChange,
    onCreate,
    onSwitch,
    onDelete,
    onRename,
    onSetWidth,
    onContentLoaded,
    keepMine,
    takeTheirs,
  };
}

export type NoteEditorAPI = ReturnType<typeof useNoteEditor>;

export function ConflictBanner({
  onKeepMine,
  onTakeTheirs,
}: {
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  return (
    <Notice
      variant="warning"
      layout="bar"
      title="Changed elsewhere"
      className="shrink-0 text-xs"
      actions={
        <>
          <Tooltip
            label={
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">Overwrite remote with yours</span>
                <span className="opacity-70">Your version replaces the saved one</span>
              </div>
            }
          >
            <button
              onClick={onKeepMine}
              className="px-2 py-0.5 rounded font-medium border border-[color-mix(in_srgb,var(--orange)_45%,var(--border))] bg-[color-mix(in_srgb,var(--orange)_12%,transparent)] text-[var(--orange)] hover:bg-[color-mix(in_srgb,var(--orange)_22%,transparent)] shrink-0"
            >
              Keep mine
            </button>
          </Tooltip>
          <Tooltip
            label={
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">Discard your changes</span>
                <span className="opacity-70">Reload the saved remote version</span>
              </div>
            }
          >
            <button
              onClick={onTakeTheirs}
              className="px-2 py-0.5 rounded hover:bg-[var(--hover)] text-[var(--muted)] shrink-0"
            >
              Take theirs
            </button>
          </Tooltip>
        </>
      }
    >
      Your edit was based on an older version.
    </Notice>
  );
}

// Editor render: branches on the active note's type (markdown vs excalidraw).
// Shared so the TiptapEditor/ExcalidrawNote dispatch lives in exactly one place.
export function NoteEditorBody({
  editor,
  showToolbar = true,
  forceHeading = true,
}: {
  editor: NoteEditorAPI;
  showToolbar?: boolean;
  // Forwarded to TiptapEditor: workspace notes force a leading heading, session
  // notes don't. Default true preserves the workspace/modal behavior.
  forceHeading?: boolean;
}) {
  const { activeNote, editorRef, diagramReload } = editor;
  if (activeNote?.type === "excalidraw") {
    return (
      <Suspense fallback={<div className="p-4 text-xs text-[var(--muted)]">Loading diagram…</div>}>
        <ExcalidrawNote
          key={`${activeNote.id}:${diagramReload}`}
          content={activeNote.content}
          onChange={editor.handleDiagramChange}
        />
      </Suspense>
    );
  }
  return (
    <TiptapEditor
      content={activeNote?.content ?? ""}
      version={activeNote?.version ?? 0}
      widthPreset={activeNote?.widthPreset ?? "default"}
      onChange={editor.handleChange}
      onContentLoaded={editor.onContentLoaded}
      placeholder={activeNote ? "Write…" : "Write a note…"}
      editorRef={editorRef}
      showToolbar={showToolbar}
      forceHeading={forceHeading}
    />
  );
}

// "+ New" trigger + Note/Diagram chooser. Owns its open state and dismisses on
// outside-click or Esc. Unmounting (e.g. parent flips the rail scope) resets
// the menu to closed, so callers don't have to manage it manually.
export function NewNoteMenu({
  onPick,
  buttonClassName,
  children,
  onNewFolder,
}: {
  onPick: (type: NoteType) => void;
  buttonClassName: string;
  children: React.ReactNode;
  // When provided, the menu shows a "New folder" item below a divider (only the
  // workspace-notes rail passes this; session-note panels have no folders).
  onNewFolder?: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-new-note-menu]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div data-new-note-menu className="relative shrink-0">
      <button
        onClick={(e) => {
          // Prevent the document listener from immediately closing on the same tick.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={buttonClassName}
        title="New note or diagram"
      >
        {children}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 min-w-28 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] py-1 shadow-lg text-sm">
          <button
            onClick={() => {
              setOpen(false);
              onPick("markdown");
            }}
            className="block w-full text-left px-3 py-1.5 text-[var(--text)] hover:bg-[var(--hover)]"
          >
            Note
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onPick("excalidraw");
            }}
            className="block w-full text-left px-3 py-1.5 text-[var(--text)] hover:bg-[var(--hover)]"
          >
            Diagram
          </button>
          {onNewFolder && (
            <>
              <div className="h-px bg-[var(--border)] my-1" />
              <button
                onClick={() => {
                  setOpen(false);
                  onNewFolder();
                }}
                className="block w-full text-left px-3 py-1.5 text-[var(--text)] hover:bg-[var(--hover)]"
              >
                New folder
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Status-bar width segmented control: Default (68ch) / Wider (100ch) / Full.
// The active note's preset drives the prose column (see TiptapEditor). Bakes in
// `ml-auto` so it docks to the right of the status bar in both note surfaces.
const WIDTH_SEGMENTS: { value: NoteWidthPreset; label: string; title: string; w: number }[] = [
  { value: "default", label: "Default", title: "Default reading width (68ch)", w: 5 },
  { value: "wider", label: "Wider", title: "Wider column (100ch)", w: 9 },
  { value: "full", label: "Full", title: "Fill the whole editor", w: 13 },
];

export function NoteWidthToggle({
  value,
  onChange,
  disabled,
}: {
  value: NoteWidthPreset;
  onChange: (preset: NoteWidthPreset) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 ml-auto shrink-0" role="group" aria-label="Content width">
      {WIDTH_SEGMENTS.map((s) => {
        const active = value === s.value;
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(s.value)}
            title={s.title}
            className={`inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[5px] border text-[10.5px] leading-none ${
              active
                ? "bg-[var(--panel)] border-[var(--border-2)] text-[var(--text)] shadow-sm"
                : "border-transparent text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
            } ${disabled ? "opacity-40 cursor-default" : "cursor-pointer"}`}
          >
            <svg width="13" height="10" viewBox="0 0 13 10" aria-hidden="true">
              <rect x="0" y="1" width={s.w} height="8" rx="1" fill="currentColor" />
            </svg>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
