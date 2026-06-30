import { useEffect, useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { useHost } from "./useHost.ts";
import { CwdPickerModal } from "./CwdPickerModal.tsx";
import { ConflictBanner, NoteEditorBody, NoteWidthToggle } from "./noteEditor.tsx";
import type { NoteEditorAPI } from "./noteEditor.tsx";
import { TocSidebar } from "./editor/TocSidebar.tsx";
import { shallowEqual } from "@tabterm/module-host/client";

export function WorkspaceNotesMain({ tabId, editor }: { tabId: string; editor: NoteEditorAPI }) {
  const host = useHost();
  // WorkspaceNotesMain only renders for the active workspace; reactively select
  // its cwd/label + focusEpoch. shallow eq avoids re-render on unrelated changes.
  const ctx = host.context.select((s) => {
    const ws = s.activeWorkspaceId ? s.workspaces[s.activeWorkspaceId] : null;
    return { cwd: ws?.cwd ?? null, label: ws?.label ?? null, focusEpoch: s.focusEpoch };
  }, shallowEqual);
  const { activeNote, conflicted, editorRef, keepMine, takeTheirs } = editor;
  const [pickerOpen, setPickerOpen] = useState(false);

  // Focus the terminal when focusEpoch changes.
  useEffect(() => {
    if (ctx.focusEpoch === 0) return;
    requestAnimationFrame(() => editorRef.current?.commands.focus());
  }, [ctx.focusEpoch]);

  const editorContent = activeNote?.content ?? "";
  const isDiagram = activeNote?.type === "excalidraw";
  const chars = editorContent.length;
  const words = editorContent.trim() ? editorContent.trim().split(/\s+/).length : 0;
  const diagramElements = (() => {
    if (!isDiagram) return 0;
    try { return ((JSON.parse(editorContent).elements ?? []) as unknown[]).length; }
    catch { return 0; }
  })();

  const cwd = ctx.cwd ?? "";
  const label = ctx.label ?? "workspace";

  return (
    <div className="flex-1 min-w-0 float-card flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-11 border-b border-[var(--border)] shrink-0">
        <ChevronRight size={15} className="text-[var(--accent-soft)] shrink-0" />
        <span className="mono text-xs font-semibold tracking-wider uppercase text-[var(--accent-soft)] truncate">
          Notes · {label}
        </span>
        <div className="ml-auto flex items-center gap-3 mono text-[11px]">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 px-2 h-7 rounded-md border border-[var(--border-2)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)]"
            title="Default working directory for new subtabs in this workspace."
          >
            <Folder size={13} className="shrink-0" />
            <span className="mono text-xs max-w-[280px] truncate">{cwd || "~"}</span>
          </button>
        </div>
      </div>

      {conflicted && <ConflictBanner onKeepMine={keepMine} onTakeTheirs={takeTheirs} />}

      <div className="flex-1 min-h-0 flex">
        {!isDiagram && <TocSidebar editorRef={editorRef} />}
        <div className="flex-1 min-w-0 flex flex-col">
          <NoteEditorBody editor={editor} />
        </div>
      </div>

      <div className="flex items-center px-3 h-6 border-t border-[var(--border)] mono text-[11px] text-[var(--faint)] shrink-0">
        <span>
          {isDiagram ? `${diagramElements} element(s)` : `${words} word(s) · ${chars} char(s)`}
        </span>
        {!isDiagram && (
          <NoteWidthToggle
            value={activeNote?.widthPreset ?? "default"}
            onChange={editor.onSetWidth}
            disabled={!activeNote}
          />
        )}
        {activeNote && <span className="ml-auto">edited {relativeTime(activeNote.updatedAt)}</span>}
      </div>

      {pickerOpen && (
        <CwdPickerModal
          initial={cwd}
          onClose={() => setPickerOpen(false)}
          onSelect={(path) => { host.workspaces.setCwd(tabId, path); setPickerOpen(false); }}
        />
      )}
    </div>
  );
}

function relativeTime(unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
