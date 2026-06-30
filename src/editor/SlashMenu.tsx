import "tippy.js/dist/tippy.css";
import { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { SlashItem } from "./slashItems";

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface Props {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  editor: Editor;
}

export const SlashMenu = forwardRef<SlashMenuHandle, Props>(({ items, command }, ref) => {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (event.key === "ArrowUp") {
        setIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[index];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }), [items, index, command]);

  if (items.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[var(--faint)] rounded-lg border border-[var(--border-2)] bg-[var(--panel)] shadow-lg">
        No matches
      </div>
    );
  }

  // Group by item.group, preserving slashItems order.
  const groups: { name: SlashItem["group"]; entries: { item: SlashItem; flatIndex: number }[] }[] = [];
  items.forEach((item, i) => {
    let g = groups.find((x) => x.name === item.group);
    if (!g) { g = { name: item.group, entries: [] }; groups.push(g); }
    g.entries.push({ item, flatIndex: i });
  });

  return (
    <div className="min-w-44 rounded-lg border border-[var(--border-2)] bg-[var(--panel)] shadow-lg py-1 text-sm">
      {groups.map((g) => (
        <div key={g.name}>
          <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--faint)] font-semibold">{g.name}</div>
          {g.entries.map(({ item, flatIndex }) => (
            <button
              key={item.id}
              onMouseDown={(e) => { e.preventDefault(); command(item); }}
              className={`block w-full text-left px-3 py-1.5 ${
                index === flatIndex
                  ? "bg-[var(--hover)] text-[var(--text)]"
                  : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
});
SlashMenu.displayName = "SlashMenu";
