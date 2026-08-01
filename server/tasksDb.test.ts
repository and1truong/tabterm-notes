import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "./migrations.ts";
import { makeTasksDb } from "./tasksDb.ts";

function freshDb() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT NOT NULL, primary_tab_id TEXT NOT NULL)");
  db.exec("INSERT INTO sessions VALUES ('sess1', 'Session', 'tab1')");
  db.exec("INSERT INTO sessions VALUES ('sess2', 'Other session', 'tab1')");
  for (const m of migrations) m.up(db);
  return db;
}

function freshTasks() {
  const db = freshDb();
  let clock = 1_000;
  return {
    db,
    tdb: makeTasksDb(db, () => clock),
    setNow(value: number) { clock = value; },
  };
}

function siblingIds(
  db: Database,
  listId: string,
  parentTaskId: string | null,
): string[] {
  return db.query<{ id: string }, [string, string | null]>(
    "SELECT id FROM task_items WHERE list_id = ? AND parent_task_id IS ? ORDER BY position",
  ).all(listId, parentTaskId).map((row) => row.id);
}

test("task migration creates all task tables and cascades from session", () => {
  const db = freshDb();
  const names = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'task_%'",
  ).all().map((r) => r.name).sort();
  expect(names).toEqual(["task_claims", "task_comments", "task_dependencies", "task_items", "task_lists"]);
  db.run("INSERT INTO task_lists (id, session_id) VALUES ('l1', 'sess1')");
  db.run("INSERT INTO task_items (id, list_id, title, position) VALUES ('t1', 'l1', 'Work', 0)");
  db.run("DELETE FROM sessions WHERE id = 'sess1'");
  expect(db.query("SELECT id FROM task_lists").all()).toEqual([]);
  expect(db.query("SELECT id FROM task_items").all()).toEqual([]);
});

test("reading is lazy and first create atomically creates one list", () => {
  const { db, tdb } = freshTasks();
  expect(tdb.getBundle("sess1").list).toBeNull();
  expect(tdb.createTask("sess1", { id: "t1", title: "First" }).ok).toBe(true);
  expect(tdb.createTask("sess1", { id: "t2", title: "Second" }).ok).toBe(true);
  expect(db.query<{ n: number }, []>("SELECT count(*) n FROM task_lists").get()!.n).toBe(1);
  expect(tdb.createTask("missing", { id: "t3", title: "Missing" }))
    .toMatchObject({ ok: false, code: "not_found" });
});

test("create and update require trimmed non-empty titles", () => {
  const { db, tdb } = freshTasks();
  expect(tdb.createTask("sess1", { id: "blank", title: "  \t " }))
    .toMatchObject({ ok: false, code: "invalid_input" });
  expect(db.query<{ n: number }, []>("SELECT count(*) n FROM task_lists").get()!.n).toBe(0);

  const created = tdb.createTask("sess1", { id: "t1", title: "  First task  " });
  expect(created.ok && created.value.bundle.items[0]?.title).toBe("First task");
  expect(tdb.updateTask("t1", { title: "   " }))
    .toMatchObject({ ok: false, code: "invalid_input" });
  const updated = tdb.updateTask("t1", { title: "  Renamed  ", detailsMarkdown: "Details" });
  expect(updated.ok && updated.value.bundle.items[0]).toMatchObject({
    title: "Renamed",
    detailsMarkdown: "Details",
  });
});

test("parents and blockers must exist in the same list", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "a", title: "A" });
  tdb.createTask("sess1", { id: "b", title: "B" });
  tdb.createTask("sess2", { id: "other", title: "Other" });

  expect(tdb.createTask("sess1", { id: "bad-child", title: "Child", parentTaskId: "other" }))
    .toMatchObject({ ok: false, code: "cross_list" });
  expect(tdb.moveTask("b", { parentTaskId: "other", position: 0 }))
    .toMatchObject({ ok: false, code: "cross_list" });
  expect(tdb.setDependencies("a", ["other"]))
    .toMatchObject({ ok: false, code: "cross_list" });
  expect(tdb.setDependencies("a", ["missing"]))
    .toMatchObject({ ok: false, code: "not_found" });
});

test("hierarchy and dependency cycles are rejected", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "a", title: "A" });
  tdb.createTask("sess1", { id: "b", title: "B", parentTaskId: "a" });
  expect(tdb.moveTask("a", { parentTaskId: "b", position: 0 }))
    .toMatchObject({ ok: false, code: "hierarchy_cycle" });
  expect(tdb.setDependencies("a", ["b"]).ok).toBe(true);
  expect(tdb.setDependencies("b", ["a"]))
    .toMatchObject({ ok: false, code: "dependency_cycle" });
  expect(tdb.setDependencies("a", ["a"]))
    .toMatchObject({ ok: false, code: "dependency_cycle" });
});

test("create appends siblings and move keeps both sibling groups densely ordered", () => {
  const { db, tdb } = freshTasks();
  tdb.createTask("sess1", { id: "a", title: "A" });
  tdb.createTask("sess1", { id: "b", title: "B" });
  tdb.createTask("sess1", { id: "c", title: "C" });
  tdb.createTask("sess1", { id: "a1", title: "A1", parentTaskId: "a" });
  const listId = tdb.getBundle("sess1").list!.id;

  expect(siblingIds(db, listId, null)).toEqual(["a", "b", "c"]);
  expect(tdb.moveTask("c", { parentTaskId: null, position: 1 }).ok).toBe(true);
  expect(siblingIds(db, listId, null)).toEqual(["a", "c", "b"]);
  expect(tdb.moveTask("c", { parentTaskId: "a", position: 0 }).ok).toBe(true);
  expect(siblingIds(db, listId, null)).toEqual(["a", "b"]);
  expect(siblingIds(db, listId, "a")).toEqual(["c", "a1"]);
});

test("subtree delete removes descendants and returns all cascade tombstones", () => {
  const { db, tdb, setNow } = freshTasks();
  tdb.createTask("sess1", { id: "root", title: "Root" });
  tdb.createTask("sess1", { id: "child", title: "Child", parentTaskId: "root" });
  tdb.createTask("sess1", { id: "grandchild", title: "Grandchild", parentTaskId: "child" });
  tdb.createTask("sess1", { id: "outside", title: "Outside" });
  tdb.setDependencies("outside", ["grandchild"]);
  db.run(
    "INSERT INTO task_comments (id, task_id, author_type, author_id, author_label, body_markdown) VALUES (?, ?, 'user', 'u1', 'You', 'Comment')",
    ["comment1", "child"],
  );
  db.run("UPDATE task_items SET state = 'in_progress' WHERE id = 'grandchild'");
  db.run(
    "INSERT INTO task_claims (task_id, agent_id, agent_label, lease_token_hash, claimed_at, lease_expires_at) VALUES (?, 'a1', 'Agent', 'hash', 1000, 1500)",
    ["grandchild"],
  );
  setNow(2_000);

  const result = tdb.deleteTask("root", false);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.bundle.items.map((item) => item.id)).toEqual(["outside"]);
  expect(result.value.deleted).toEqual(expect.arrayContaining([
    { entity: "taskItem", id: "root" },
    { entity: "taskItem", id: "child" },
    { entity: "taskItem", id: "grandchild" },
    { entity: "taskDependency", id: "outside:grandchild" },
    { entity: "taskClaim", id: "grandchild" },
    { entity: "taskComment", id: "comment1" },
  ]));
});

test("keep-children delete promotes direct children at the deleted sibling position", () => {
  const { db, tdb } = freshTasks();
  tdb.createTask("sess1", { id: "before", title: "Before" });
  tdb.createTask("sess1", { id: "parent", title: "Parent" });
  tdb.createTask("sess1", { id: "after", title: "After" });
  tdb.createTask("sess1", { id: "first", title: "First", parentTaskId: "parent" });
  tdb.createTask("sess1", { id: "second", title: "Second", parentTaskId: "parent" });
  tdb.createTask("sess1", { id: "nested", title: "Nested", parentTaskId: "first" });
  const listId = tdb.getBundle("sess1").list!.id;

  const result = tdb.deleteTask("parent", true);
  expect(result.ok).toBe(true);
  expect(siblingIds(db, listId, null)).toEqual(["before", "first", "second", "after"]);
  expect(siblingIds(db, listId, "first")).toEqual(["nested"]);
  expect(result.ok && result.value.deleted).toContainEqual({ entity: "taskItem", id: "parent" });
});

test("only unblocked pending leaves are available for user completion", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "parent", title: "Parent" });
  tdb.createTask("sess1", { id: "child", title: "Child", parentTaskId: "parent" });
  expect(tdb.completeAsUser("parent", "u1"))
    .toMatchObject({ ok: false, code: "not_available" });

  tdb.createTask("sess1", { id: "blocked", title: "Blocked" });
  tdb.createTask("sess1", { id: "blocker", title: "Blocker" });
  tdb.setDependencies("blocked", ["blocker"]);
  expect(tdb.completeAsUser("blocked", "u1"))
    .toMatchObject({ ok: false, code: "not_available" });
  expect(tdb.completeAsUser("blocker", "u1").ok).toBe(true);
  expect(tdb.completeAsUser("blocked", "u1").ok).toBe(true);
});

test("user completion rolls up parents and reopening a descendant reopens ancestors", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "root", title: "Root" });
  tdb.createTask("sess1", { id: "branch", title: "Branch", parentTaskId: "root" });
  tdb.createTask("sess1", { id: "leaf", title: "Leaf", parentTaskId: "branch" });
  const completed = tdb.completeAsUser("leaf", "u1");
  expect(completed.ok && completed.value.bundle.items.map((item) => [item.id, item.state]))
    .toEqual([["root", "completed"], ["branch", "completed"], ["leaf", "completed"]]);

  const reopened = tdb.reopenTask("leaf");
  expect(reopened.ok && reopened.value.bundle.items.map((item) => [item.id, item.state]))
    .toEqual([["root", "pending"], ["branch", "pending"], ["leaf", "pending"]]);
  expect(reopened.ok && reopened.value.bundle.items.every((item) => item.completedAt === null)).toBe(true);
});

test("adding an incomplete child reopens a completed parent chain", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "root", title: "Root" });
  tdb.completeAsUser("root", "u1");
  const result = tdb.createTask("sess1", { id: "child", title: "Child", parentTaskId: "root" });
  expect(result.ok && result.value.bundle.items.map((item) => [item.id, item.state]))
    .toEqual([["root", "pending"], ["child", "pending"]]);
});

test("active claims reject task mutations and expired claims are released", () => {
  const { db, tdb, setNow } = freshTasks();
  tdb.createTask("sess1", { id: "claimed", title: "Claimed" });
  tdb.createTask("sess1", { id: "other", title: "Other" });
  db.run("UPDATE task_items SET state = 'in_progress' WHERE id = 'claimed'");
  db.run(
    "INSERT INTO task_claims (task_id, agent_id, agent_label, lease_token_hash, claimed_at, lease_expires_at) VALUES (?, 'a1', 'Agent', 'hash', 1000, 2000)",
    ["claimed"],
  );

  expect(tdb.updateTask("claimed", { title: "Changed" })).toMatchObject({ ok: false, code: "claimed" });
  expect(tdb.updateTask("claimed", { title: "   " })).toMatchObject({ ok: false, code: "claimed" });
  expect(tdb.moveTask("claimed", { parentTaskId: null, position: 1 })).toMatchObject({ ok: false, code: "claimed" });
  expect(tdb.moveTask("claimed", { parentTaskId: null, position: -1 })).toMatchObject({ ok: false, code: "claimed" });
  expect(tdb.setDependencies("claimed", ["other"])).toMatchObject({ ok: false, code: "claimed" });
  expect(tdb.deleteTask("claimed", false)).toMatchObject({ ok: false, code: "claimed" });
  expect(tdb.completeAsUser("claimed", "u1")).toMatchObject({ ok: false, code: "claimed" });

  setNow(2_001);
  const result = tdb.updateTask("claimed", { title: "Changed" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.deleted).toContainEqual({ entity: "taskClaim", id: "claimed" });
  expect(result.value.bundle.items.find((item) => item.id === "claimed"))
    .toMatchObject({ title: "Changed", state: "pending" });
});

test("a failed mutation does not commit lease-expiry cleanup", () => {
  const { db, tdb, setNow } = freshTasks();
  tdb.createTask("sess1", { id: "claimed", title: "Claimed" });
  db.run("UPDATE task_items SET state = 'in_progress' WHERE id = 'claimed'");
  db.run(
    "INSERT INTO task_claims (task_id, agent_id, agent_label, lease_token_hash, claimed_at, lease_expires_at) VALUES (?, 'a1', 'Agent', 'hash', 1000, 2000)",
    ["claimed"],
  );
  setNow(2_001);

  expect(tdb.updateTask("claimed", { title: "   " }))
    .toMatchObject({ ok: false, code: "invalid_input" });
  expect(db.query<{ n: number }, []>("SELECT count(*) n FROM task_claims").get()!.n).toBe(1);
  expect(db.query<{ state: string }, [string]>("SELECT state FROM task_items WHERE id = ?").get("claimed")!.state)
    .toBe("in_progress");
});

test("dependency replacement returns tombstones for removed edges", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "task", title: "Task" });
  tdb.createTask("sess1", { id: "first", title: "First" });
  tdb.createTask("sess1", { id: "second", title: "Second" });
  tdb.setDependencies("task", ["first", "second"]);

  const result = tdb.setDependencies("task", ["second"]);
  expect(result.ok && result.value.deleted)
    .toContainEqual({ entity: "taskDependency", id: "task:first" });
});
