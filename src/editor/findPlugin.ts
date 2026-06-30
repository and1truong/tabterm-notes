import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface FindState {
  query: string;
  matches: { from: number; to: number }[];
  activeIndex: number;
  decorations: DecorationSet;
}

export const findPluginKey = new PluginKey<FindState>("note-find");

interface SetQueryMeta { kind: "set"; query: string }
interface StepMeta { kind: "step"; delta: 1 | -1 }
type FindMeta = SetQueryMeta | StepMeta;

function scan(state: EditorState, query: string): { from: number; to: number }[] {
  if (!query) return [];
  const out: { from: number; to: number }[] = [];
  const needle = query.toLowerCase();
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = (node.text ?? "").toLowerCase();
    let i = 0;
    while (i <= text.length - needle.length) {
      const j = text.indexOf(needle, i);
      if (j < 0) break;
      out.push({ from: pos + j, to: pos + j + needle.length });
      i = j + needle.length;
    }
    return false;
  });
  return out;
}

function buildDecorations(
  state: EditorState,
  matches: { from: number; to: number }[],
  activeIndex: number,
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === activeIndex ? "tt-find-match tt-find-match-active" : "tt-find-match",
    }),
  );
  return DecorationSet.create(state.doc, decos);
}

export function createFindPlugin(): Plugin<FindState> {
  return new Plugin<FindState>({
    key: findPluginKey,
    state: {
      init(): FindState {
        return { query: "", matches: [], activeIndex: 0, decorations: DecorationSet.empty };
      },
      apply(tr: Transaction, prev: FindState, _old: EditorState, newState: EditorState): FindState {
        const meta = tr.getMeta(findPluginKey) as FindMeta | undefined;
        if (meta?.kind === "set") {
          const matches = scan(newState, meta.query);
          return { query: meta.query, matches, activeIndex: 0, decorations: buildDecorations(newState, matches, 0) };
        }
        if (meta?.kind === "step" && prev.matches.length > 0) {
          const activeIndex = (prev.activeIndex + meta.delta + prev.matches.length) % prev.matches.length;
          return { ...prev, activeIndex, decorations: buildDecorations(newState, prev.matches, activeIndex) };
        }
        if (tr.docChanged && prev.query) {
          const matches = scan(newState, prev.query);
          const activeIndex = Math.min(prev.activeIndex, Math.max(0, matches.length - 1));
          return { ...prev, matches, activeIndex, decorations: buildDecorations(newState, matches, activeIndex) };
        }
        return prev;
      },
    },
    props: {
      decorations(state: EditorState) {
        return findPluginKey.getState(state)?.decorations ?? null;
      },
    },
  });
}

export function setFindQuery(editor: import("@tiptap/core").Editor, query: string) {
  editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, { kind: "set", query }));
}
export function stepFind(editor: import("@tiptap/core").Editor, delta: 1 | -1) {
  editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, { kind: "step", delta }));
}
export function getFindState(editor: import("@tiptap/core").Editor): FindState | undefined {
  return findPluginKey.getState(editor.state);
}
