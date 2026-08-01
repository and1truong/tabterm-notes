import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import type { TaskComment } from "../../shared.ts";
import type { TaskNode } from "./taskTree.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false }) as string;
  if (typeof DOMParser === "undefined") return `<p>${escapeHtml(markdown)}</p>`;

  const document = new DOMParser().parseFromString(rendered, "text/html");
  document.querySelectorAll("script,style,iframe,object,embed,form").forEach((element) => element.remove());
  document.body.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src") && (value.startsWith("javascript:") || value.startsWith("data:")))) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return document.body.innerHTML;
}

function Markdown({ children, muted = false }: { children: string; muted?: boolean }) {
  const html = useMemo(() => safeMarkdown(children), [children]);
  return (
    <div
      className={`task-markdown text-xs leading-relaxed ${muted ? "text-[var(--muted)]" : "text-[var(--text)]"}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function TaskDetails({
  node,
  comments,
  onUpdate,
  onComplete,
  onReopen,
  onAddSubtask,
  onDelete,
  onForceRelease,
  onAddComment,
  focusComment,
}: {
  node: TaskNode;
  comments: TaskComment[];
  onUpdate: (changes: { title?: string; detailsMarkdown?: string }) => void;
  onComplete: () => void;
  onReopen: () => void;
  onAddSubtask: () => void;
  onDelete: (keepChildren: boolean) => void;
  onForceRelease: () => void;
  onAddComment: (bodyMarkdown: string) => void;
  focusComment: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.task.title);
  const [details, setDetails] = useState(node.task.detailsMarkdown);
  const [comment, setComment] = useState("");
  const claimed = node.claim !== null && node.claim.leaseExpiresAt > Date.now();
  const completed = node.task.state === "completed";
  const latestComment = useMemo(
    () => comments.filter((item) => item.taskId === node.task.id).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] ?? null,
    [comments, node.task.id],
  );

  useEffect(() => {
    setEditing(false);
    setTitle(node.task.title);
    setDetails(node.task.detailsMarkdown);
    setComment("");
  }, [node.task.id, node.task.title, node.task.detailsMarkdown]);

  function save() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onUpdate({
      ...(trimmedTitle === node.task.title ? {} : { title: trimmedTitle }),
      ...(details === node.task.detailsMarkdown ? {} : { detailsMarkdown: details }),
    });
    setEditing(false);
  }

  function submitComment() {
    const trimmed = comment.trim();
    if (!trimmed) return;
    onAddComment(trimmed);
    setComment("");
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text)]">Task details</span>
        {!claimed && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Task title"
            className="w-full rounded-md border border-[var(--border-2)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            aria-label="Task details Markdown"
            rows={4}
            className="w-full resize-y rounded-md border border-[var(--border-2)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!title.trim()}
              className="rounded bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-[var(--bg)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Save
            </button>
          </div>
        </div>
      ) : node.task.detailsMarkdown ? (
        <Markdown>{node.task.detailsMarkdown}</Markdown>
      ) : (
        <p className="text-xs text-[var(--faint)]">No details yet.</p>
      )}

      {node.blockers.length > 0 && (
        <div className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--muted)]">
          <span className="font-semibold text-[var(--text)]">Blocked by:</span>{" "}
          {node.blockers.map((blocker) => `${blocker.title}${blocker.state === "completed" ? " ✓" : ""}`).join(", ")}
        </div>
      )}

      {node.claim && (
        <div className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--muted)]">
          <span className="font-semibold text-[var(--text)]">Claim:</span>{" "}
          {node.claim.agentLabel} · since {new Date(node.claim.claimedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}

      {latestComment && (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] text-[var(--faint)]">
            <span className="font-semibold text-[var(--muted)]">{latestComment.authorLabel}</span>
            <span>· latest comment</span>
          </div>
          <Markdown muted>{latestComment.bodyMarkdown}</Markdown>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1 border-t border-[var(--border)] pt-2">
        {claimed ? (
          <button
            type="button"
            onClick={onForceRelease}
            className="rounded px-2 py-1 text-[11px] text-amber-500 hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            Force release
          </button>
        ) : (
          <>
            {(completed || node.available) && (
              <button
                type="button"
                onClick={completed ? onReopen : onComplete}
                className="rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                {completed ? "Reopen" : "Complete"}
              </button>
            )}
            {!completed && (
              <button
                type="button"
                onClick={onAddSubtask}
                className="rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                Add subtask
              </button>
            )}
            {node.children.length > 0 && (
              <button
                type="button"
                onClick={() => onDelete(true)}
                className="rounded px-2 py-1 text-[11px] text-red-400 hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                Delete, keep subtasks
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(false)}
              className="rounded px-2 py-1 text-[11px] text-red-400 hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              {node.children.length > 0 ? "Delete subtree" : "Delete"}
            </button>
          </>
        )}
      </div>

      <div className="mt-2 flex gap-1">
        <input
          autoFocus={focusComment}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitComment();
            }
          }}
          placeholder="Add a comment…"
          aria-label="Task comment"
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={submitComment}
          disabled={!comment.trim()}
          className="rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          Comment
        </button>
      </div>
    </div>
  );
}
