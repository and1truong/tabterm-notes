import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

interface Heading {
  level: number;
  text: string;
  pos: number;
}

function extractHeadings(editor: Editor): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      out.push({ level: node.attrs.level as number, text: node.textContent, pos });
    }
  });
  return out;
}

// Active heading = the latest heading whose pos is at-or-before the caret.
// Uses caret position (not scroll position) since the editor's overflow-y-auto
// container makes scroll-tracking awkward across embedded panels.
function findActivePos(editor: Editor, headings: Heading[]): number | null {
  if (headings.length === 0) return null;
  const caret = editor.state.selection.$head.pos;
  let active: number | null = headings[0].pos;
  for (const h of headings) {
    if (h.pos <= caret) active = h.pos;
    else break;
  }
  return active;
}

// Width + indent per heading level. Active dashes are slightly elongated so the
// eye finds the current section without hovering.
function dashStyle(level: number, active: boolean): React.CSSProperties {
  const base = level === 1 ? 16 : level === 2 ? 12 : 8;
  const ml = level === 1 ? 12 : level === 2 ? 18 : 22;
  return { width: active ? base + 4 : base, marginLeft: ml };
}

const itemPad = (level: number) => (level === 1 ? 12 : level === 2 ? 26 : 40);

// Dropbox Paper-style outline: thin column of dashes (one per heading) on the
// left edge, vertically centered. Hovering or focusing the strip slides out a
// 260px popout listing the headings; the editor never reflows. Returns null
// while the editor is mounting or when the doc has no headings (Paper does the
// same — empty docs get no TOC chrome).
//
// editorRef is passed as an OBJECT (not its current value) because TiptapEditor
// populates the ref in a useEffect after its parent renders; the value would be
// null on first paint and React won't re-render on ref mutation. We poll one
// rAF until it lands, then subscribe to transactions for active-heading sync.
export function TocSidebar({ editorRef }: { editorRef: { current: Editor | null } }) {
  const [editor, setEditor] = useState<Editor | null>(editorRef.current);
  const [, force] = useState(0);

  useEffect(() => {
    if (editor) return;
    let raf = 0;
    const tick = () => {
      if (editorRef.current) setEditor(editorRef.current);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editor, editorRef]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => force((n) => n + 1);
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  if (!editor) return null;
  const headings = extractHeadings(editor);
  if (headings.length === 0) return null;
  const activePos = findActivePos(editor, headings);

  return (
    <nav
      tabIndex={0}
      aria-label="Outline"
      className="group relative w-9 shrink-0 py-4 flex flex-col items-start justify-center gap-2 outline-none"
    >
      {headings.map((h) => {
        const active = h.pos === activePos;
        return (
          <span
            key={h.pos}
            style={dashStyle(h.level, active)}
            className={`h-[2px] rounded-full transition-[background-color,width,opacity] duration-200 ease-out ${
              active
                ? "bg-[var(--accent)] opacity-100"
                : "bg-[var(--faint)] opacity-90 group-hover:bg-[var(--muted)] group-hover:opacity-100"
            }`}
          />
        );
      })}

      <div
        style={{ background: "color-mix(in srgb, var(--panel) 88%, var(--text) 8%)" }}
        className="absolute top-1/2 left-9 z-20 w-[260px] max-h-[calc(100%-24px)] overflow-y-auto rounded-r-xl border border-l-0 border-[var(--border-2)] p-2 shadow-[14px_0_32px_-12px_rgba(0,0,0,0.55)] opacity-0 pointer-events-none -translate-x-2 -translate-y-1/2 transition-[opacity,transform] duration-200 ease-out group-hover:opacity-100 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:delay-[120ms] group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:delay-[120ms]"
      >
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--faint)] font-semibold px-3 pt-1.5 pb-2.5">
          Outline
        </div>
        <ul className="space-y-0.5">
          {headings.map((h) => {
            const active = h.pos === activePos;
            return (
              <li key={h.pos}>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run();
                  }}
                  style={{
                    paddingLeft: itemPad(h.level),
                    background: active ? "color-mix(in srgb, var(--accent) 10%, transparent)" : undefined,
                  }}
                  className={`relative block w-full text-left py-1.5 pr-3 rounded-lg truncate transition-colors text-[13px] ${
                    active
                      ? "text-[var(--accent)] font-medium"
                      : h.level >= 3
                        ? "text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
                        : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover)]"
                  }`}
                  title={h.text || "(untitled)"}
                >
                  {active && (
                    <span className="absolute left-1 top-2 bottom-2 w-[3px] rounded-sm bg-[var(--accent)]" />
                  )}
                  {h.text || <span className="text-[var(--faint)] italic">(untitled)</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
