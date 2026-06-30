import { useEffect } from "react";
import { NotesPanel } from "./NotesPanel.tsx";

// Wide pop-out for the session notes editor — same NotesPanel the right sidebar
// hosts, but in a focused ~680px modal with the note list laid out as tabs.
// The sidebar panel is unmounted while this is open so there's only one live
// editor per note (no self-conflict via OCC).
//
// Controlled: caller owns open/close state. Drop the core setNotesModalOpen dep.
export function NotesModal({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}) {
  // Esc closes. Capture phase so it preempts xterm/ProseMirror handlers.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl h-[85vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl overflow-hidden"
      >
        <NotesPanel key={sessionId} sessionId={sessionId} variant="modal" onClose={onClose} />
      </div>
    </div>
  );
}
