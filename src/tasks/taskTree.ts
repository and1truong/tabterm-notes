import type { TaskBundle, TaskClaim, TaskItem } from "../../shared.ts";

export interface TaskNode {
  task: TaskItem;
  children: TaskNode[];
  blockers: TaskItem[];
  claim: TaskClaim | null;
  commentCount: number;
  hiddenCompletedCount: number;
  available: boolean;
}

export function buildTaskTree(bundle: TaskBundle): TaskNode[] {
  const itemById = new Map(bundle.items.map((item) => [item.id, item]));
  const blockersByTask = new Map<string, TaskItem[]>();
  for (const dependency of bundle.dependencies) {
    const blocker = itemById.get(dependency.blockerTaskId);
    if (!blocker) continue;
    const blockers = blockersByTask.get(dependency.taskId) ?? [];
    blockers.push(blocker);
    blockersByTask.set(dependency.taskId, blockers);
  }

  const claimsByTask = new Map(bundle.claims.map((claim) => [claim.taskId, claim]));
  const commentsByTask = new Map<string, number>();
  for (const comment of bundle.comments) {
    commentsByTask.set(comment.taskId, (commentsByTask.get(comment.taskId) ?? 0) + 1);
  }

  const nodes = new Map<string, TaskNode>();
  for (const task of bundle.items) {
    nodes.set(task.id, {
      task,
      children: [],
      blockers: blockersByTask.get(task.id) ?? [],
      claim: claimsByTask.get(task.id) ?? null,
      commentCount: commentsByTask.get(task.id) ?? 0,
      hiddenCompletedCount: 0,
      available: false,
    });
  }

  const roots: TaskNode[] = [];
  for (const task of bundle.items) {
    const node = nodes.get(task.id)!;
    const parent = task.parentTaskId ? nodes.get(task.parentTaskId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byPosition = (a: TaskNode, b: TaskNode) => a.task.position - b.task.position;
  function finish(node: TaskNode): void {
    node.children.sort(byPosition);
    for (const child of node.children) finish(child);
    const hasIncompleteBlocker = node.blockers.some((blocker) => blocker.state !== "completed");
    const hasUnexpiredClaim = node.claim !== null && node.claim.leaseExpiresAt > Date.now();
    node.available = node.task.state === "pending"
      && node.children.length === 0
      && !hasIncompleteBlocker
      && !hasUnexpiredClaim;
  }

  roots.sort(byPosition);
  for (const root of roots) finish(root);
  return roots;
}

export function compactTaskTree(
  nodes: TaskNode[],
  expanded: Set<string>,
  maxVisibleDepth = 2,
): TaskNode[] {
  function compact(node: TaskNode, depth: number): TaskNode {
    const completedChildren = node.task.state === "completed"
      ? []
      : node.children.filter((child) => child.task.state === "completed");
    const activeChildren = node.task.state === "completed"
      ? node.children
      : node.children.filter((child) => child.task.state !== "completed");
    const showChildren = depth < maxVisibleDepth || expanded.has(node.task.id);
    return {
      ...node,
      children: showChildren ? activeChildren.map((child) => compact(child, depth + 1)) : [],
      hiddenCompletedCount: completedChildren.length,
    };
  }

  return nodes.map((node) => compact(node, 1));
}

export function completedGroups(nodes: TaskNode[]): { active: TaskNode[]; completed: TaskNode[] } {
  return {
    active: nodes.filter((node) => node.task.state !== "completed"),
    completed: nodes.filter((node) => node.task.state === "completed"),
  };
}
