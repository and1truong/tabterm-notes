import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Code,
  Strikethrough,
  Link as LinkIcon,
} from "lucide-react";

// Floating mini-toolbar that appears next to a text selection (Dropbox Paper
// style). Inline marks only — block-level transforms live in the slash menu and
// the focus-gated bottom toolbar.
export function BubbleToolbar({ editor, onLink }: { editor: Editor; onLink: (editor: Editor) => void }) {
  const btn = (active: boolean, onClick: () => void, title: string, icon: React.ReactNode) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded hover:bg-neutral-100 hover:text-neutral-900 ${
        active ? "text-neutral-900 bg-neutral-100" : "text-neutral-500"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      className="flex items-center gap-0.5 px-1 py-1 rounded-lg border border-black/10 bg-white text-neutral-700 shadow-lg"
    >
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Bold (Cmd-B)", <Bold size={14} />)}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Italic (Cmd-I)", <Italic size={14} />)}
      {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "Underline (Cmd-U)", <UnderlineIcon size={14} />)}
      {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "Strikethrough", <Strikethrough size={14} />)}
      {btn(editor.isActive("code"), () => editor.chain().focus().toggleCode().run(), "Inline code", <Code size={14} />)}
      {btn(editor.isActive("link"), () => onLink(editor), "Link (Cmd-K)", <LinkIcon size={14} />)}
    </BubbleMenu>
  );
}
