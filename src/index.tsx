import type { ClientHost } from "@tabterm/module-host/client";
import { FileText, PanelRight } from "lucide-react";
import { NotesMode } from "./NotesMode.tsx";
import { SessionNotesPanel } from "./SessionNotesPanel.tsx";
import { HostCtx } from "./useHost.ts";

// Module-owned visibility flag for the session notes panel (replaces the former
// core `showNotes` setting). Persisted + synced via host.kv; defaults to shown.
const PANEL_VISIBLE_KEY = "notesPanelVisible";
const panelVisible = (host: ClientHost) => host.kv.get(PANEL_VISIBLE_KEY) !== false;

export default function activate(host: ClientHost) {
  const offUI = host.ui.registerUI({
    railPage: {
      id: "notes",
      icon: <FileText size={16} />,
      label: "Notes",
      component: () => <NotesMode host={host} />,
    },
    // The "Toggle notes panel" button. Self-gates to the session view with an
    // active session (mirrors the former core PrimaryTabs gate); flips the
    // module's own host.kv flag instead of a core setting.
    tabBarAction: {
      id: "notes-toggle",
      icon: <PanelRight size={15} />,
      tooltip: "Toggle notes panel",
      visible: () => {
        const ctx = host.context.active();
        return !!ctx.sessionId && ctx.activeModuleView == null;
      },
      onClick: () => host.kv.set(PANEL_VISIBLE_KEY, !panelVisible(host)),
    },
    rightPanel: {
      id: "notes-session",
      // Session notes render only on the session view: an active session, the
      // panel-visible flag on, AND no module rail page (Files, Git, …) open in the
      // main area. Reporting these lets the host collapse the right column instead
      // of reserving empty width. The flag lives in host.kv (store-backed), so App
      // re-renders and re-evaluates this on toggle.
      visible: () => {
        const ctx = host.context.active();
        return !!ctx.sessionId && panelVisible(host) && ctx.activeModuleView == null;
      },
      component: () => (
        <HostCtx.Provider value={host}>
          <SessionNotesPanel />
        </HostCtx.Provider>
      ),
    },
  });
  // Collapse superseded offline note:update edits for the same note + field so a
  // long offline burst flushes one write per field instead of every keystroke.
  // (Moved out of core ws.ts when notes became a module.)
  const offCollapse = host.outbox.registerCollapse((existing, incoming) => {
    if (incoming.type !== "note:update" || existing.type !== "note:update") return false;
    if (existing.noteId !== incoming.noteId) return false;
    const field = incoming.content !== undefined ? "content" : incoming.title !== undefined ? "title" : null;
    if (!field) return false;
    return field === "content" ? existing.content !== undefined : existing.title !== undefined;
  });
  return () => { offUI(); offCollapse(); };
}
