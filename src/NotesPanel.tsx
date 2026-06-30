import { Plus, Trash2, X } from "lucide-react";
import { useHost } from "./useHost.ts";
import { EditableLabel } from "./EditableLabel.tsx";
import {
  ConflictBanner,
  NewNoteMenu,
  NoteEditorBody,
  NoteWidthToggle,
  useNoteEditor,
} from "./noteEditor.tsx";

// Multi-note workspace per session. Zero notes → identical UX to the prior
// single-textarea panel: one editor with a "Write a note…" placeholder; the
// first keystroke silently creates the note. Two-or-more notes → a compact
// list of titles above the editor; clicking switches active note (persisted
// server-side via Session.activeNoteId).
export function NotesPanel({
  sessionId,
  variant = "panel",
  onClose,
}: {
  sessionId: string;
  variant?: "panel" | "modal";
  onClose?: () => void;
}) {
  const host = useHost();
  // Reactive: the header label updates live if the session is renamed.
  const label = host.context.select((s) => s.sessions[sessionId]?.label ?? "—");
  const editor = useNoteEditor(host, { kind: "session", sessionId });
  const {
    notes,
    resolvedActiveId,
    activeNote,
    conflicted,
    onCreate,
    onSwitch,
    onDelete,
    onRename,
    keepMine,
    takeTheirs,
  } = editor;

  const editorContent = activeNote?.content ?? "";
  const showList = notes.length >= 2;
  const chars = editorContent.length;
  const words = editorContent.trim() ? editorContent.trim().split(/\s+/).length : 0;

  const isDiagram = activeNote?.type === "excalidraw";
  const diagramElements = (() => {
    if (!isDiagram) return 0;
    try {
      return ((JSON.parse(editorContent).elements ?? []) as unknown[]).length;
    } catch {
      return 0;
    }
  })();

  return (
    <div className="h-full flex flex-col min-h-0">
      {variant === "modal" ? (
        <div className="flex items-center gap-1 px-2 h-11 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1">
            {notes.map((n) => {
              const active = n.id === resolvedActiveId;
              return (
                <button
                  key={n.id}
                  onClick={() => onSwitch(n.id)}
                  title={n.title}
                  className={`text-xs px-2.5 py-1 rounded-md whitespace-nowrap shrink-0 ${
                    active
                      ? "bg-[var(--panel)] border border-[var(--border-2)] text-[var(--text)] font-medium"
                      : "border border-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  }`}
                >
                  {n.title}
                </button>
              );
            })}
          </div>
          <NewNoteMenu
            onPick={onCreate}
            buttonClassName="grid place-items-center w-7 h-7 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
          >
            <Plus size={14} />
          </NewNoteMenu>
          {onClose && (
            <button
              onClick={onClose}
              className="grid place-items-center w-7 h-7 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] shrink-0"
              title="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] text-xs shrink-0">
            <span className="text-[var(--muted)] truncate">
              For session: <span className="font-semibold text-[var(--text)]">{label}</span>
            </span>
            <NewNoteMenu
              onPick={onCreate}
              buttonClassName="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"
            >
              <Plus size={14} /> New
            </NewNoteMenu>
          </div>

          {showList && (
            <div className="px-2 py-2 border-b border-[var(--border)] space-y-0.5 max-h-48 overflow-y-auto shrink-0">
              {notes.map((n) => {
                const active = n.id === resolvedActiveId;
                return (
                  <div
                    key={n.id}
                    onClick={() => onSwitch(n.id)}
                    className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm ${
                      active
                        ? "bg-[var(--panel)] border border-[var(--border-2)] text-[var(--text)] font-medium shadow-sm"
                        : "border border-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                    }`}
                  >
                    <EditableLabel
                      value={n.title}
                      onCommit={(v) => onRename(n.id, v)}
                      className="truncate flex-1"
                      bubble
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(n.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover-none:opacity-100 text-[var(--faint)] hover:text-red-400 shrink-0"
                      title="Delete note"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {conflicted && <ConflictBanner onKeepMine={keepMine} onTakeTheirs={takeTheirs} />}

      <div className="flex-1 min-h-0">
        <NoteEditorBody editor={editor} showToolbar={variant === "modal"} forceHeading={false} />
      </div>

      <div className="flex items-center px-3 h-6 border-t border-[var(--border)] mono text-[11px] text-[var(--faint)] shrink-0">
        {isDiagram ? (
          <span>{diagramElements} element(s)</span>
        ) : (
          <span>
            {words} word(s) · {chars} char(s)
          </span>
        )}
        {!isDiagram && variant === "modal" && (
          <NoteWidthToggle
            value={activeNote?.widthPreset ?? "default"}
            onChange={editor.onSetWidth}
            disabled={!activeNote}
          />
        )}
      </div>
    </div>
  );
}
