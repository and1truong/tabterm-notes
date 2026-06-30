import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "./migrations.ts";
import { makeNotesDb } from "./db.ts";
import { makeNotesService } from "./service.ts";

// Capture effects as tagged tuples so we can assert without core internals.
const sync = {
  set: (entity: string, data: any) => ({ k: "set", entity, data }),
  del: (entity: string, id: string) => ({ k: "del", entity, id }),
  toSender: (msg: any) => ({ k: "toSender", msg }),
};

function freshSvc() {
  const db = new Database(":memory:");
  for (const m of migrations) m.up(db);
  db.exec("CREATE TABLE primary_tabs (id TEXT PRIMARY KEY)");
  db.exec("INSERT INTO primary_tabs (id) VALUES ('tab1')");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT NOT NULL, primary_tab_id TEXT NOT NULL)");
  db.exec("INSERT INTO sessions (id, label, primary_tab_id) VALUES ('sess1', 'My Session', 'tab1')");
  const ndb = makeNotesDb(db);
  return { ndb, service: makeNotesService(ndb, sync as any) };
}

test("note:update happy path emits a set('note') effect", () => {
  const { ndb, service } = freshSvc();
  const { note } = ndb.createWorkspaceNote("tab1")!;
  const effs = service.handle({ type: "note:update", noteId: note.id, content: "# Hi", baseVersion: note.version }) as any[];
  expect(effs).toHaveLength(1);
  expect(effs[0].k).toBe("set");
  expect(effs[0].entity).toBe("note");
});

test("note:update stale baseVersion emits a toSender conflict", () => {
  const { ndb, service } = freshSvc();
  const { note } = ndb.createWorkspaceNote("tab1")!;
  ndb.updateNoteContent(note.id, "v2", note.version); // version -> 2
  const effs = service.handle({ type: "note:update", noteId: note.id, content: "v3", baseVersion: note.version }) as any[];
  expect(effs[0].k).toBe("toSender");
  expect(effs[0].msg.type).toBe("module:patch");
  expect(effs[0].msg.entity).toBe("conflict");
});

test("note:create workspace emits set('note') and set('activeNote')", () => {
  const { service } = freshSvc();
  const effs = service.handle({ type: "note:create", primaryTabId: "tab1" }) as any[];
  expect(effs).toHaveLength(2);
  expect(effs[0].k).toBe("set");
  expect(effs[0].entity).toBe("note");
  expect(effs[1].k).toBe("set");
  expect(effs[1].entity).toBe("activeNote");
});
