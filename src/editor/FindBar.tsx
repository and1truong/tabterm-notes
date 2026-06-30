import { useEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { setFindQuery, stepFind, getFindState } from "./findPlugin";

export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setFindQuery(editor, query); }, [editor, query]);
  useEffect(() => () => { setFindQuery(editor, ""); }, [editor]);

  // Subscribe to editor transactions so the counter re-renders on doc change.
  const [, force] = useState(0);
  useEffect(() => {
    const handler = () => force((n) => n + 1);
    editor.on("transaction", handler);
    return () => { editor.off("transaction", handler); };
  }, [editor]);

  const state = getFindState(editor);
  const total = state?.matches.length ?? 0;
  const active = total > 0 ? (state!.activeIndex + 1) : 0;

  return (
    <div className="absolute bottom-2 right-2 z-30 flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] shadow-lg">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
          if (e.key === "Enter") { e.preventDefault(); stepFind(editor, e.shiftKey ? -1 : 1); }
        }}
        placeholder="Find…"
        className="bg-transparent outline-none text-sm w-44 text-[var(--text)] placeholder:text-[var(--faint)]"
      />
      <span className="text-[11px] mono text-[var(--faint)] px-1">{active}/{total}</span>
      <button onClick={() => stepFind(editor, -1)} className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)]" title="Previous (Shift-Enter)">
        <ChevronUp size={14} />
      </button>
      <button onClick={() => stepFind(editor, 1)} className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)]" title="Next (Enter)">
        <ChevronDown size={14} />
      </button>
      <button onClick={onClose} className="p-1 rounded hover:bg-[var(--hover)] text-[var(--muted)]" title="Close (Esc)">
        <X size={14} />
      </button>
    </div>
  );
}
