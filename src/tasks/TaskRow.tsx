import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GripVertical,
  MessageSquare,
  MoreHorizontal,
} from "lucide-react";
import type { TaskNode } from "./taskTree.ts";

function claimAge(claimedAt: number): string {
  const elapsed = Math.max(0, Date.now() - claimedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function TaskRow({
  node,
  depth,
  hasChildren,
  expanded,
  selected,
  onToggle,
  onSelect,
  onComplete,
  onReopen,
  onAddSubtask,
  onDelete,
  onForceRelease,
  onComment,
  onDragStart,
  onDrop,
}: {
  node: TaskNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onAddSubtask: () => void;
  onDelete: (keepChildren: boolean) => void;
  onForceRelease: () => void;
  onComment: () => void;
  onDragStart: (taskId: string) => void;
  onDrop: (taskId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const claimed = node.claim !== null && node.claim.leaseExpiresAt > Date.now();
  const completed = node.task.state === "completed";
  const completable = completed || node.available;

  return (
    <div
      className={`group relative flex min-h-8 items-center gap-1 rounded-md pr-1 text-xs ${
        selected ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"
      }`}
      style={{ paddingLeft: `${4 + depth * 16}px` }}
      onDragOver={(event) => {
        if (!claimed) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(node.task.id);
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasChildren}
        aria-label={expanded ? `Collapse ${node.task.title}` : `Expand ${node.task.title}`}
        aria-expanded={hasChildren ? expanded : undefined}
        className="grid h-7 w-6 shrink-0 place-items-center rounded text-[var(--faint)] hover:text-[var(--text)] disabled:invisible focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>

      <input
        type="checkbox"
        checked={completed}
        disabled={claimed || !completable}
        aria-label={completed ? `Reopen ${node.task.title}` : `Complete ${node.task.title}`}
        onChange={() => completed ? onReopen() : onComplete()}
        className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      />

      <button
        type="button"
        onClick={onSelect}
        className={`min-w-0 flex-1 truncate px-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
          completed ? "text-[var(--faint)] line-through" : "text-[var(--text)]"
        }`}
        title={node.task.title}
      >
        {node.task.title}
      </button>

      {claimed && node.claim && (
        <span
          className="max-w-28 shrink truncate rounded-full border border-[var(--border-2)] px-1.5 py-0.5 text-[10px] text-[var(--accent-soft)]"
          title={`Claimed by ${node.claim.agentLabel}`}
        >
          {node.claim.agentLabel} · {claimAge(node.claim.claimedAt)}
        </span>
      )}

      {node.blockers.some((blocker) => blocker.state !== "completed") && (
        <span
          className="grid h-6 w-5 shrink-0 place-items-center text-amber-500"
          title={`Blocked by ${node.blockers.filter((blocker) => blocker.state !== "completed").map((blocker) => blocker.title).join(", ")}`}
        >
          <AlertTriangle size={12} />
        </span>
      )}

      {node.commentCount > 0 && (
        <button
          type="button"
          onClick={onComment}
          className="flex h-7 shrink-0 items-center gap-0.5 rounded px-1 text-[10px] text-[var(--faint)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          aria-label={`${node.commentCount} comment${node.commentCount === 1 ? "" : "s"} on ${node.task.title}`}
        >
          <MessageSquare size={11} /> {node.commentCount}
        </button>
      )}

      <button
        type="button"
        draggable={!claimed && !completed}
        disabled={claimed || completed}
        onDragStart={() => onDragStart(node.task.id)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--faint)] opacity-0 hover:text-[var(--text)] group-hover:opacity-100 group-focus-within:opacity-100 hover-none:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        aria-label={`Drag ${node.task.title}`}
        title="Drag to reorder"
      >
        <GripVertical size={13} />
      </button>

      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-label={`Actions for ${node.task.title}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--faint)] opacity-0 hover:bg-[var(--panel)] hover:text-[var(--text)] group-hover:opacity-100 group-focus-within:opacity-100 hover-none:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        <MoreHorizontal size={14} />
      </button>

      {menuOpen && (
        <div className="absolute right-1 top-7 z-20 min-w-36 overflow-hidden rounded-lg border border-[var(--border-2)] bg-[var(--panel)] py-1 shadow-lg">
          <button
            type="button"
            onClick={() => { setMenuOpen(false); onComment(); }}
            className="block w-full px-3 py-1.5 text-left text-[var(--text)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--accent)]"
          >
            Add comment
          </button>
          {claimed ? (
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onForceRelease(); }}
              className="block w-full px-3 py-1.5 text-left text-amber-500 hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--accent)]"
            >
              Force release
            </button>
          ) : (
            <>
              {!completed && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onAddSubtask(); }}
                  className="block w-full px-3 py-1.5 text-left text-[var(--text)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--accent)]"
                >
                  Add subtask
                </button>
              )}
              {completable && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); completed ? onReopen() : onComplete(); }}
                  className="block w-full px-3 py-1.5 text-left text-[var(--text)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--accent)]"
                >
                  {completed ? "Reopen" : "Complete"}
                </button>
              )}
              {node.children.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onDelete(true); }}
                  className="block w-full px-3 py-1.5 text-left text-red-400 hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--accent)]"
                >
                  Delete, keep subtasks
                </button>
              )}
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onDelete(false); }}
                className="block w-full px-3 py-1.5 text-left text-red-400 hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--accent)]"
              >
                {node.children.length > 0 ? "Delete subtree" : "Delete"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
