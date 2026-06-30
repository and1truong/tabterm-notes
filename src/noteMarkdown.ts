// The note editor enforces a `heading block*` document schema, so a note's
// markdown must lead with an ATX heading or ProseMirror rejects it. This
// guarantees that: if the first non-empty line isn't a heading, prepend an
// empty H1. A bare "#" / "# " counts as a heading so an already-empty leading
// heading isn't doubled on reload (idempotent).
export function ensureLeadingHeading(md: string): string {
  const firstLine = md
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  // Matches "#", "# ", "# x", "## y" (1-6 hashes then a space or end-of-line).
  // Rejects "#tag" (no space) and "C#" (doesn't start with #) — consistent with
  // the server's deriveTitle(), which also requires a space after the markers.
  if (firstLine && /^#{1,6}(\s.*|$)/.test(firstLine)) return md;
  return `# \n\n${md}`;
}

// True when markdown carries no user content yet — either literally empty or an
// "empty heading" doc (just the leading "#"/"# " that ensureLeadingHeading mints
// and tiptap emits on init). Suppresses the empty-state first-keystroke auto-create
// so opening the editor doesn't mint a blank note. A heading WITH a title ("# x")
// or any body text is NOT blank and creates the note.
export function isBlankNoteContent(markdown: string): boolean {
  // Strip a single leading ATX marker only when nothing but whitespace follows it
  // on that line, so "# title" / "#tag" / "# \n\nbody" survive as content.
  const stripped = markdown.replace(/^#{1,6}([ \t]*)(?=\n|$)/, "");
  return stripped.trim().length === 0;
}

// True when text carries markdown structure worth rendering on paste. Block
// markers are checked per-line; inline markers anywhere. Deliberately does NOT
// match a bare single `*`/`_` so things like "2 * 3 = 6" paste literally.
export function looksLikeMarkdown(text: string): boolean {
  const blockRe = /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~|(-{3,}|\*{3,}|_{3,})\s*$)/;
  if (text.split("\n").some((l) => blockRe.test(l))) return true;
  return /\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]\n]+\]\([^)\n]+\)/.test(text);
}
