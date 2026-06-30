import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "./migrations.ts";
import { makeNotesDb } from "./db.ts";

// freshDb runs the module migrations, then stubs the core tables that the
// guard queries need (sessionExists → sessions, tabExists → primary_tabs).
// Without these stubs, createWorkspaceNote/createNote would always return null
// because the guards query the same in-memory db for those tables.
function freshDb() {
  const db = new Database(":memory:");
  for (const m of migrations) m.up(db);
  // Stub the core tables the guards query
  db.exec("CREATE TABLE primary_tabs (id TEXT PRIMARY KEY)");
  db.exec("INSERT INTO primary_tabs (id) VALUES ('tab1')");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT NOT NULL, primary_tab_id TEXT NOT NULL)");
  db.exec("INSERT INTO sessions (id, label, primary_tab_id) VALUES ('sess1', 'My Session', 'tab1')");
  return makeNotesDb(db);
}

test("createWorkspaceNote returns a note at version 1", () => {
  const ndb = freshDb();
  const r = ndb.createWorkspaceNote("tab1");
  expect(r).not.toBeNull();
  expect(r!.note.version).toBe(1);
  expect(r!.note.sessionId).toBeNull();
});

test("updateNoteContent applies on matching baseVersion and bumps version", () => {
  const ndb = freshDb();
  const { note } = ndb.createWorkspaceNote("tab1")!;
  const r = ndb.updateNoteContent(note.id, "# Hello\n\nbody", note.version);
  expect(r!.applied).toBe(true);
  expect(r!.note.version).toBe(note.version + 1);
});

test("updateNoteContent rejects a stale baseVersion (conflict)", () => {
  const ndb = freshDb();
  const { note } = ndb.createWorkspaceNote("tab1")!;
  ndb.updateNoteContent(note.id, "v2", note.version); // -> version 2
  const stale = ndb.updateNoteContent(note.id, "v3", note.version); // base still 1
  expect(stale!.applied).toBe(false);
  expect(stale!.note.version).toBe(note.version + 1); // returns authoritative
});

test("deleteNote re-points active note to the most-recent remaining note", () => {
  const ndb = freshDb();
  const a = ndb.createWorkspaceNote("tab1")!;        // becomes active for scope "tab1"
  const b = ndb.createWorkspaceNote("tab1")!;        // now b is active (created later)
  // delete the active one (b) → active should re-point to a
  const r = ndb.deleteNote(b.note.id);
  expect(r).not.toBeNull();
  expect(r!.deletedId).toBe(b.note.id);
  expect(r!.activeChange).toBeDefined();
  expect(r!.activeChange!.scopeId).toBe("tab1");
  expect(r!.activeChange!.noteId).toBe(a.note.id);
});

test("deleteNote of a non-active note reports no activeChange", () => {
  const ndb = freshDb();
  const a = ndb.createWorkspaceNote("tab1")!;        // a active
  ndb.createWorkspaceNote("tab1")!;                  // b active now
  // delete a (NOT active) → activeChange should be absent
  const r = ndb.deleteNote(a.note.id);
  expect(r!.deletedId).toBe(a.note.id);
  expect(r!.activeChange).toBeUndefined();
});

test("deleteNoteFolder reparents its notes to Unsorted", () => {
  const ndb = freshDb();
  const folder = ndb.createNoteFolder("tab1", "F");
  const { note } = ndb.createWorkspaceNote("tab1")!;
  ndb.moveNote(note.id, folder.id);
  const r = ndb.deleteNoteFolder(folder.id);
  expect(r!.reparented.map((n) => n.id)).toContain(note.id);
  expect(r!.reparented.find((n) => n.id === note.id)!.folderId).toBeNull();
});

test("setActiveNote accepts a workspace (tab) scope, not just a session", () => {
  const ndb = freshDb();
  const { note } = ndb.createWorkspaceNote("tab1")!;
  const r = ndb.setActiveNote("tab1", note.id); // tab scope, not session
  expect(r).not.toBeNull();
  expect(r!.scopeId).toBe("tab1");
  expect(r!.noteId).toBe(note.id);
});

test("setActiveNote accepts a session scope", () => {
  const ndb = freshDb();
  const { note } = ndb.createNote("sess1")!; // sess1 stubbed in freshDb
  const r = ndb.setActiveNote("sess1", note.id);
  expect(r!.scopeId).toBe("sess1");
  expect(r!.noteId).toBe(note.id);
});
