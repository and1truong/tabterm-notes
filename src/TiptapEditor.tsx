import { useEffect, useRef, useState } from "react";
import { uploadImage } from "./editor/imageUpload";
import { useEditor, EditorContent, ReactRenderer, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { SlashMenu, type SlashMenuHandle } from "./editor/SlashMenu";
import { filterSlashItems, type SlashItem } from "./editor/slashItems";
import { createFindPlugin } from "./editor/findPlugin";
import { FindBar } from "./editor/FindBar";
import { BubbleToolbar } from "./editor/BubbleToolbar";
import Document from "@tiptap/extension-document";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin } from "@tiptap/pm/state";
import { DOMParser } from "@tiptap/pm/model";
import { Markdown } from "tiptap-markdown";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskItem from "@tiptap/extension-task-item";
import { TightTaskList } from "./tiptapTightList.ts";
import type { NoteWidthPreset } from "../shared.ts";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import { ensureLeadingHeading, looksLikeMarkdown } from "./noteMarkdown.ts";
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  Table as TableIcon,
  CheckSquare,
} from "lucide-react";

// Common languages cover ~95% of usage. Per-language imports keep the bundle small.
const lowlight = createLowlight(common);

const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        items: ({ query }: { query: string }) => filterSlashItems(query),
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: SlashItem }) => {
          props.run(editor, range);
        },
        render: () => {
          let renderer: ReactRenderer<SlashMenuHandle> | null = null;
          let popup: TippyInstance | null = null;
          return {
            onStart: (props: any) => {
              renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              popup = tippy(document.body, {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: renderer.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                offset: [0, 4],
              });
            },
            onUpdate(props: any) {
              renderer?.updateProps(props);
              popup?.setProps({ getReferenceClientRect: props.clientRect });
            },
            onKeyDown(props: any) {
              if (props.event.key === "Escape") { popup?.hide(); return true; }
              return renderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit() {
              popup?.destroy();
              renderer?.destroy();
              popup = null;
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});

const FindExtension = Extension.create({
  name: "noteFind",
  addProseMirrorPlugins() { return [createFindPlugin()]; },
});

// Controlled markdown editor. `content` is the canonical markdown string; the
// editor parses it on mount and emits markdown back through `onChange`. While
// the user is typing we ignore inbound `content` changes so a remote broadcast
// can't clobber their caret (mirrors the focus-aware textarea pattern the old
// NotesPanel used).
//
// `editorRef` (optional) lets the parent grab the underlying editor — used by
// NotesPanel to force a blur when the user clicks a different note in the list
// (so the focused-guard below releases and the new content is loaded).
const getMarkdown = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();

// Force every note body to open with a heading (a title line). StarterKit's own
// Document is disabled so this stricter content expression wins; inbound markdown
// is normalized via ensureLeadingHeading so the schema always accepts it.
const HeadingDocument = Document.extend({
  content: "heading block*",
});
// Unforced variant (`block+`, Document's default) for surfaces that shouldn't
// require a leading title — session notes opt into this.
const FreeDocument = Document.extend({
  content: "block+",
});

// Render pasted markdown as formatted content instead of literal syntax. Only
// takes over when the pasted text looks like markdown (looksLikeMarkdown);
// otherwise returns false and ProseMirror's normal HTML/plain handling runs, so
// rich text copied from elsewhere is unaffected. Reuses the editor's own
// markdown parser (same config) so paste is consistent with how content loads.
const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            if (!text || !looksLikeMarkdown(text)) return false;
            const html = (
              editor.storage as unknown as {
                markdown: { parser: { parse(t: string): string } };
              }
            ).markdown.parser.parse(text);
            const container = document.createElement("div");
            container.innerHTML = html;
            const slice = DOMParser.fromSchema(editor.schema).parseSlice(container);
            view.dispatch(view.state.tr.replaceSelection(slice));
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

export function TiptapEditor({
  content,
  version,
  widthPreset = "default",
  onChange,
  onContentLoaded,
  placeholder,
  editorRef,
  showToolbar = true,
  forceHeading = true,
}: {
  content: string;
  // Authoritative version of `content`, reported back via onContentLoaded when
  // the editor passively (re)loads it (i.e. the user isn't the one typing).
  version: number;
  // Prose-column width preference. "full" removes the cap so prose fills the
  // whole editor; otherwise the column is centered (mx-auto) at the given ch.
  widthPreset?: NoteWidthPreset;
  onChange: (markdown: string) => void;
  // Fired when authoritative content is loaded into the editor while not typing,
  // so the panel can re-anchor its optimistic base version to the server's.
  onContentLoaded?: (version: number) => void;
  placeholder?: string;
  editorRef?: { current: Editor | null };
  // Whether to render the focus-gated bottom toolbar pill. The compact session-
  // note sidebar opts out; spacious surfaces (notes view, modal) keep it.
  showToolbar?: boolean;
  // When true (workspace notes), the document schema requires a leading heading
  // and inbound markdown is normalized to satisfy it. Session notes pass false:
  // free-form body, no forced title line.
  forceHeading?: boolean;
}) {
  const focused = useRef(false);
  const editorHolderRef = useRef<Editor | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const findOpenSetterRef = useRef<(v: boolean) => void>(() => {});

  const insertImageFromFile = async (file: File) => {
    const ed = editorHolderRef.current;
    if (!ed) return;
    const result = await uploadImage(file);
    if ("error" in result) {
      window.alert(`Image upload failed: ${result.error}`);
      return;
    }
    ed.chain().focus().setImage({ src: result.url, alt: file.name }).run();
  };

  // Normalize inbound markdown only when a leading heading is required.
  const normalize = (md: string) => (forceHeading ? ensureLeadingHeading(md) : md);

  const editor = useEditor({
    extensions: [
      forceHeading ? HeadingDocument : FreeDocument,
      StarterKit.configure({
        document: false,
        codeBlock: false,
        link: false,
        underline: false,
        trailingNode: { node: "paragraph" },
      }),
      CodeBlockLowlight.configure({ lowlight, HTMLAttributes: { class: "tt-codeblock hljs" } }),
      Markdown.configure({ html: false, linkify: true, breaks: false }),
      MarkdownPaste,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading" ? "Note title…" : (placeholder ?? "Write…"),
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: "tt-link" } }),
      Image.configure({ HTMLAttributes: { class: "tt-image" } }),
      Table.configure({ resizable: false, HTMLAttributes: { class: "tt-table" } }),
      TableRow,
      TableHeader,
      TableCell,
      TightTaskList.configure({ HTMLAttributes: { class: "tt-tasklist" } }),
      TaskItem.configure({ nested: true, HTMLAttributes: { class: "tt-taskitem" } }),
      SlashCommand,
      FindExtension,
    ],
    content: normalize(content),
    onUpdate: ({ editor }) => {
      onChange(getMarkdown(editor));
    },
    onFocus: () => {
      focused.current = true;
      setEditorFocused(true);
    },
    onBlur: () => {
      focused.current = false;
      setEditorFocused(false);
    },
    immediatelyRender: false,
    editorProps: {
      handleKeyDown(_view, event) {
        const ed = editorHolderRef.current;
        if (!ed) return false;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          findOpenSetterRef.current(true);
          return true;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          insertLink(ed);
          return true;
        }
        return false;
      },
      handlePaste(_view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              void insertImageFromFile(file);
              return true;
            }
          }
        }
        return false;
      },
      handleDrop(_view, event) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
        if (imgs.length === 0) return false;
        event.preventDefault();
        for (const f of imgs) void insertImageFromFile(f);
        return true;
      },
    },
  });

  useEffect(() => {
    editorHolderRef.current = editor;
    return () => {
      editorHolderRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    findOpenSetterRef.current = setFindOpen;
  }, [setFindOpen]);

  useEffect(() => {
    if (editorRef) editorRef.current = editor;
    return () => {
      if (editorRef) editorRef.current = null;
    };
  }, [editor, editorRef]);

  // Reflect external content changes (session switch, remote edit) into the
  // editor, but only when the user isn't typing. When we passively adopt
  // authoritative content we report its version so the panel re-anchors its
  // base; while typing we leave both buffer and base alone.
  useEffect(() => {
    if (!editor) return;
    if (focused.current) return;
    const normalized = normalize(content);
    if (getMarkdown(editor) !== normalized) {
      editor.commands.setContent(normalized, { emitUpdate: false });
    }
    onContentLoaded?.(version);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, version, editor]);

  // Prose column cap. mx-auto (set below) centers it; max-w-none makes "full"
  // span the whole editor width.
  const widthClass =
    widthPreset === "full"
      ? "[&_.ProseMirror]:max-w-none"
      : widthPreset === "wider"
        ? "[&_.ProseMirror]:max-w-[100ch]"
        : "[&_.ProseMirror]:max-w-[68ch]";

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {editor && <BubbleToolbar editor={editor} onLink={insertLink} />}
      <EditorContent
        editor={editor}
        className={`flex-1 overflow-y-auto px-4 py-3 text-[15px] leading-[1.7] text-[var(--text)] [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-full [&_.ProseMirror]:mx-auto ${widthClass} [&_.ProseMirror_h1.is-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_h1.is-empty:first-child::before]:text-[var(--faint)] [&_.ProseMirror_h1.is-empty:first-child::before]:float-left [&_.ProseMirror_h1.is-empty:first-child::before]:h-0 [&_.ProseMirror_h1.is-empty:first-child::before]:pointer-events-none [&_.ProseMirror_h2.is-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_h2.is-empty:first-child::before]:text-[var(--faint)] [&_.ProseMirror_h2.is-empty:first-child::before]:float-left [&_.ProseMirror_h2.is-empty:first-child::before]:h-0 [&_.ProseMirror_h2.is-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-empty::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-empty::before]:text-[var(--faint)] [&_.ProseMirror_p.is-empty::before]:float-left [&_.ProseMirror_p.is-empty::before]:h-0 [&_.ProseMirror_p.is-empty::before]:pointer-events-none [&_.ProseMirror_h1]:text-[22px] [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h1]:leading-tight [&_.ProseMirror_h1]:mt-4 [&_.ProseMirror_h1]:mb-2 [&_.ProseMirror_h2]:text-[17px] [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:leading-snug [&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:mb-1.5 [&_.ProseMirror_p]:my-2.5 [&_.ProseMirror_li]:my-1 [&_.ProseMirror_li]:leading-[1.6] [&_.ProseMirror_li_p]:my-0 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ul]:my-2.5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ol]:my-2.5 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-[var(--border-2)] [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:my-2.5 [&_.ProseMirror_blockquote]:text-[var(--muted)] [&_.ProseMirror_blockquote]:italic [&_.ProseMirror_a]:text-[var(--accent)] [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-2 [&_.ProseMirror_a]:decoration-[var(--faint)] [&_.ProseMirror_:not(pre)>code]:bg-[var(--hover)] [&_.ProseMirror_:not(pre)>code]:px-1 [&_.ProseMirror_:not(pre)>code]:rounded [&_.ProseMirror_:not(pre)>code]:font-mono [&_.ProseMirror_:not(pre)>code]:text-[0.85em]`}
      />
      {showToolbar && editorFocused && <Toolbar editor={editor} />}
      {findOpen && editor && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
    </div>
  );
}

function insertLink(editor: Editor) {
  const prev = editor.getAttributes("link").href ?? "";
  const url = window.prompt("URL", prev);
  if (url === null) return;
  if (url === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
}

// Focus-gated floating toolbar docked bottom-right of the editor (Dropbox
// Paper style). Renders as a detached rounded pill on a transparent strip —
// not a full-width bar — so the prose canvas reads clean. Shown only while the
// editor has focus. Holds the full set: inline marks + headings + lists +
// blocks + link/table. Image/divider/date stay on the slash menu (/); the
// bubble menu (editor/BubbleToolbar) carries inline marks next to a selection.
function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

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
    <div className="flex justify-center p-2 shrink-0">
      <div className="flex flex-wrap items-center justify-center gap-0.5 px-1.5 py-1 max-w-full rounded-lg border border-black/10 bg-white text-neutral-700 shadow-lg">
        {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Bold (Cmd-B)", <Bold size={14} />)}
        {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Italic (Cmd-I)", <Italic size={14} />)}
        {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "Underline (Cmd-U)", <UnderlineIcon size={14} />)}
        {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "Strikethrough", <Strikethrough size={14} />)}
        {btn(editor.isActive("code"), () => editor.chain().focus().toggleCode().run(), "Inline code", <Code size={14} />)}
        <span className="w-px h-4 bg-[var(--border)] mx-1" />
        {btn(editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), "Heading 1", <Heading1 size={14} />)}
        {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "Heading 2", <Heading2 size={14} />)}
        {btn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), "Heading 3", <Heading3 size={14} />)}
        <span className="w-px h-4 bg-[var(--border)] mx-1" />
        {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "Bullet list", <List size={14} />)}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Numbered list", <ListOrdered size={14} />)}
        {btn(editor.isActive("taskList"), () => editor.chain().focus().toggleTaskList().run(), "Task list", <CheckSquare size={14} />)}
        <span className="w-px h-4 bg-[var(--border)] mx-1" />
        {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "Blockquote", <Quote size={14} />)}
        {btn(editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run(), "Code block", <SquareCode size={14} />)}
        <span className="w-px h-4 bg-[var(--border)] mx-1" />
        {btn(editor.isActive("link"), () => insertLink(editor), "Link (Cmd-K)", <LinkIcon size={14} />)}
        {btn(false, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "Insert table", <TableIcon size={14} />)}
      </div>
    </div>
  );
}
