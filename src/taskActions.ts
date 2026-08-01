import type { ClientHost } from "@tabterm/module-host/client";
import type { TaskCommand } from "../shared.ts";
import { uuid } from "./uuid.ts";

function send(host: ClientHost, command: TaskCommand): void {
  host.send(command);
}

export function createTask(
  host: ClientHost,
  sessionId: string,
  title: string,
  parentTaskId?: string,
): string {
  const id = uuid();
  send(host, {
    type: "task:create",
    sessionId,
    id,
    title,
    ...(parentTaskId === undefined ? {} : { parentTaskId }),
  });
  return id;
}

export function updateTask(
  host: ClientHost,
  taskId: string,
  changes: { title?: string; detailsMarkdown?: string },
): void {
  send(host, { type: "task:update", taskId, ...changes });
}

export function moveTask(
  host: ClientHost,
  taskId: string,
  parentTaskId: string | null,
  position: number,
): void {
  send(host, { type: "task:move", taskId, parentTaskId, position });
}

export function setTaskDependencies(host: ClientHost, taskId: string, blockerTaskIds: string[]): void {
  send(host, { type: "task:dependency:set", taskId, blockerTaskIds });
}

export function completeTask(host: ClientHost, taskId: string): void {
  send(host, { type: "task:complete", taskId });
}

export function reopenTask(host: ClientHost, taskId: string): void {
  send(host, { type: "task:reopen", taskId });
}

export function deleteTask(host: ClientHost, taskId: string, keepChildren: boolean): void {
  send(host, { type: "task:delete", taskId, keepChildren });
}

export function forceReleaseTask(host: ClientHost, taskId: string): void {
  send(host, { type: "task:forceRelease", taskId });
}

export function addTaskComment(host: ClientHost, taskId: string, bodyMarkdown: string): string {
  const id = uuid();
  send(host, { type: "task:comment", taskId, id, bodyMarkdown });
  return id;
}

export function updateTaskComment(host: ClientHost, commentId: string, bodyMarkdown: string): void {
  send(host, { type: "task:comment:update", commentId, bodyMarkdown });
}

export function deleteTaskComment(host: ClientHost, commentId: string): void {
  send(host, { type: "task:comment:delete", commentId });
}
