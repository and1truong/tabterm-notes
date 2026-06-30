import { HostCtx } from "./useHost.ts";
import type { ClientHost } from "@tabterm/module-host/client";
import { WorkspaceNotesList } from "./WorkspaceNotesList.tsx";
import { WorkspaceNotesMain } from "./WorkspaceNotesMain.tsx";
import { useNoteEditor } from "./noteEditor.tsx";
import { useInitialLoad } from "./useInitialLoad.ts";

// Inner component: runs INSIDE the provider so it (and the editor hook) can use
// useHost(). Reads the active workspace id from host.context.
function NotesModeInner({ host }: { host: ClientHost }) {
  useInitialLoad(host);
  // Reactively track just the active workspace id — re-renders only when it changes.
  const tabId = host.context.select((s) => s.activeWorkspaceId);
  // The shared editor instance for the workspace scope — passed to BOTH panes.
  const editor = useNoteEditor(host, { kind: "workspace", primaryTabId: tabId ?? "" });
  if (!tabId) return null;
  return (
    <div className="flex-1 flex min-h-0 gap-2">
      <WorkspaceNotesList tabId={tabId} editor={editor} />
      <WorkspaceNotesMain tabId={tabId} editor={editor} />
    </div>
  );
}

export function NotesMode({ host }: { host: ClientHost }) {
  return (
    <HostCtx.Provider value={host}>
      <NotesModeInner host={host} />
    </HostCtx.Provider>
  );
}
