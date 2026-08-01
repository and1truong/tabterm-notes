import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ClientHost } from "@tabterm/module-host/client";
import {
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Plus,
} from "lucide-react";
import {
  addTaskComment,
  completeTask,
  createTask,
  deleteTask,
  forceReleaseTask,
  moveTask,
  reopenTask,
  updateTask,
} from "../taskActions.ts";
import { useTaskBundle } from "../taskStore.ts";
import { TaskDetails } from "./TaskDetails.tsx";
import { TaskRow } from "./TaskRow.tsx";
import {
  buildTaskTree,
  compactTaskTree,
  completedGroups,
  type TaskNode,
} from "./taskTree.ts";

const TASK_FOOTER_HEIGHT_KEY = "taskFooterHeight";
const TASK_FOOTER_COLLAPSED_KEY = "taskFooterCollapsed";
const TASK_FOOTER_DEFAULT_RATIO = 0.4;

export function clampTaskFooterHeight(panelHeight: number, requested: number): number {
  return Math.max(176, Math.min(Math.round(panelHeight * 0.65), requested));
}

export function defaultTaskFooterHeight(panelHeight: number): number {
  return clampTaskFooterHeight(panelHeight, Math.round(panelHeight * TASK_FOOTER_DEFAULT_RATIO));
}

export function resetTaskFooterHeight(panelHeight: number): number {
  return defaultTaskFooterHeight(panelHeight);
}

function storedHeight(host: ClientHost): number | null {
  const value = host.kv.get(TASK_FOOTER_HEIGHT_KEY);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function TaskFooter({
  host,
  sessionId,
  onOpenModal,
}: {
  host: ClientHost;
  sessionId: string;
  onOpenModal: () => void;
}) {
  const bundle = useTaskBundle(host, sessionId);
  const footerRef = useRef<HTMLDivElement>(null);
  const stubRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<string | null>(null);
  const resizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const heightRef = useRef<number | null>(storedHeight(host));
  const [panelHeight, setPanelHeight] = useState(0);
  const [height, setHeight] = useState<number | null>(heightRef.current);
  const [collapsed, setCollapsed] = useState(host.kv.get(TASK_FOOTER_COLLAPSED_KEY) === true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());
  const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(() => new Set());
  const [shownPartialCompleted, setShownPartialCompleted] = useState<Set<string>>(() => new Set());
  const [completedOpen, setCompletedOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  const [stub, setStub] = useState("");
  const [stubParentId, setStubParentId] = useState<string | null>(null);

  const tree = useMemo(() => buildTaskTree(bundle), [bundle]);
  const groups = useMemo(() => completedGroups(tree), [tree]);
  const compactActive = useMemo(
    () => compactTaskTree(groups.active, expandedNodes),
    [expandedNodes, groups.active],
  );
  const nodeById = useMemo(() => {
    const nodes = new Map<string, TaskNode>();
    const visit = (items: TaskNode[]) => {
      for (const item of items) {
        nodes.set(item.task.id, item);
        visit(item.children);
      }
    };
    visit(tree);
    return nodes;
  }, [tree]);
  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const completedCount = bundle.items.filter((item) => item.state === "completed").length;
  const totalCount = bundle.items.length;

  useLayoutEffect(() => {
    const panel = footerRef.current?.parentElement;
    if (!panel) return;

    const measure = () => {
      const nextPanelHeight = panel.getBoundingClientRect().height;
      if (nextPanelHeight <= 0) return;
      setPanelHeight(nextPanelHeight);
      setHeight((current) => {
        const next = current === null
          ? defaultTaskFooterHeight(nextPanelHeight)
          : clampTaskFooterHeight(nextPanelHeight, current);
        heightRef.current = next;
        return next;
      });
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => host.kv.subscribe(TASK_FOOTER_HEIGHT_KEY, (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const next = panelHeight > 0 ? clampTaskFooterHeight(panelHeight, value) : value;
    heightRef.current = next;
    setHeight(next);
  }), [host, panelHeight]);

  useEffect(() => host.kv.subscribe(TASK_FOOTER_COLLAPSED_KEY, (value) => {
    setCollapsed(value === true);
  }), [host]);

  useEffect(() => {
    if (selectedId && !nodeById.has(selectedId)) setSelectedId(null);
  }, [nodeById, selectedId]);

  useEffect(() => {
    if (stubParentId) stubRef.current?.focus();
  }, [stubParentId]);

  function setFooterHeight(next: number) {
    heightRef.current = next;
    setHeight(next);
  }

  function persistHeight(next: number) {
    setFooterHeight(next);
    host.kv.set(TASK_FOOTER_HEIGHT_KEY, next);
  }

  function commitStub() {
    const title = stub.trim();
    if (!title) {
      setStub("");
      setStubParentId(null);
      return;
    }
    createTask(host, sessionId, title, stubParentId ?? undefined);
    setStub("");
    setStubParentId(null);
  }

  function confirmDelete(node: TaskNode, keepChildren: boolean) {
    const action = keepChildren
      ? `Delete “${node.task.title}” and keep its direct subtasks?`
      : `Delete “${node.task.title}”${node.children.length > 0 ? " and its entire subtree" : ""}?`;
    if (window.confirm(action)) deleteTask(host, node.task.id, keepChildren);
  }

  function beginSubtask(node: TaskNode) {
    setStubParentId(node.task.id);
    setStub("");
  }

  function toggleNode(node: TaskNode, depth: number) {
    if (depth === 0) {
      setCollapsedRoots((current) => {
        const next = new Set(current);
        if (next.has(node.task.id)) next.delete(node.task.id);
        else next.add(node.task.id);
        return next;
      });
      return;
    }
    setExpandedNodes((current) => {
      const next = new Set(current);
      if (next.has(node.task.id)) next.delete(node.task.id);
      else next.add(node.task.id);
      return next;
    });
  }

  function dropBefore(targetId: string) {
    const draggedId = dragRef.current;
    dragRef.current = null;
    if (!draggedId || draggedId === targetId) return;
    const target = nodeById.get(targetId);
    if (!target) return;
    moveTask(host, draggedId, target.task.parentTaskId, target.task.position);
  }

  function renderNodes(nodes: TaskNode[], depth: number, completedBranch = false): ReactNode {
    return nodes.map((node) => {
      const fullNode = nodeById.get(node.task.id) ?? node;
      const activeChildren = fullNode.children.filter((child) => child.task.state !== "completed");
      const completedChildren = fullNode.children.filter((child) => child.task.state === "completed");
      const hasChildren = completedBranch ? fullNode.children.length > 0 : activeChildren.length > 0;
      const expanded = completedBranch
        ? true
        : depth === 0
          ? !collapsedRoots.has(node.task.id)
          : expandedNodes.has(node.task.id);
      const partialOpen = shownPartialCompleted.has(node.task.id);

      return (
        <div key={node.task.id}>
          <TaskRow
            node={fullNode}
            depth={depth}
            hasChildren={hasChildren}
            expanded={expanded}
            selected={selectedId === node.task.id}
            onToggle={() => toggleNode(node, depth)}
            onSelect={() => { setSelectedId(node.task.id); setFocusCommentId(null); }}
            onComplete={() => completeTask(host, node.task.id)}
            onReopen={() => reopenTask(host, node.task.id)}
            onAddSubtask={() => beginSubtask(fullNode)}
            onDelete={(keepChildren) => confirmDelete(fullNode, keepChildren)}
            onForceRelease={() => forceReleaseTask(host, node.task.id)}
            onComment={() => { setSelectedId(node.task.id); setFocusCommentId(node.task.id); }}
            onDragStart={(taskId) => { dragRef.current = taskId; }}
            onDrop={dropBefore}
          />

          {selectedNode?.task.id === node.task.id && (
            <TaskDetails
              node={fullNode}
              comments={bundle.comments}
              onUpdate={(changes) => updateTask(host, node.task.id, changes)}
              onComplete={() => completeTask(host, node.task.id)}
              onReopen={() => reopenTask(host, node.task.id)}
              onAddSubtask={() => beginSubtask(fullNode)}
              onDelete={(keepChildren) => confirmDelete(fullNode, keepChildren)}
              onForceRelease={() => forceReleaseTask(host, node.task.id)}
              onAddComment={(bodyMarkdown) => addTaskComment(host, node.task.id, bodyMarkdown)}
              focusComment={focusCommentId === node.task.id}
            />
          )}

          {expanded && renderNodes(completedBranch ? fullNode.children : node.children, depth + 1, completedBranch)}

          {!completedBranch && completedChildren.length > 0 && (expanded || !hasChildren) && (
            <>
              <button
                type="button"
                onClick={() => setShownPartialCompleted((current) => {
                  const next = new Set(current);
                  if (next.has(node.task.id)) next.delete(node.task.id);
                  else next.add(node.task.id);
                  return next;
                })}
                className="ml-8 flex h-7 items-center gap-1 rounded px-2 text-[10px] text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                {partialOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                {completedChildren.length} completed
              </button>
              {partialOpen && renderNodes(completedChildren, depth + 1, true)}
            </>
          )}
        </div>
      );
    });
  }

  return (
    <div
      ref={footerRef}
      className="relative flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--bg)]"
      style={collapsed ? undefined : { height: height === null ? "40%" : `${height}px` }}
    >
      <div
        role="separator"
        aria-label="Resize task footer"
        aria-orientation="horizontal"
        onDoubleClick={() => {
          const measuredPanelHeight = panelHeight || footerRef.current?.parentElement?.getBoundingClientRect().height || 0;
          if (measuredPanelHeight > 0) persistHeight(resetTaskFooterHeight(measuredPanelHeight));
        }}
        onPointerDown={(event) => {
          if (collapsed) return;
          const measuredPanelHeight = panelHeight || footerRef.current?.parentElement?.getBoundingClientRect().height || 0;
          if (measuredPanelHeight <= 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: footerRef.current?.getBoundingClientRect().height ?? defaultTaskFooterHeight(measuredPanelHeight),
          };
        }}
        onPointerMove={(event) => {
          const resize = resizeRef.current;
          if (!resize || resize.pointerId !== event.pointerId || panelHeight <= 0) return;
          event.preventDefault();
          setFooterHeight(clampTaskFooterHeight(panelHeight, resize.startHeight + resize.startY - event.clientY));
        }}
        onPointerUp={(event) => {
          if (resizeRef.current?.pointerId !== event.pointerId) return;
          resizeRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          if (heightRef.current !== null) host.kv.set(TASK_FOOTER_HEIGHT_KEY, heightRef.current);
        }}
        onPointerCancel={(event) => {
          if (resizeRef.current?.pointerId !== event.pointerId) return;
          resizeRef.current = null;
          if (heightRef.current !== null) host.kv.set(TASK_FOOTER_HEIGHT_KEY, heightRef.current);
        }}
        className="task-footer-resize absolute inset-x-0 -top-1 z-10 h-2 touch-none cursor-row-resize"
      />

      <div className="flex h-9 shrink-0 items-center gap-2 px-2.5">
        <button
          type="button"
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            host.kv.set(TASK_FOOTER_COLLAPSED_KEY, next);
          }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand tasks" : "Collapse tasks"}
          className="grid h-7 w-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <CheckSquare2 size={14} className="text-[var(--accent-soft)]" />
        <span className="text-xs font-semibold tracking-wide text-[var(--text)]">TASKS</span>
        <span className="text-[10px] tabular-nums text-[var(--faint)]">{completedCount}/{totalCount}</span>
        <div className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-[var(--border)]" aria-hidden="true">
          <div
            className="h-full rounded-full bg-[var(--accent-soft)] transition-[width] motion-reduce:transition-none"
            style={{ width: totalCount === 0 ? "0%" : `${(completedCount / totalCount) * 100}%` }}
          />
        </div>
        <button
          type="button"
          onClick={onOpenModal}
          className="grid h-7 w-7 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          title="Open tasks in modal"
          aria-label="Open tasks in modal"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-[var(--border)] px-1.5 py-1.5">
          {compactActive.length > 0 ? renderNodes(compactActive, 0) : (
            <p className="px-8 py-1 text-[11px] text-[var(--faint)]">No active tasks.</p>
          )}

          <div className="flex min-h-8 items-center gap-2 rounded-md px-2 text-xs text-[var(--muted)]">
            <span className="grid h-6 w-6 shrink-0 place-items-center text-[var(--faint)]"><Plus size={13} /></span>
            <input
              ref={stubRef}
              value={stub}
              onChange={(event) => setStub(event.target.value)}
              onBlur={commitStub}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitStub();
                else if (event.key === "Escape") {
                  setStub("");
                  setStubParentId(null);
                }
              }}
              placeholder={stubParentId ? `Add subtask to ${nodeById.get(stubParentId)?.task.title ?? "task"}…` : "Add a task…"}
              aria-label={stubParentId ? "New subtask title" : "New task title"}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            />
          </div>

          {groups.completed.length > 0 && (
            <div className="mt-1 border-t border-[var(--border)] pt-1">
              <button
                type="button"
                onClick={() => setCompletedOpen((open) => !open)}
                aria-expanded={completedOpen}
                className="flex h-7 items-center gap-1 rounded px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                {completedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Completed · {groups.completed.length}
              </button>
              {completedOpen && renderNodes(groups.completed, 0, true)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
