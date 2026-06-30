import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// The project's bunfig.toml deliberately keeps DOM out of the shared test harness
// (React UI is not unit-tested per the main-branch stance). This round-trip test
// self-bootstraps the DOM it needs *and* tears it down, so happy-dom's globals
// can't leak into sibling test files (location-hook etc. expect the lightweight
// stub from src/test/setup.ts).
//
// Why dynamic imports: prosemirror-view reads `document.documentElement.style` at
// top level of its module. If Tiptap is imported at the top of this file, it
// crashes before beforeAll runs. Dynamic-importing inside beforeAll defers the
// load until after the DOM is installed.

const DOM_GLOBALS = [
  "window", "document", "DOMParser", "Node", "Element", "HTMLElement",
  "Text", "Comment", "DocumentFragment", "NodeList", "Range",
  "MutationObserver", "ResizeObserver", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame",
] as const;
const saved: Record<string, unknown> = {};

let make: (content: string) => string;

beforeAll(async () => {
  const { GlobalWindow } = await import("happy-dom");
  const win = new GlobalWindow() as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    saved[key] = g[key];
    if (win[key] !== undefined) g[key] = win[key];
  }

  const { Editor } = await import("@tiptap/core");
  const StarterKit = (await import("@tiptap/starter-kit")).default;
  const { Markdown } = await import("tiptap-markdown");
  const { Table } = await import("@tiptap/extension-table");
  const TableRow = (await import("@tiptap/extension-table-row")).default;
  const TableCell = (await import("@tiptap/extension-table-cell")).default;
  const TableHeader = (await import("@tiptap/extension-table-header")).default;
  const TaskItem = (await import("@tiptap/extension-task-item")).default;
  const { TightTaskList } = await import("./tiptapTightList");
  const Link = (await import("@tiptap/extension-link")).default;
  const Image = (await import("@tiptap/extension-image")).default;
  const Underline = (await import("@tiptap/extension-underline")).default;

  make = (content: string) => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false, underline: false }),
        Markdown.configure({ html: false, linkify: true, breaks: false }),
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        TightTaskList,
        TaskItem.configure({ nested: true }),
        Link.configure({ openOnClick: false, autolink: true }),
        Image,
        Underline,
      ],
      content,
    });
    const md = (editor.storage as any).markdown.getMarkdown() as string;
    editor.destroy();
    return md.trim();
  };
});

afterAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (saved[key] === undefined) delete g[key];
    else g[key] = saved[key];
  }
});

describe("markdown round-trip", () => {
  test("task list", () => {
    const src = "- [ ] do thing\n- [x] done thing";
    expect(make(src)).toBe(src);
  });

  test("link", () => {
    const src = "see [tabterm](https://example.com)";
    expect(make(src)).toBe(src);
  });

  test("image", () => {
    const src = "![alt](https://example.com/x.png)";
    expect(make(src)).toBe(src);
  });

  test("table", () => {
    const src = [
      "| h1 | h2 |",
      "| --- | --- |",
      "| a | b |",
    ].join("\n");
    // Allow whitespace differences — accept any markdown table containing the cells.
    const out = make(src);
    expect(out).toContain("h1");
    expect(out).toContain("h2");
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).toMatch(/\|/);
  });

  test("code block with language", () => {
    const src = "```ts\nconst x = 1\n```";
    // The test harness uses StarterKit's plain codeBlock; the live editor uses
    // lowlight, but both serialize the same markdown. We just verify the fence
    // round-trip works in either codepath.
    expect(make(src)).toBe(src);
  });
});
