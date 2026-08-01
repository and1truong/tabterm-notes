import { describe, expect, test } from "bun:test";
import type { ClientHost } from "@tabterm/module-host/client";
import type {
  TaskBundle,
  TaskClaim,
  TaskComment,
  TaskDependency,
  TaskItem,
  TaskList,
} from "../../shared.ts";
import {
  addTaskComment,
  completeTask,
  createTask,
  deleteTask,
  deleteTaskComment,
  forceReleaseTask,
  moveTask,
  reopenTask,
  setTaskDependencies,
  updateTask,
  updateTaskComment,
} from "../taskActions.ts";
import { taskBundleFromBuckets } from "../taskStore.ts";
import {
  buildTaskTree,
  compactTaskTree,
  completedGroups,
  type TaskNode,
} from "./taskTree.ts";

const list: TaskList = { id: "list-1", sessionId: "session-1", createdAt: 1, updatedAt: 1 };

function item(id: string, overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id,
    listId: list.id,
    parentTaskId: null,
    title: id,
    detailsMarkdown: "",
    position: 0,
    state: "pending",
    completedAt: null,
    completedByType: null,
    completedById: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function bundle(
  items: TaskItem[],
  dependencies: TaskDependency[] = [],
  claims: TaskClaim[] = [],
  comments: TaskComment[] = [],
): TaskBundle {
  return { list, items, dependencies, claims, comments };
}

function claim(taskId: string, agentLabel: string, leaseExpiresAt: number): TaskClaim {
  return {
    taskId,
    agentId: `agent-${taskId}`,
    agentLabel,
    claimedAt: 1,
    leaseExpiresAt,
    lastSeenCommentId: null,
  };
}

function comment(id: string, taskId: string, kind: TaskComment["kind"]): TaskComment {
  return {
    id,
    taskId,
    authorType: "user",
    authorId: "local-user",
    authorLabel: "You",
    bodyMarkdown: id,
    kind,
    createdAt: 1,
    updatedAt: null,
  };
}

function flatten(nodes: TaskNode[]): TaskNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe("task tree projection", () => {
  test("builds arbitrary nesting and keeps stable sibling position order", () => {
    const nodes = buildTaskTree(bundle([
      item("same-a", { position: 2 }),
      item("grandchild", { parentTaskId: "child", position: 0 }),
      item("same-b", { position: 2 }),
      item("child", { parentTaskId: "root", position: 0 }),
      item("early", { position: 1 }),
      item("root", { position: 0 }),
    ]));

    expect(nodes.map((node) => node.task.id)).toEqual(["root", "early", "same-a", "same-b"]);
    expect(nodes[0]!.children[0]!.children[0]!.task.id).toBe("grandchild");
  });

  test("compacts to two levels, reveals expanded descendants, and counts hidden completed children", () => {
    const nodes = buildTaskTree(bundle([
      item("root"),
      item("active-child", { parentTaskId: "root", position: 0 }),
      item("done-child", { parentTaskId: "root", position: 1, state: "completed" }),
      item("other-child", { parentTaskId: "root", position: 2 }),
      item("grandchild", { parentTaskId: "active-child" }),
    ]));

    const compact = compactTaskTree(nodes, new Set());
    expect(compact[0]!.children.map((node) => node.task.id)).toEqual(["active-child", "other-child"]);
    expect(compact[0]!.hiddenCompletedCount).toBe(1);
    expect(compact[0]!.children[0]!.children).toEqual([]);

    const expanded = compactTaskTree(nodes, new Set(["active-child"]));
    expect(expanded[0]!.children[0]!.children.map((node) => node.task.id)).toEqual(["grandchild"]);
  });

  test("extracts completed root subtrees while preserving their hierarchy", () => {
    const nodes = buildTaskTree(bundle([
      item("active-root"),
      item("active-child", { parentTaskId: "active-root", position: 0 }),
      item("done-child", { parentTaskId: "active-root", position: 1, state: "completed" }),
      item("done-root", { position: 1, state: "completed" }),
      item("done-grandchild", { parentTaskId: "done-root", state: "completed" }),
    ]));

    const groups = completedGroups(nodes);
    expect(groups.active.map((node) => node.task.id)).toEqual(["active-root"]);
    expect(groups.active[0]!.children.map((node) => node.task.id)).toEqual(["active-child", "done-child"]);
    expect(groups.completed.map((node) => node.task.id)).toEqual(["done-root"]);
    expect(groups.completed[0]!.children[0]!.task.id).toBe("done-grandchild");
  });

  test("derives dependencies, claims, comments, and all four availability predicates", () => {
    const pendingBlocker = item("pending-blocker");
    const completedBlocker = item("completed-blocker", { state: "completed" });
    const comments = [
      comment("c1", "available", "comment"),
      comment("c2", "available", "completion_summary"),
    ];
    const claims = [
      claim("claimed", "Agent", Date.now() + 60_000),
      claim("expired", "Old", Date.now() - 1),
    ];
    const nodes = buildTaskTree(bundle([
      item("parent"),
      item("child", { parentTaskId: "parent" }),
      pendingBlocker,
      completedBlocker,
      item("available"),
      item("blocked"),
      item("unblocked"),
      item("claimed"),
      item("expired"),
      item("in-progress", { state: "in_progress" }),
    ], [
      { taskId: "blocked", blockerTaskId: pendingBlocker.id, createdAt: 1 },
      { taskId: "unblocked", blockerTaskId: completedBlocker.id, createdAt: 1 },
    ], claims, comments));
    const byId = new Map(flatten(nodes).map((node) => [node.task.id, node]));

    expect(byId.get("available")).toMatchObject({ available: true, commentCount: 2, claim: null });
    expect(byId.get("parent")!.available).toBe(false);
    expect(byId.get("blocked")).toMatchObject({ available: false, blockers: [{ id: "pending-blocker" }] });
    expect(byId.get("unblocked")!.available).toBe(true);
    expect(byId.get("claimed")).toMatchObject({ available: false, claim: { agentLabel: "Agent" } });
    expect(byId.get("expired")).toMatchObject({ available: true, claim: { agentLabel: "Old" } });
    expect(byId.get("in-progress")!.available).toBe(false);
  });

  test("keeps a pending parent unavailable when its only child is completed", () => {
    const nodes = buildTaskTree(bundle([
      item("reopened-parent"),
      item("completed-child", { parentTaskId: "reopened-parent", state: "completed" }),
    ]));

    expect(nodes[0]!.available).toBe(false);
  });
});

test("an empty task bundle reuses module-level stable array references", () => {
  const first = taskBundleFromBuckets("missing", {}, {}, {}, {}, {});
  const second = taskBundleFromBuckets("missing", {}, {}, {}, {}, {});

  expect(first.list).toBeNull();
  expect(first.items).toBe(second.items);
  expect(first.dependencies).toBe(second.dependencies);
  expect(first.claims).toBe(second.claims);
  expect(first.comments).toBe(second.comments);
});

test("task actions send exact TaskCommand payloads", () => {
  const sent: Record<string, unknown>[] = [];
  const host = {
    send(command: Record<string, unknown>) {
      sent.push(command);
    },
  } as unknown as ClientHost;

  const taskId = createTask(host, "session-1", "Write tests", "parent");
  updateTask(host, taskId, { title: "Implement", detailsMarkdown: "Details" });
  moveTask(host, taskId, null, 3);
  setTaskDependencies(host, taskId, ["blocker"]);
  completeTask(host, taskId);
  reopenTask(host, taskId);
  deleteTask(host, taskId, true);
  forceReleaseTask(host, taskId);
  const commentId = addTaskComment(host, taskId, "Ready");
  updateTaskComment(host, commentId, "Updated");
  deleteTaskComment(host, commentId);

  expect(sent).toEqual([
    { type: "task:create", sessionId: "session-1", id: taskId, title: "Write tests", parentTaskId: "parent" },
    { type: "task:update", taskId, title: "Implement", detailsMarkdown: "Details" },
    { type: "task:move", taskId, parentTaskId: null, position: 3 },
    { type: "task:dependency:set", taskId, blockerTaskIds: ["blocker"] },
    { type: "task:complete", taskId },
    { type: "task:reopen", taskId },
    { type: "task:delete", taskId, keepChildren: true },
    { type: "task:forceRelease", taskId },
    { type: "task:comment", taskId, id: commentId, bodyMarkdown: "Ready" },
    { type: "task:comment:update", commentId, bodyMarkdown: "Updated" },
    { type: "task:comment:delete", commentId },
  ]);
});
