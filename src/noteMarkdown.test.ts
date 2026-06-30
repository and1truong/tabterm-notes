import { expect, test } from "bun:test";
import { isBlankNoteContent, ensureLeadingHeading } from "./noteMarkdown.ts";

test("blank: empty string is blank", () => {
  expect(isBlankNoteContent("")).toBe(true);
});

test("blank: bare heading marker is init noise", () => {
  expect(isBlankNoteContent("#")).toBe(true);
  expect(isBlankNoteContent("# ")).toBe(true);
});

test("blank: ensureLeadingHeading('') output is blank", () => {
  // Couples the guard to the actual normalized empty doc the editor emits on init.
  expect(isBlankNoteContent(ensureLeadingHeading(""))).toBe(true); // "# \n\n"
});

test("blank: whitespace-only is blank", () => {
  expect(isBlankNoteContent("   ")).toBe(true);
  expect(isBlankNoteContent("# \n\n   ")).toBe(true);
});

test("not blank: heading with a title creates", () => {
  expect(isBlankNoteContent("# My title")).toBe(false);
});

test("not blank: #tag (no space) is real content", () => {
  expect(isBlankNoteContent("#tag")).toBe(false);
});

test("not blank: body text under an empty heading creates", () => {
  expect(isBlankNoteContent("# \n\nhello")).toBe(false);
});
