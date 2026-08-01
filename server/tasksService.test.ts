import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "./migrations.ts";
import { makeTasksDb } from "./tasksDb.ts";
import { makeTasksService } from "./tasksService.ts";

const sync = {
  set: (entity: string, data: any) => ({ k: "set", entity, data }),
  del: (entity: string, id: string) => ({ k: "del", entity, id }),
  toSender: (msg: any) => ({ k: "toSender", msg }),
};

function freshTaskService() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT NOT NULL, primary_tab_id TEXT NOT NULL)");
  db.exec("INSERT INTO sessions VALUES ('sess1', 'Session', 'tab1')");
  for (const migration of migrations) migration.up(db);
  const tdb = makeTasksDb(db, () => 1_000);
  return { db, tdb, service: makeTasksService(tdb, sync as any) };
}

test("task:create emits the complete authoritative task bundle", () => {
  const { service } = freshTaskService();
  service.handle({ type: "task:create", sessionId: "sess1", id: "t1", title: "First" });
  const effects = service.handle({ type: "task:create", sessionId: "sess1", id: "t2", title: "Second" }) as any[];

  expect(effects.filter((effect) => effect.k === "set" && effect.entity === "taskList")).toHaveLength(1);
  expect(effects.filter((effect) => effect.k === "set" && effect.entity === "taskItem")
    .map((effect) => effect.data.id)).toEqual(["t1", "t2"]);
});

test("domain conflicts return only task:error to the sender", () => {
  const { service } = freshTaskService();
  const effects = service.handle({ type: "task:update", taskId: "missing", title: "No" }) as any[];

  expect(effects).toEqual([{
    k: "toSender",
    msg: { type: "task:error", code: "not_found", message: "Task not found", bundle: undefined },
  }]);
});

test("task:comment emits a user-authored comment patch", () => {
  const { service } = freshTaskService();
  service.handle({ type: "task:create", sessionId: "sess1", id: "t1", title: "Work" });
  const effects = service.handle({ type: "task:comment", taskId: "t1", id: "c1", bodyMarkdown: "Progress" }) as any[];

  expect(effects.find((effect) => effect.entity === "taskComment")?.data).toMatchObject({
    id: "c1",
    taskId: "t1",
    authorType: "user",
    authorId: "local-user",
    authorLabel: "You",
    bodyMarkdown: "Progress",
  });
});

test("task:dependency:set emits a stable dependency entity id", () => {
  const { service } = freshTaskService();
  service.handle({ type: "task:create", sessionId: "sess1", id: "blocker", title: "Blocker" });
  service.handle({ type: "task:create", sessionId: "sess1", id: "blocked", title: "Blocked" });
  const effects = service.handle({
    type: "task:dependency:set",
    taskId: "blocked",
    blockerTaskIds: ["blocker"],
  }) as any[];

  expect(effects.find((effect) => effect.entity === "taskDependency")?.data).toMatchObject({
    id: "blocked:blocker",
    taskId: "blocked",
    blockerTaskId: "blocker",
  });
});

test("task:forceRelease emits the claim tombstone and authoritative pending task", () => {
  const { tdb, service } = freshTaskService();
  tdb.createTask("sess1", { id: "t1", title: "Work" });
  expect(tdb.claimTask("sess1", { taskId: "t1", agentId: "a1", agentLabel: "Agent" }).ok).toBe(true);

  const effects = service.handle({ type: "task:forceRelease", taskId: "t1" }) as any[];

  expect(effects).toContainEqual({ k: "del", entity: "taskClaim", id: "t1" });
  expect(effects.find((effect) => effect.entity === "taskItem" && effect.data.id === "t1")?.data.state)
    .toBe("pending");
});

test("task:delete forwards every explicit cascade tombstone", () => {
  const { tdb, service } = freshTaskService();
  tdb.createTask("sess1", { id: "root", title: "Root" });
  tdb.createTask("sess1", { id: "child", title: "Child", parentTaskId: "root" });
  tdb.createTask("sess1", { id: "outside", title: "Outside" });
  tdb.setDependencies("outside", ["child"]);
  tdb.addComment("child", {
    id: "c1",
    authorType: "user",
    authorId: "local-user",
    authorLabel: "You",
    bodyMarkdown: "Progress",
  });

  const effects = service.handle({ type: "task:delete", taskId: "root", keepChildren: false }) as any[];

  expect(effects).toEqual(expect.arrayContaining([
    { k: "del", entity: "taskItem", id: "root" },
    { k: "del", entity: "taskItem", id: "child" },
    { k: "del", entity: "taskDependency", id: "outside:child" },
    { k: "del", entity: "taskComment", id: "c1" },
  ]));
  expect(effects.some((effect) => effect.k === "set" && effect.entity === "taskItem" && effect.data.id === "root"))
    .toBe(false);
});
