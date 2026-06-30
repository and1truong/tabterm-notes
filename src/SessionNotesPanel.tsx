import { useState } from "react";
import { BookOpen, Maximize2 } from "lucide-react";
import { useHost } from "./useHost.ts";
import { NotesPanel } from "./NotesPanel.tsx";
import { NotesModal } from "./NotesModal.tsx";
import { useInitialLoad } from "./useInitialLoad.ts";

// Registered into the host right-sidebar slot. Shows the ACTIVE session's notes
// (resolved reactively from host.context), with a pop-out modal. Renders nothing
// when there's no active session (matches core's gating: sessions-view + a session).
export function SessionNotesPanel() {
  const host = useHost();
  useInitialLoad(host);
  // Reactively track just the active session id — re-renders only when it changes.
  const sessionId = host.context.select((s) => s.activeSessionId);
  const [modalOpen, setModalOpen] = useState(false);
  if (!sessionId) return null;
  return (
    <aside className="flex-1 min-h-0 float-card flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-11 border-b border-[var(--border)] shrink-0">
        <BookOpen size={15} className="text-[var(--accent-soft)]" />
        <span className="text-xs font-semibold tracking-wide text-[var(--text)] flex-1">NOTES WORKSPACE</span>
        <button
          onClick={() => setModalOpen(true)}
          className="grid place-items-center w-7 h-7 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
          title="Open in modal"
        >
          <Maximize2 size={15} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <NotesPanel key={sessionId} sessionId={sessionId} />
      </div>
      <NotesModal sessionId={sessionId} open={modalOpen} onClose={() => setModalOpen(false)} />
    </aside>
  );
}
