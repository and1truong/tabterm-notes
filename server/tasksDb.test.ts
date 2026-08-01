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

test("move rejects when reordering would change a claimed sibling", () => {
  const { db, tdb } = freshTasks();
  tdb.createTask("sess1", { id: "claimed", title: "Claimed" });
  tdb.createTask("sess1", { id: "moving", title: "Moving" });
  const listId = tdb.getBundle("sess1").list!.id;
  db.run("UPDATE task_items SET state = 'in_progress' WHERE id = 'claimed'");
  db.run(
    "INSERT INTO task_claims (task_id, agent_id, agent_label, lease_token_hash, claimed_at, lease_expires_at) VALUES (?, 'a1', 'Agent', 'hash', 1000, 2000)",
    ["claimed"],
  );

  expect(tdb.moveTask("moving", { parentTaskId: null, position: 0 }))
    .toMatchObject({ ok: false, code: "claimed" });
  expect(siblingIds(db, listId, null)).toEqual(["claimed", "moving"]);
});

test("delete rejects when compacting would change a claimed sibling", () => {
  const { db, tdb } = freshTasks();
  tdb.createTask("sess1", { id: "remove", title: "Remove" });
  tdb.createTask("sess1", { id: "claimed", title: "Claimed" });
  const listId = tdb.getBundle("sess1").list!.id;
  db.run("UPDATE task_items SET state = 'in_progress' WHERE id = 'claimed'");
  db.run(
    "INSERT INTO task_claims (task_id, agent_id, agent_label, lease_token_hash, claimed_at, lease_expires_at) VALUES (?, 'a1', 'Agent', 'hash', 1000, 2000)",
    ["claimed"],
  );

  expect(tdb.deleteTask("remove", false)).toMatchObject({ ok: false, code: "claimed" });
  expect(siblingIds(db, listId, null)).toEqual(["remove", "claimed"]);
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

test("moving an incomplete child away rolls up its old parent", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "parent", title: "Parent" });
  tdb.createTask("sess1", { id: "done", title: "Done", parentTaskId: "parent" });
  tdb.createTask("sess1", { id: "moving", title: "Moving", parentTaskId: "parent" });
  tdb.completeAsUser("done", "u1");

  const result = tdb.moveTask("moving", { parentTaskId: null, position: 1 });
  expect(result.ok && result.value.bundle.items.find((item) => item.id === "parent")?.state)
    .toBe("completed");
});

test("moving a completed child under a parent rolls up the destination", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "done", title: "Done" });
  tdb.createTask("sess1", { id: "destination", title: "Destination" });
  tdb.completeAsUser("done", "u1");

  const result = tdb.moveTask("done", { parentTaskId: "destination", position: 0 });
  expect(result.ok && result.value.bundle.items.find((item) => item.id === "destination")?.state)
    .toBe("completed");
});

test("deleting an incomplete child rolls up the affected ancestry", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "root", title: "Root" });
  tdb.createTask("sess1", { id: "parent", title: "Parent", parentTaskId: "root" });
  tdb.createTask("sess1", { id: "done", title: "Done", parentTaskId: "parent" });
  tdb.createTask("sess1", { id: "remove", title: "Remove", parentTaskId: "parent" });
  tdb.completeAsUser("done", "u1");

  const result = tdb.deleteTask("remove", false);
  expect(result.ok && result.value.bundle.items.map((item) => [item.id, item.state]))
    .toEqual([["root", "completed"], ["parent", "completed"], ["done", "completed"]]);
});

test("adding an incomplete child reopens a completed parent chain", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "root", title: "Root" });
  tdb.completeAsUser("root", "u1");
  const result = tdb.createTask("sess1", { id: "child", title: "Child", parentTaskId: "root" });
  expect(result.ok && result.value.bundle.items.map((item) => [item.id, item.state]))
    .toEqual([["root", "pending"], ["child", "pending"]]);
});

test("create revalidates its parent after entering the transaction", () => {
  const { db, tdb } = freshTasks();
  tdb.createTask("sess1", { id: "parent", title: "Parent" });
  let entered = false;
  const racingTasks = makeTasksDb(db, () => {
    if (!entered) {
      entered = true;
      db.run("DELETE FROM task_items WHERE id = 'parent'");
    }
    return 2_000;
  });
  let result: ReturnType<typeof racingTasks.createTask> | null = null;

  expect(() => {
    result = racingTasks.createTask("sess1", { id: "child", title: "Child", parentTaskId: "parent" });
  }).not.toThrow();
  expect(result).toMatchObject({ ok: false, code: "not_found" });
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

test("two agents cannot claim the same available leaf", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "t1", title: "Work" });
  const first = tdb.claimTask("sess1", { taskId: "t1", agentId: "a1", agentLabel: "Agent 1" });
  expect(first.ok).toBe(true);
  expect(tdb.claimTask("sess1", { taskId: "t1", agentId: "a2", agentLabel: "Agent 2" }))
    .toMatchObject({ ok: false, code: "claimed" });
});

test("claim selection follows stored tree order and rejects parents and blocked leaves", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "parent", title: "Parent" });
  tdb.createTask("sess1", { id: "later-root", title: "Later root" });
  tdb.createTask("sess1", { id: "first-child", title: "First child", parentTaskId: "parent" });
  tdb.createTask("sess1", { id: "second-child", title: "Second child", parentTaskId: "parent" });
  tdb.setDependencies("first-child", ["second-child"]);

  expect(tdb.claimTask("sess1", { taskId: "parent", agentId: "a1", agentLabel: "Agent" }))
    .toMatchObject({ ok: false, code: "not_available" });
  expect(tdb.claimTask("sess1", { taskId: "first-child", agentId: "a1", agentLabel: "Agent" }))
    .toMatchObject({ ok: false, code: "not_available" });
  const selected = tdb.claimTask("sess1", { agentId: "a1", agentLabel: "Agent" });
  expect(selected.ok && selected.value.change.bundle.claims[0]?.taskId).toBe("second-child");
});

test("a reopened parent with completed children cannot be claimed", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "parent", title: "Parent" });
  tdb.createTask("sess1", { id: "child", title: "Child", parentTaskId: "parent" });
  expect(tdb.completeAsUser("child", "u1").ok).toBe(true);
  expect(tdb.reopenTask("parent").ok).toBe(true);

  expect(tdb.claimTask("sess1", {
    taskId: "parent", agentId: "a1", agentLabel: "Agent",
  })).toMatchObject({ ok: false, code: "not_available" });
});

test("renewal after thirty seconds extends the lease to two minutes from now", () => {
  const { tdb, setNow } = freshTasks();
  tdb.createTask("sess1", { id: "t1", title: "Work" });
  const claimed = tdb.claimTask("sess1", { taskId: "t1", agentId: "a1", agentLabel: "Agent" });
  if (!claimed.ok) throw new Error("claim failed");
  expect(claimed.value.change.bundle.claims[0]?.leaseExpiresAt).toBe(121_000);

  setNow(31_000);
  const renewed = tdb.renewClaim("t1", claimed.value.leaseToken);
  expect(renewed.ok && renewed.value.leaseExpiresAt).toBe(151_000);
});

test("expired leases return their task to pending and cannot be renewed", () => {
  const { tdb, setNow } = freshTasks();
  tdb.createTask("sess1", { id: "t1", title: "Work" });
  const claimed = tdb.claimTask("sess1", { taskId: "t1", agentId: "a1", agentLabel: "Agent" });
  if (!claimed.ok) throw new Error("claim failed");

  setNow(121_000);
  expect(tdb.renewClaim("t1", claimed.value.leaseToken))
    .toMatchObject({ ok: false, code: "lease_expired" });
  expect(tdb.getBundle("sess1")).toMatchObject({
    claims: [],
    items: [{ id: "t1", state: "pending" }],
  });
});

test("lease operations reject the wrong opaque token", () => {
  const { db, tdb } = freshTasks();
  tdb.createTask("sess1", { id: "t1", title: "Work" });
  const claimed = tdb.claimTask("sess1", { taskId: "t1", agentId: "a1", agentLabel: "Agent" });
  if (!claimed.ok) throw new Error("claim failed");

  expect(tdb.renewClaim("t1", "wrong-token")).toMatchObject({ ok: false, code: "lease_mismatch" });
  expect(tdb.ackComments("t1", "wrong-token", null)).toMatchObject({ ok: false, code: "lease_mismatch" });
  expect(tdb.releaseClaim("t1", "wrong-token")).toMatchObject({ ok: false, code: "lease_mismatch" });
  expect(tdb.completeAsAgent("t1", "wrong-token", "a1", "Done"))
    .toMatchObject({ ok: false, code: "lease_mismatch" });
  expect(tdb.completeAsAgent("t1", claimed.value.leaseToken, "a2", "Done"))
    .toMatchObject({ ok: false, code: "lease_mismatch" });
  expect(tdb.completeAsAgent("t1", claimed.value.leaseToken, "a1", "   "))
    .toMatchObject({ ok: false, code: "invalid_input" });
  const stored = db.query<{ lease_token_hash: string }, []>("SELECT lease_token_hash FROM task_claims").get()!;
  expect(stored.lease_token_hash).not.toBe(claimed.value.leaseToken);
  expect(stored.lease_token_hash).toHaveLength(64);
});

test("voluntary release can add an agent comment and forced release removes a claim", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "voluntary", title: "Voluntary" });
  tdb.createTask("sess1", { id: "forced", title: "Forced" });
  const voluntary = tdb.claimTask("sess1", {
    taskId: "voluntary", agentId: "a1", agentLabel: "Agent One",
  });
  const forced = tdb.claimTask("sess1", { taskId: "forced", agentId: "a2", agentLabel: "Agent Two" });
  if (!voluntary.ok || !forced.ok) throw new Error("claim failed");

  const released = tdb.releaseClaim("voluntary", voluntary.value.leaseToken, "Pausing here");
  expect(released.ok && released.value.bundle.items.find((item) => item.id === "voluntary")?.state)
    .toBe("pending");
  expect(released.ok && released.value.bundle.comments[0]).toMatchObject({
    taskId: "voluntary",
    authorType: "agent",
    authorId: "a1",
    authorLabel: "Agent One",
    bodyMarkdown: "Pausing here",
    kind: "comment",
  });
  const forceReleased = tdb.forceRelease("forced");
  expect(forceReleased.ok && forceReleased.value.bundle.claims).toEqual([]);
  expect(forceReleased.ok && forceReleased.value.bundle.items.find((item) => item.id === "forced")?.state)
    .toBe("pending");
});

test("comments remain mutable by their author while a task is claimed", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "t1", title: "Work" });
  tdb.claimTask("sess1", { taskId: "t1", agentId: "a1", agentLabel: "Agent" });
  const actor = { authorType: "user" as const, authorId: "u1" };

  expect(tdb.addComment("t1", {
    id: "c1", ...actor, authorLabel: "You", bodyMarkdown: "Original",
  }).ok).toBe(true);
  expect(tdb.updateComment("c1", { ...actor, bodyMarkdown: "Edited" }).ok).toBe(true);
  const bundle = tdb.getBundle("sess1");
  expect(bundle.comments[0]).toMatchObject({ bodyMarkdown: "Edited", updatedAt: 1_000 });
  expect(tdb.deleteComment("c1", actor).ok).toBe(true);
  expect(tdb.getBundle("sess1").comments).toEqual([]);
});

test("only a regular comment author may edit or delete it", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "t1", title: "Work" });
  tdb.addComment("t1", {
    id: "c1", authorType: "user", authorId: "u1", authorLabel: "You", bodyMarkdown: "Original",
  });

  expect(tdb.updateComment("c1", {
    authorType: "user", authorId: "u2", bodyMarkdown: "Hijacked",
  })).toMatchObject({ ok: false, code: "not_available" });
  expect(tdb.deleteComment("c1", { authorType: "agent", authorId: "u1" }))
    .toMatchObject({ ok: false, code: "not_available" });
  expect(tdb.getBundle("sess1").comments[0]?.bodyMarkdown).toBe("Original");
});

test("agent completion rejects unseen comments then atomically stores summary", () => {
  const { tdb } = freshTasks();
  tdb.createTask("sess1", { id: "t1", title: "Work" });
  const claim = tdb.claimTask("sess1", { taskId: "t1", agentId: "a1", agentLabel: "Agent" });
  const token = claim.ok ? claim.value.leaseToken : "";
  tdb.addComment("t1", {
    id: "c1", authorType: "user", authorId: "u1", authorLabel: "You", bodyMarkdown: "Check this",
  });
  const rejected = tdb.completeAsAgent("t1", token, "a1", "Done");
  expect(rejected).toMatchObject({ ok: false, code: "unseen_comments" });
  expect(!rejected.ok && rejected.value?.comments.map((comment) => comment.id)).toEqual(["c1"]);
  expect(tdb.getBundle("sess1")).toMatchObject({
    claims: [{ taskId: "t1" }],
    items: [{ id: "t1", state: "in_progress" }],
    comments: [{ id: "c1", kind: "comment" }],
  });

  expect(tdb.ackComments("t1", token, "c1").ok).toBe(true);
  expect(tdb.completeAsAgent("t1", token, "a1", "Done").ok).toBe(true);
  expect(tdb.getBundle("sess1")).toMatchObject({
    claims: [],
    items: [{ id: "t1", state: "completed", completedByType: "agent", completedById: "a1" }],
    comments: [
      { id: "c1", kind: "comment" },
      { authorType: "agent", authorId: "a1", authorLabel: "Agent", bodyMarkdown: "Done", kind: "completion_summary" },
    ],
  });
});

test("completion summaries are immutable and retained across reopen and re-complete", () => {
  const { tdb, setNow } = freshTasks();
  tdb.createTask("sess1", { id: "t1", title: "Work" });
  const first = tdb.claimTask("sess1", { taskId: "t1", agentId: "a1", agentLabel: "Agent One" });
  if (!first.ok) throw new Error("claim failed");
  expect(tdb.completeAsAgent("t1", first.value.leaseToken, "a1", "First pass").ok).toBe(true);
  const firstSummary = tdb.getBundle("sess1").comments[0]!;
  expect(tdb.updateComment(firstSummary.id, {
    authorType: "agent", authorId: "a1", bodyMarkdown: "Changed",
  })).toMatchObject({ ok: false, code: "not_available" });
  expect(tdb.deleteComment(firstSummary.id, { authorType: "agent", authorId: "a1" }))
    .toMatchObject({ ok: false, code: "not_available" });

  setNow(2_000);
  tdb.reopenTask("t1");
  const second = tdb.claimTask("sess1", { taskId: "t1", agentId: "a2", agentLabel: "Agent Two" });
  if (!second.ok) throw new Error("claim failed");
  tdb.ackComments("t1", second.value.leaseToken, firstSummary.id);
  expect(tdb.completeAsAgent("t1", second.value.leaseToken, "a2", "Second pass").ok).toBe(true);
  expect(tdb.getBundle("sess1").comments.map((comment) => [comment.bodyMarkdown, comment.kind]))
    .toEqual([
      ["First pass", "completion_summary"],
      ["Second pass", "completion_summary"],
    ]);
});
