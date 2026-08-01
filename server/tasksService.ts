import type { Effect } from "@tabterm/module-host/server";
import type { TaskBundle, TaskCommand, TaskMutationResult } from "../shared.ts";
import type { makeTasksDb } from "./tasksDb.ts";

type Sync = {
  set(entity: string, data: unknown): Effect;
  del(entity: string, id: string): Effect;
  toSender(msg: unknown): Effect;
};

function bundleEffects(bundle: TaskBundle, sync: Sync): Effect[] {
  const effects: Effect[] = [];
  if (bundle.list) effects.push(sync.set("taskList", bundle.list));
  effects.push(...bundle.items.map((item) => sync.set("taskItem", item)));
  effects.push(...bundle.dependencies.map((dependency) => sync.set("taskDependency", {
    ...dependency,
    id: `${dependency.taskId}:${dependency.blockerTaskId}`,
  })));
  effects.push(...bundle.claims.map((claim) => sync.set("taskClaim", { ...claim, id: claim.taskId })));
  effects.push(...bundle.comments.map((comment) => sync.set("taskComment", comment)));
  return effects;
}

export function makeTasksService(tdb: ReturnType<typeof makeTasksDb>, sync: Sync) {
  function effects(result: TaskMutationResult): Effect[] {
    if (!result.ok) {
      return [sync.toSender({
        type: "task:error",
        code: result.code,
        message: result.message,
        bundle: result.value,
      })];
    }
    return [
      ...bundleEffects(result.value.bundle, sync),
      ...result.value.deleted.map((deleted) => sync.del(deleted.entity, deleted.id)),
    ];
  }

  function handle(msg: TaskCommand): Effect[] {
    switch (msg.type) {
      case "task:create":
        return effects(tdb.createTask(msg.sessionId, {
          id: msg.id,
          title: msg.title,
          parentTaskId: msg.parentTaskId,
        }));
      case "task:update":
        return effects(tdb.updateTask(msg.taskId, {
          title: msg.title,
          detailsMarkdown: msg.detailsMarkdown,
        }));
      case "task:move":
        return effects(tdb.moveTask(msg.taskId, {
          parentTaskId: msg.parentTaskId,
          position: msg.position,
        }));
      case "task:dependency:set":
        return effects(tdb.setDependencies(msg.taskId, msg.blockerTaskIds));
      case "task:complete":
        return effects(tdb.completeAsUser(msg.taskId, "local-user"));
      case "task:reopen":
        return effects(tdb.reopenTask(msg.taskId));
      case "task:delete":
        return effects(tdb.deleteTask(msg.taskId, msg.keepChildren));
      case "task:forceRelease":
        return effects(tdb.forceRelease(msg.taskId));
      case "task:comment":
        return effects(tdb.addComment(msg.taskId, {
          id: msg.id,
          authorType: "user",
          authorId: "local-user",
          authorLabel: "You",
          bodyMarkdown: msg.bodyMarkdown,
        }));
      case "task:comment:update":
        return effects(tdb.updateComment(msg.commentId, {
          authorType: "user",
          authorId: "local-user",
          bodyMarkdown: msg.bodyMarkdown,
        }));
      case "task:comment:delete":
        return effects(tdb.deleteComment(msg.commentId, {
          authorType: "user",
          authorId: "local-user",
        }));
    }
  }

  return { handle };
}
