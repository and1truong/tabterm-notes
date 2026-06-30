/**
 * Tiptap extension overrides that force tight (no blank line between items)
 * serialization for taskList and bulletList.
 *
 * tiptap-markdown's MarkdownTightLists extension only registers the `tight`
 * attribute on bulletList/orderedList, not taskList. So when serializing a
 * taskList, node.attrs.tight is undefined and prosemirror-markdown's
 * renderList() falls back to options.tightLists=false, emitting \n\n between
 * items. This override wraps the node via Proxy to inject tight:true so items
 * are always separated by a single \n.
 */
import TaskList from "@tiptap/extension-task-list";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { MarkdownSerializerState } from "prosemirror-markdown";

function tightProxy(node: ProsemirrorNode): ProsemirrorNode {
  return new Proxy(node, {
    get(target, prop) {
      if (prop === "attrs") return { ...target.attrs, tight: true };
      const val = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}

/** Drop-in replacement for TaskList that serializes with tight spacing. */
export const TightTaskList = TaskList.extend({
  addStorage() {
    const parent = (this as any).parent?.() ?? {};
    return {
      ...parent,
      markdown: {
        ...(parent.markdown ?? {}),
        serialize(
          this: { editor: { storage: { markdown: { options: { bulletListMarker?: string } } } } },
          state: MarkdownSerializerState,
          node: ProsemirrorNode,
        ) {
          const marker =
            this.editor.storage.markdown.options.bulletListMarker ?? "-";
          state.renderList(tightProxy(node), "  ", () => `${marker} `);
        },
      },
    };
  },
});
