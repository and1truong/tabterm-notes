import { useMemo } from "react";
import type { ClientHost } from "@tabterm/module-host/client";
import type {
  TaskBundle,
  TaskClaim,
  TaskComment,
  TaskDependency,
  TaskItem,
  TaskList,
} from "../shared.ts";

type Bucket<T> = Record<string, T>;

const EMPTY_LIST_BUCKET: Bucket<TaskList> = {};
const EMPTY_ITEM_BUCKET: Bucket<TaskItem> = {};
const EMPTY_DEPENDENCY_BUCKET: Bucket<TaskDependency> = {};
const EMPTY_CLAIM_BUCKET: Bucket<TaskClaim> = {};
const EMPTY_COMMENT_BUCKET: Bucket<TaskComment> = {};

const EMPTY_ITEMS: TaskItem[] = [];
const EMPTY_DEPENDENCIES: TaskDependency[] = [];
const EMPTY_CLAIMS: TaskClaim[] = [];
const EMPTY_COMMENTS: TaskComment[] = [];

export function taskBundleFromBuckets(
  sessionId: string,
  lists: Bucket<TaskList>,
  items: Bucket<TaskItem>,
  dependencies: Bucket<TaskDependency>,
  claims: Bucket<TaskClaim>,
  comments: Bucket<TaskComment>,
): TaskBundle {
  const list = Object.values(lists).find((candidate) => candidate.sessionId === sessionId) ?? null;
  if (!list) {
    return {
      list: null,
      items: EMPTY_ITEMS,
      dependencies: EMPTY_DEPENDENCIES,
      claims: EMPTY_CLAIMS,
      comments: EMPTY_COMMENTS,
    };
  }

  const listItems = Object.values(items).filter((item) => item.listId === list.id);
  const taskIds = new Set(listItems.map((item) => item.id));
  const listDependencies = Object.values(dependencies).filter((dependency) => taskIds.has(dependency.taskId));
  const listClaims = Object.values(claims).filter((claim) => taskIds.has(claim.taskId));
  const listComments = Object.values(comments).filter((comment) => taskIds.has(comment.taskId));
  return {
    list,
    items: listItems.length > 0 ? listItems : EMPTY_ITEMS,
    dependencies: listDependencies.length > 0 ? listDependencies : EMPTY_DEPENDENCIES,
    claims: listClaims.length > 0 ? listClaims : EMPTY_CLAIMS,
    comments: listComments.length > 0 ? listComments : EMPTY_COMMENTS,
  };
}

export function useTaskBundle(host: ClientHost, sessionId: string): TaskBundle {
  const lists = host.store.use((state) =>
    (state.taskList as Bucket<TaskList> | undefined) ?? EMPTY_LIST_BUCKET);
  const items = host.store.use((state) =>
    (state.taskItem as Bucket<TaskItem> | undefined) ?? EMPTY_ITEM_BUCKET);
  const dependencies = host.store.use((state) =>
    (state.taskDependency as Bucket<TaskDependency> | undefined) ?? EMPTY_DEPENDENCY_BUCKET);
  const claims = host.store.use((state) =>
    (state.taskClaim as Bucket<TaskClaim> | undefined) ?? EMPTY_CLAIM_BUCKET);
  const comments = host.store.use((state) =>
    (state.taskComment as Bucket<TaskComment> | undefined) ?? EMPTY_COMMENT_BUCKET);

  return useMemo(
    () => taskBundleFromBuckets(sessionId, lists, items, dependencies, claims, comments),
    [sessionId, lists, items, dependencies, claims, comments],
  );
}
