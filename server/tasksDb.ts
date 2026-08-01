import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type {
  TaskBundle,
  TaskChangeSet,
  TaskClaim,
  TaskComment,
  TaskDependency,
  TaskErrorCode,
  TaskItem,
  TaskList,
  TaskMutationResult,
  TaskState,
} from "../shared.ts";

interface TaskListRow {
  id: string;
  session_id: string;
  created_at: number;
  updated_at: number;
}

interface TaskItemRow {
  id: string;
  list_id: string;
  parent_task_id: string | null;
  title: string;
  details_markdown: string;
  position: number;
  state: string;
  completed_at: number | null;
  completed_by_type: string | null;
  completed_by_id: string | null;
  created_at: number;
  updated_at: number;
}

interface TaskDependencyRow {
  task_id: string;
  blocker_task_id: string;
  created_at: number;
}

interface TaskClaimRow {
  task_id: string;
  agent_id: string;
  agent_label: string;
  claimed_at: number;
  lease_expires_at: number;
  last_seen_comment_id: string | null;
}

interface TaskCommentRow {
  id: string;
  task_id: string;
  author_type: string;
  author_id: string;
  author_label: string;
  body_markdown: string;
  kind: string;
  created_at: number;
  updated_at: number | null;
}

type DeletedEntity = TaskChangeSet["deleted"][number];
type TaskFailure = Extract<TaskMutationResult, { ok: false }>;

const toTaskList = (row: TaskListRow): TaskList => ({
  id: row.id,
  sessionId: row.session_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTaskItem = (row: TaskItemRow): TaskItem => ({
  id: row.id,
  listId: row.list_id,
  parentTaskId: row.parent_task_id,
  title: row.title,
  detailsMarkdown: row.details_markdown,
  position: row.position,
  state: row.state as TaskState,
  completedAt: row.completed_at,
  completedByType: row.completed_by_type as TaskItem["completedByType"],
  completedById: row.completed_by_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTaskDependency = (row: TaskDependencyRow): TaskDependency => ({
  taskId: row.task_id,
  blockerTaskId: row.blocker_task_id,
  createdAt: row.created_at,
});

const toTaskClaim = (row: TaskClaimRow): TaskClaim => ({
  taskId: row.task_id,
  agentId: row.agent_id,
  agentLabel: row.agent_label,
  claimedAt: row.claimed_at,
  leaseExpiresAt: row.lease_expires_at,
  lastSeenCommentId: row.last_seen_comment_id,
});

const toTaskComment = (row: TaskCommentRow): TaskComment => ({
  id: row.id,
  taskId: row.task_id,
  authorType: row.author_type as TaskComment["authorType"],
  authorId: row.author_id,
  authorLabel: row.author_label,
  bodyMarkdown: row.body_markdown,
  kind: row.kind as TaskComment["kind"],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function failed(code: TaskErrorCode, message: string): TaskFailure {
  return { ok: false, code, message };
}

class MutationAbort extends Error {
  constructor(readonly result: TaskFailure) {
    super(result.message);
  }
}

export function makeTasksDb(db: Database, now: () => number) {
  const q = {
    sessionExists: db.query<{ id: string }, [string]>("SELECT id FROM sessions WHERE id = ?"),
    listBySession: db.query<TaskListRow, [string]>("SELECT * FROM task_lists WHERE session_id = ?"),
    listById: db.query<TaskListRow, [string]>("SELECT * FROM task_lists WHERE id = ?"),
    insertList: db.query(
      "INSERT OR IGNORE INTO task_lists (id, session_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ),
    touchList: db.query("UPDATE task_lists SET updated_at = ? WHERE id = ?"),
    taskById: db.query<TaskItemRow, [string]>("SELECT * FROM task_items WHERE id = ?"),
    itemsByList: db.query<TaskItemRow, [string]>(
      "SELECT * FROM task_items WHERE list_id = ? ORDER BY created_at, rowid",
    ),
    siblingIds: db.query<{ id: string }, [string, string | null]>(
      "SELECT id FROM task_items WHERE list_id = ? AND parent_task_id IS ? ORDER BY position, rowid",
    ),
    maxSiblingPosition: db.query<{ position: number | null }, [string, string | null]>(
      "SELECT MAX(position) position FROM task_items WHERE list_id = ? AND parent_task_id IS ?",
    ),
    insertTask: db.query(
      "INSERT INTO task_items " +
        "(id, list_id, parent_task_id, title, position, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    ),
    updateTitle: db.query("UPDATE task_items SET title = ?, updated_at = ? WHERE id = ?"),
    updateDetails: db.query("UPDATE task_items SET details_markdown = ?, updated_at = ? WHERE id = ?"),
    setParentPosition: db.query(
      "UPDATE task_items SET parent_task_id = ?, position = ?, updated_at = ? WHERE id = ?",
    ),
    setPending: db.query(
      "UPDATE task_items SET state = 'pending', completed_at = NULL, completed_by_type = NULL, " +
        "completed_by_id = NULL, updated_at = ? WHERE id = ?",
    ),
    setPendingIfInProgress: db.query(
      "UPDATE task_items SET state = 'pending', updated_at = ? WHERE id = ? AND state = 'in_progress'",
    ),
    setCompleted: db.query(
      "UPDATE task_items SET state = 'completed', completed_at = ?, completed_by_type = ?, " +
        "completed_by_id = ?, updated_at = ? WHERE id = ?",
    ),
    deleteTask: db.query("DELETE FROM task_items WHERE id = ?"),
    dependenciesByList: db.query<TaskDependencyRow, [string]>(
      "SELECT d.* FROM task_dependencies d JOIN task_items t ON t.id = d.task_id " +
        "WHERE t.list_id = ? ORDER BY d.created_at, d.rowid",
    ),
    dependenciesForTask: db.query<TaskDependencyRow, [string]>(
      "SELECT * FROM task_dependencies WHERE task_id = ? ORDER BY created_at, rowid",
    ),
    insertDependency: db.query(
      "INSERT INTO task_dependencies (task_id, blocker_task_id, created_at) VALUES (?, ?, ?)",
    ),
    deleteDependency: db.query(
      "DELETE FROM task_dependencies WHERE task_id = ? AND blocker_task_id = ?",
    ),
    claimsByList: db.query<TaskClaimRow, [string]>(
      "SELECT c.task_id, c.agent_id, c.agent_label, c.claimed_at, c.lease_expires_at, c.last_seen_comment_id " +
        "FROM task_claims c JOIN task_items t ON t.id = c.task_id WHERE t.list_id = ? ORDER BY c.task_id",
    ),
    expiredClaimsByList: db.query<{ task_id: string }, [string, number]>(
      "SELECT c.task_id FROM task_claims c JOIN task_items t ON t.id = c.task_id " +
        "WHERE t.list_id = ? AND c.lease_expires_at <= ?",
    ),
    activeClaim: db.query<{ task_id: string }, [string, number]>(
      "SELECT task_id FROM task_claims WHERE task_id = ? AND lease_expires_at > ?",
    ),
    deleteClaim: db.query("DELETE FROM task_claims WHERE task_id = ?"),
    commentsByList: db.query<TaskCommentRow, [string]>(
      "SELECT c.* FROM task_comments c JOIN task_items t ON t.id = c.task_id " +
        "WHERE t.list_id = ? ORDER BY c.created_at, c.rowid",
    ),
  };

  function pushDeleted(deleted: DeletedEntity[], entity: DeletedEntity["entity"], id: string) {
    if (!deleted.some((entry) => entry.entity === entity && entry.id === id)) {
      deleted.push({ entity, id });
    }
  }

  function abort(code: TaskErrorCode, message: string): never {
    throw new MutationAbort(failed(code, message));
  }

  function mutate(run: () => TaskMutationResult): TaskMutationResult {
    try {
      return db.transaction(run)();
    } catch (error) {
      if (error instanceof MutationAbort) return error.result;
      throw error;
    }
  }

  function bundleForList(list: TaskListRow): TaskBundle {
    return {
      list: toTaskList(list),
      items: q.itemsByList.all(list.id).map(toTaskItem),
      dependencies: q.dependenciesByList.all(list.id).map(toTaskDependency),
      claims: q.claimsByList.all(list.id).map(toTaskClaim),
      comments: q.commentsByList.all(list.id).map(toTaskComment),
    };
  }

  function changed(listId: string, deleted: DeletedEntity[]): TaskMutationResult {
    const list = q.listById.get(listId);
    if (!list) abort("not_found", "Task list not found");
    return { ok: true, value: { bundle: bundleForList(list), deleted } };
  }

  function expireClaims(listId: string, at: number, deleted: DeletedEntity[]) {
    const expired = q.expiredClaimsByList.all(listId, at);
    for (const claim of expired) {
      q.deleteClaim.run(claim.task_id);
      q.setPendingIfInProgress.run(at, claim.task_id);
      pushDeleted(deleted, "taskClaim", claim.task_id);
    }
    if (expired.length > 0) q.touchList.run(at, listId);
  }

  function hasActiveClaim(taskId: string, at: number): boolean {
    return q.activeClaim.get(taskId, at) !== null;
  }

  function reopenUpwards(taskId: string | null, at: number) {
    let currentId = taskId;
    const visited = new Set<string>();
    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const current = q.taskById.get(currentId);
      if (!current) break;
      if (current.state === "completed") q.setPending.run(at, current.id);
      currentId = current.parent_task_id;
    }
  }

  function hierarchyWouldCycle(taskId: string, parentTaskId: string): boolean {
    let currentId: string | null = parentTaskId;
    const visited = new Set<string>();
    while (currentId !== null && !visited.has(currentId)) {
      if (currentId === taskId) return true;
      visited.add(currentId);
      currentId = q.taskById.get(currentId)?.parent_task_id ?? null;
    }
    return false;
  }

  function dependencyWouldCycle(
    taskId: string,
    blockerTaskIds: string[],
    listId: string,
  ): boolean {
    const nextByTask = new Map<string, string[]>();
    for (const dependency of q.dependenciesByList.all(listId)) {
      const next = nextByTask.get(dependency.task_id) ?? [];
      next.push(dependency.blocker_task_id);
      nextByTask.set(dependency.task_id, next);
    }
    nextByTask.set(taskId, blockerTaskIds);

    const stack = [...blockerTaskIds];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === taskId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...(nextByTask.get(current) ?? []));
    }
    return false;
  }

  function writeSiblingOrder(
    listId: string,
    parentTaskId: string | null,
    taskIds: string[],
    at: number,
  ) {
    const changedTasks = taskIds.flatMap((taskId, position) => {
      const task = q.taskById.get(taskId);
      if (!task || (task.parent_task_id === parentTaskId && task.position === position)) return [];
      return [{ task, position }];
    });
    if (changedTasks.some(({ task }) => hasActiveClaim(task.id, at))) {
      abort("claimed", "Sibling ordering would change a claimed task");
    }
    for (const { task, position } of changedTasks) {
      q.setParentPosition.run(parentTaskId, position, at, task.id);
    }
    if (changedTasks.length > 0) q.touchList.run(at, listId);
  }

  function childIdsByParent(listId: string): Map<string, string[]> {
    const children = new Map<string, string[]>();
    for (const item of q.itemsByList.all(listId)) {
      if (item.parent_task_id === null) continue;
      const ids = children.get(item.parent_task_id) ?? [];
      ids.push(item.id);
      children.set(item.parent_task_id, ids);
    }
    return children;
  }

  function subtreeIds(taskId: string, listId: string): string[] {
    const children = childIdsByParent(listId);
    const ids: string[] = [];
    const stack = [taskId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      ids.push(current);
      stack.push(...(children.get(current) ?? []));
    }
    return ids;
  }

  function isAvailable(task: TaskItemRow, at: number): boolean {
    if (task.state !== "pending" || hasActiveClaim(task.id, at)) return false;
    const hasIncompleteChild = q.itemsByList.all(task.list_id)
      .some((item) => item.parent_task_id === task.id && item.state !== "completed");
    if (hasIncompleteChild) return false;
    return q.dependenciesForTask.all(task.id).every((dependency) => {
      return q.taskById.get(dependency.blocker_task_id)?.state === "completed";
    });
  }

  function rollUpParents(
    parentTaskId: string | null,
    actorType: "user" | "agent",
    actorId: string,
    at: number,
  ) {
    let currentId = parentTaskId;
    const visited = new Set<string>();
    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const parent = q.taskById.get(currentId);
      if (!parent) break;
      const children = q.itemsByList.all(parent.list_id)
        .filter((item) => item.parent_task_id === parent.id);
      if (children.length === 0 || children.some((child) => child.state !== "completed")) break;
      q.setCompleted.run(at, actorType, actorId, at, parent.id);
      currentId = parent.parent_task_id;
    }
  }

  function reconcileStructuralAncestors(parentTaskId: string | null, at: number) {
    let currentId = parentTaskId;
    const visited = new Set<string>();
    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const parent = q.taskById.get(currentId);
      if (!parent) break;
      const children = q.itemsByList.all(parent.list_id)
        .filter((item) => item.parent_task_id === parent.id);
      const shouldComplete = children.length > 0 && children.every((child) => child.state === "completed");
      if (shouldComplete && parent.state !== "completed") {
        q.setCompleted.run(at, null, null, at, parent.id);
      } else if (!shouldComplete && parent.state === "completed") {
        q.setPending.run(at, parent.id);
      }
      currentId = parent.parent_task_id;
    }
  }

  function getBundle(sessionId: string): TaskBundle {
    return db.transaction(() => {
      const list = q.listBySession.get(sessionId);
      if (!list) return { list: null, items: [], dependencies: [], claims: [], comments: [] };
      expireClaims(list.id, now(), []);
      return bundleForList(q.listById.get(list.id)!);
    })();
  }

  function createTask(
    sessionId: string,
    input: { id: string; title: string; parentTaskId?: string },
  ): TaskMutationResult {
    const title = input.title.trim();
    if (title.length === 0) return failed("invalid_input", "Task title is required");

    return mutate(() => {
      const at = now();
      if (!q.sessionExists.get(sessionId)) abort("not_found", "Session not found");
      if (q.taskById.get(input.id)) abort("invalid_input", "Task id already exists");
      const parent = input.parentTaskId === undefined ? null : q.taskById.get(input.parentTaskId);
      if (input.parentTaskId !== undefined && !parent) abort("not_found", "Parent task not found");
      if (parent) {
        const parentList = q.listById.get(parent.list_id);
        if (parentList?.session_id !== sessionId) abort("cross_list", "Parent belongs to another list");
      }
      q.insertList.run(randomUUID(), sessionId, at, at);
      const list = q.listBySession.get(sessionId)!;
      const deleted: DeletedEntity[] = [];
      expireClaims(list.id, at, deleted);
      if (parent && hasActiveClaim(parent.id, at)) abort("claimed", "Parent task is claimed");
      const position = (q.maxSiblingPosition.get(list.id, parent?.id ?? null)?.position ?? -1) + 1;
      q.insertTask.run(input.id, list.id, parent?.id ?? null, title, position, at, at);
      if (parent) reconcileStructuralAncestors(parent.id, at);
      q.touchList.run(at, list.id);
      return changed(list.id, deleted);
    });
  }

  function updateTask(
    taskId: string,
    patch: { title?: string; detailsMarkdown?: string },
  ): TaskMutationResult {
    const title = patch.title?.trim();
    const existing = q.taskById.get(taskId);
    if (!existing) return failed("not_found", "Task not found");

    return mutate(() => {
      const at = now();
      const deleted: DeletedEntity[] = [];
      expireClaims(existing.list_id, at, deleted);
      if (hasActiveClaim(taskId, at)) abort("claimed", "Task is claimed");
      if (title !== undefined && title.length === 0) {
        abort("invalid_input", "Task title is required");
      }
      if (title !== undefined) q.updateTitle.run(title, at, taskId);
      if (patch.detailsMarkdown !== undefined) q.updateDetails.run(patch.detailsMarkdown, at, taskId);
      if (title !== undefined || patch.detailsMarkdown !== undefined) q.touchList.run(at, existing.list_id);
      return changed(existing.list_id, deleted);
    });
  }

  function moveTask(
    taskId: string,
    move: { parentTaskId: string | null; position: number },
  ): TaskMutationResult {
    const existing = q.taskById.get(taskId);
    if (!existing) return failed("not_found", "Task not found");

    return mutate(() => {
      const at = now();
      const deleted: DeletedEntity[] = [];
      expireClaims(existing.list_id, at, deleted);
      if (hasActiveClaim(taskId, at)) abort("claimed", "Task is claimed");
      if (!Number.isInteger(move.position) || move.position < 0) {
        abort("invalid_input", "Position must be a non-negative integer");
      }

      const parent = move.parentTaskId === null ? null : q.taskById.get(move.parentTaskId);
      if (move.parentTaskId !== null && !parent) abort("not_found", "Parent task not found");
      if (parent?.list_id !== undefined && parent.list_id !== existing.list_id) {
        abort("cross_list", "Parent belongs to another list");
      }
      if (parent && hasActiveClaim(parent.id, at)) abort("claimed", "Parent task is claimed");
      if (parent && hierarchyWouldCycle(taskId, parent.id)) {
        abort("hierarchy_cycle", "Task hierarchy would contain a cycle");
      }

      const oldParentId = existing.parent_task_id;
      const destinationParentId = parent?.id ?? null;
      if (oldParentId !== destinationParentId) {
        const oldIds = q.siblingIds.all(existing.list_id, oldParentId)
          .map((row) => row.id).filter((id) => id !== taskId);
        writeSiblingOrder(existing.list_id, oldParentId, oldIds, at);
      }
      const destinationIds = q.siblingIds.all(existing.list_id, destinationParentId)
        .map((row) => row.id).filter((id) => id !== taskId);
      destinationIds.splice(Math.min(move.position, destinationIds.length), 0, taskId);
      writeSiblingOrder(existing.list_id, destinationParentId, destinationIds, at);
      reconcileStructuralAncestors(oldParentId, at);
      if (destinationParentId !== oldParentId) reconcileStructuralAncestors(destinationParentId, at);
      return changed(existing.list_id, deleted);
    });
  }

  function setDependencies(taskId: string, blockerTaskIds: string[]): TaskMutationResult {
    const task = q.taskById.get(taskId);
    if (!task) return failed("not_found", "Task not found");
    const blockerIds = [...new Set(blockerTaskIds)];

    return mutate(() => {
      const at = now();
      const deleted: DeletedEntity[] = [];
      expireClaims(task.list_id, at, deleted);
      if (hasActiveClaim(taskId, at)) abort("claimed", "Task is claimed");
      for (const blockerId of blockerIds) {
        const blocker = q.taskById.get(blockerId);
        if (!blocker) abort("not_found", "Blocker task not found");
        if (blocker.list_id !== task.list_id) abort("cross_list", "Blocker belongs to another list");
      }
      if (dependencyWouldCycle(taskId, blockerIds, task.list_id)) {
        abort("dependency_cycle", "Task dependencies would contain a cycle");
      }

      const oldIds = q.dependenciesForTask.all(taskId).map((row) => row.blocker_task_id);
      for (const oldId of oldIds) {
        if (blockerIds.includes(oldId)) continue;
        q.deleteDependency.run(taskId, oldId);
        pushDeleted(deleted, "taskDependency", `${taskId}:${oldId}`);
      }
      for (const blockerId of blockerIds) {
        if (!oldIds.includes(blockerId)) q.insertDependency.run(taskId, blockerId, at);
      }
      if (oldIds.length !== blockerIds.length || oldIds.some((id) => !blockerIds.includes(id))) {
        q.touchList.run(at, task.list_id);
      }
      return changed(task.list_id, deleted);
    });
  }

  function deleteTask(taskId: string, keepChildren: boolean): TaskMutationResult {
    const task = q.taskById.get(taskId);
    if (!task) return failed("not_found", "Task not found");

    return mutate(() => {
      const at = now();
      const deleted: DeletedEntity[] = [];
      expireClaims(task.list_id, at, deleted);
      const directChildIds = q.siblingIds.all(task.list_id, taskId).map((row) => row.id);
      const removedIds = keepChildren ? [taskId] : subtreeIds(taskId, task.list_id);
      const claimSensitiveIds = keepChildren ? [taskId, ...directChildIds] : removedIds;
      if (claimSensitiveIds.some((id) => hasActiveClaim(id, at))) {
        abort("claimed", "Task or affected descendant is claimed");
      }

      const removed = new Set(removedIds);
      for (const dependency of q.dependenciesByList.all(task.list_id)) {
        if (removed.has(dependency.task_id) || removed.has(dependency.blocker_task_id)) {
          pushDeleted(deleted, "taskDependency", `${dependency.task_id}:${dependency.blocker_task_id}`);
        }
      }
      for (const claim of q.claimsByList.all(task.list_id)) {
        if (removed.has(claim.task_id)) pushDeleted(deleted, "taskClaim", claim.task_id);
      }
      for (const comment of q.commentsByList.all(task.list_id)) {
        if (removed.has(comment.task_id)) pushDeleted(deleted, "taskComment", comment.id);
      }
      for (const id of removedIds) pushDeleted(deleted, "taskItem", id);

      const oldSiblingIds = q.siblingIds.all(task.list_id, task.parent_task_id)
        .map((row) => row.id).filter((id) => id !== taskId);
      if (keepChildren) {
        const insertion = Math.min(task.position, oldSiblingIds.length);
        oldSiblingIds.splice(insertion, 0, ...directChildIds);
        writeSiblingOrder(task.list_id, task.parent_task_id, oldSiblingIds, at);
      }
      q.deleteTask.run(taskId);
      if (!keepChildren) writeSiblingOrder(task.list_id, task.parent_task_id, oldSiblingIds, at);
      reconcileStructuralAncestors(task.parent_task_id, at);
      q.touchList.run(at, task.list_id);
      return changed(task.list_id, deleted);
    });
  }

  function completeAsUser(taskId: string, userId: string): TaskMutationResult {
    const task = q.taskById.get(taskId);
    if (!task) return failed("not_found", "Task not found");

    return mutate(() => {
      const at = now();
      const deleted: DeletedEntity[] = [];
      expireClaims(task.list_id, at, deleted);
      if (hasActiveClaim(taskId, at)) abort("claimed", "Task is claimed");
      const current = q.taskById.get(taskId)!;
      if (!isAvailable(current, at)) abort("not_available", "Task is not available");
      q.setCompleted.run(at, "user", userId, at, taskId);
      rollUpParents(current.parent_task_id, "user", userId, at);
      q.touchList.run(at, task.list_id);
      return changed(task.list_id, deleted);
    });
  }

  function reopenTask(taskId: string): TaskMutationResult {
    const task = q.taskById.get(taskId);
    if (!task) return failed("not_found", "Task not found");

    return mutate(() => {
      const at = now();
      const deleted: DeletedEntity[] = [];
      expireClaims(task.list_id, at, deleted);
      if (hasActiveClaim(taskId, at)) abort("claimed", "Task is claimed");
      reopenUpwards(taskId, at);
      q.touchList.run(at, task.list_id);
      return changed(task.list_id, deleted);
    });
  }

  return {
    getBundle,
    createTask,
    updateTask,
    moveTask,
    setDependencies,
    deleteTask,
    completeAsUser,
    reopenTask,
  };
}
