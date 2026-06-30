import { useEffect, useRef, useState } from "react";

// Double-click to edit; Enter/blur commits, Esc cancels. Used for primary tabs,
// groups, and sessions. Optionally controlled: pass `editing` to drive edit
// mode from a parent (e.g. an Edit button) and `onEditingChange` to receive
// requests to open/close from double-click/Esc.
export function EditableLabel({
  value,
  onCommit,
  className = "",
  bubble = false,
  editing: editingProp,
  onEditingChange,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  // When true, the display span's click/double-click are allowed to bubble to
  // the parent (so a parent can handle single-click while this handles edit).
  bubble?: boolean;
  // Controlled edit mode. When omitted, the component self-manages via
  // double-click (the default for tabs/groups/sessions).
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [internal, setInternal] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlled = editingProp !== undefined;
  const editing = controlled ? editingProp! : internal;

  const requestEditing = (next: boolean) => {
    if (controlled) onEditingChange?.(next);
    else setInternal(next);
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    requestEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            setDraft(value);
            requestEditing(false);
          }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        className={`bg-[var(--bg)] border border-[var(--border-2)] rounded px-1 outline-none text-inherit ${className}`}
      />
    );
  }

  return (
    <span
      className={className}
      onDoubleClick={(e) => {
        if (!bubble) e.stopPropagation();
        setDraft(value);
        requestEditing(true);
      }}
    >
      {value}
    </span>
  );
}
