import type { Editor } from "@tiptap/react";

export interface SlashItem {
  id: string;
  title: string;
  group: "Headings" | "Lists" | "Blocks" | "Inline";
  run: (editor: Editor, range: { from: number; to: number }) => void;
}

// Helper: replace the `/query` typed by the user with the produced node.
const replace = (run: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
  (editor: Editor, range: { from: number; to: number }) =>
    run(editor.chain().focus().deleteRange(range)).run();

export const slashItems: SlashItem[] = [
  { id: "h1", title: "Heading 1", group: "Headings", run: replace((c) => c.setHeading({ level: 1 })) },
  { id: "h2", title: "Heading 2", group: "Headings", run: replace((c) => c.setHeading({ level: 2 })) },
  { id: "h3", title: "Heading 3", group: "Headings", run: replace((c) => c.setHeading({ level: 3 })) },
  { id: "list", title: "Bullet list", group: "Lists", run: replace((c) => c.toggleBulletList()) },
  { id: "ordered", title: "Numbered list", group: "Lists", run: replace((c) => c.toggleOrderedList()) },
  { id: "task", title: "Task list", group: "Lists", run: replace((c) => c.toggleTaskList()) },
  { id: "table", title: "Table", group: "Blocks", run: replace((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
  { id: "quote", title: "Quote", group: "Blocks", run: replace((c) => c.toggleBlockquote()) },
  { id: "code", title: "Code block", group: "Blocks", run: replace((c) => c.toggleCodeBlock()) },
  { id: "divider", title: "Divider", group: "Blocks", run: replace((c) => c.setHorizontalRule()) },
  { id: "date", title: "Today's date", group: "Inline", run: (editor, range) => {
      const today = new Date().toISOString().slice(0, 10);
      editor.chain().focus().deleteRange(range).insertContent(today).run();
    } },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase();
  if (!q) return slashItems;
  return slashItems.filter((it) => it.id.includes(q) || it.title.toLowerCase().includes(q));
}
