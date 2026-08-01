import type { McpToolContext, ServerHost } from "@tabterm/module-host/server";
import { randomUUID } from "node:crypto";
import type { TaskBundle, TaskMutationResult } from "../shared.ts";
import type { makeTasksDb } from "./tasksDb.ts";

type TasksDb = ReturnType<typeof makeTasksDb>;

function sessionId(ctx: McpToolContext): string {
  if (!ctx.sessionId) throw new Error("not inside an open tabterm session");
  return ctx.sessionId;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function missingTask(): TaskMutationResult {
  return { ok: false, code: "not_found", message: "Task not found" };
}

function ownsTask(tdb: TasksDb, ownerSessionId: string, taskId: string): boolean {
  return tdb.getBundle(ownerSessionId).items.some((item) => item.id === taskId);
}

function broadcastResult(
  host: ServerHost,
  ownerSessionId: string,
  tdb: TasksDb,
  result: TaskMutationResult<unknown>,
  bundle?: TaskBundle,
): string {
  if (result.ok) host.broadcast("tasks:changed", bundle ?? tdb.getBundle(ownerSessionId));
  return pretty(result);
}

export function registerTaskMcpTools(host: ServerHost, tdb: TasksDb): void {
  host.registerMcpTool({
    name: "tasks_list",
    description: "List tasks for the current tabterm session.",
    inputSchema: { type: "object", properties: {} },
    handler: (_args, ctx) => pretty(tdb.getBundle(sessionId(ctx))),
  });

  host.registerMcpTool({
    name: "tasks_claim",
    description: "Claim a specific available task, or the next available task, in the current session.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        agent_id: { type: "string" },
        agent_label: { type: "string" },
      },
      required: ["agent_id", "agent_label"],
    },
    handler: (args, ctx) => {
      const ownerSessionId = sessionId(ctx);
      const taskId = args.task_id as string | undefined;
      if (taskId !== undefined && !ownsTask(tdb, ownerSessionId, taskId)) {
        return pretty(missingTask());
      }
      const result = tdb.claimTask(ownerSessionId, {
        taskId,
        agentId: args.agent_id as string,
        agentLabel: args.agent_label as string,
      });
      return broadcastResult(
        host,
        ownerSessionId,
        tdb,
        result,
        result.ok ? result.value.change.bundle : undefined,
      );
    },
  });

  host.registerMcpTool({
    name: "tasks_renew",
    description: "Renew an active task lease in the current session.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, lease_token: { type: "string" } },
      required: ["task_id", "lease_token"],
    },
    handler: (args, ctx) => {
      const ownerSessionId = sessionId(ctx);
      const taskId = args.task_id as string;
      if (!ownsTask(tdb, ownerSessionId, taskId)) return pretty(missingTask());
      return broadcastResult(
        host,
        ownerSessionId,
        tdb,
        tdb.renewClaim(taskId, args.lease_token as string),
      );
    },
  });

  host.registerMcpTool({
    name: "tasks_ack_comments",
    description: "Acknowledge comments read while holding a task lease.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        lease_token: { type: "string" },
        last_seen_comment_id: { type: "string" },
      },
      required: ["task_id", "lease_token"],
    },
    handler: (args, ctx) => {
      const ownerSessionId = sessionId(ctx);
      const taskId = args.task_id as string;
      if (!ownsTask(tdb, ownerSessionId, taskId)) return pretty(missingTask());
      return broadcastResult(
        host,
        ownerSessionId,
        tdb,
        tdb.ackComments(
          taskId,
          args.lease_token as string,
          typeof args.last_seen_comment_id === "string" ? args.last_seen_comment_id : null,
        ),
      );
    },
  });

  host.registerMcpTool({
    name: "tasks_comment",
    description: "Add an agent comment to a task in the current session.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        agent_id: { type: "string" },
        agent_label: { type: "string" },
        body_markdown: { type: "string" },
      },
      required: ["task_id", "agent_id", "agent_label", "body_markdown"],
    },
    handler: (args, ctx) => {
      const ownerSessionId = sessionId(ctx);
      const taskId = args.task_id as string;
      if (!ownsTask(tdb, ownerSessionId, taskId)) return pretty(missingTask());
      const result = tdb.addComment(taskId, {
        id: randomUUID(),
        authorType: "agent",
        authorId: args.agent_id as string,
        authorLabel: args.agent_label as string,
        bodyMarkdown: args.body_markdown as string,
      });
      return broadcastResult(
        host,
        ownerSessionId,
        tdb,
        result,
        result.ok ? result.value.bundle : undefined,
      );
    },
  });

  host.registerMcpTool({
    name: "tasks_release",
    description: "Release a task lease, optionally leaving a comment.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        lease_token: { type: "string" },
        body_markdown: { type: "string" },
      },
      required: ["task_id", "lease_token"],
    },
    handler: (args, ctx) => {
      const ownerSessionId = sessionId(ctx);
      const taskId = args.task_id as string;
      if (!ownsTask(tdb, ownerSessionId, taskId)) return pretty(missingTask());
      const result = tdb.releaseClaim(
        taskId,
        args.lease_token as string,
        typeof args.body_markdown === "string" ? args.body_markdown : undefined,
      );
      return broadcastResult(
        host,
        ownerSessionId,
        tdb,
        result,
        result.ok ? result.value.bundle : undefined,
      );
    },
  });

  host.registerMcpTool({
    name: "tasks_complete",
    description: "Complete a claimed task with an agent summary.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        lease_token: { type: "string" },
        agent_id: { type: "string" },
        summary_markdown: { type: "string" },
      },
      required: ["task_id", "lease_token", "agent_id", "summary_markdown"],
    },
    handler: (args, ctx) => {
      const ownerSessionId = sessionId(ctx);
      const taskId = args.task_id as string;
      if (!ownsTask(tdb, ownerSessionId, taskId)) return pretty(missingTask());
      const result = tdb.completeAsAgent(
        taskId,
        args.lease_token as string,
        args.agent_id as string,
        args.summary_markdown as string,
      );
      return broadcastResult(
        host,
        ownerSessionId,
        tdb,
        result,
        result.ok ? result.value.bundle : undefined,
      );
    },
  });
}
