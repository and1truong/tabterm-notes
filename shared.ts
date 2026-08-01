// Notes domain + wire types. Source of truth once core's copies are removed.

export type NoteType = "markdown" | "excalidraw";
export type NoteWidthPreset = "default" | "wider" | "full";

export interface Note {
  id: string;
  sessionId: string | null;       // null = workspace note; string = session-private
  primaryTabId: string;
  type: NoteType;
  title: string;
  content: string;
  titleAutoDerived: boolean;
  position: number;
  folderId: string | null;        // null = "Unsorted"; only meaningful for workspace notes
  pinned: boolean;
  widthPreset: NoteWidthPreset;
  createdAt: number;
  updatedAt: number;
  version: number;                // OCC counter; bumped on content/title write
}

export interface NoteFolder {
  id: string;
  primaryTabId: string;
  label: string;
  position: number;
  createdAt: number;
}

// Client -> server (note:* / noteFolder:* members, exact from ClientMessage):
export type NoteClientMessage =
  | { type: "note:create"; sessionId?: string; primaryTabId?: string; id?: string; noteType?: NoteType }
  | { type: "note:update"; noteId: string; content?: string; title?: string; widthPreset?: NoteWidthPreset; baseVersion?: number }
  | { type: "note:delete"; noteId: string }
  | { type: "note:setActive"; scopeId: string; noteId: string }
  | { type: "note:setPinned"; noteId: string; pinned: boolean }
  | { type: "note:promote"; noteId: string; targetPrimaryTabId: string }
  | { type: "note:move"; noteId: string; folderId: string | null }
  | { type: "noteFolder:create"; id: string; primaryTabId: string; label: string }
  | { type: "noteFolder:update"; folderId: string; label?: string; position?: number }
  | { type: "noteFolder:delete"; folderId: string };

// Server -> sender (unicast).
export type NoteServerMessage = { type: "note:conflict"; note: Note };

export type TaskState = "pending" | "in_progress" | "completed";
export type TaskActorType = "user" | "agent";
export type TaskCommentKind = "comment" | "completion_summary";

export interface TaskList {
  id: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}
export interface TaskItem {
  id: string;
  listId: string;
  parentTaskId: string | null;
  title: string;
  detailsMarkdown: string;
  position: number;
  state: TaskState;
  completedAt: number | null;
  completedByType: TaskActorType | null;
  completedById: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface TaskDependency { taskId: string; blockerTaskId: string; createdAt: number }
export interface TaskClaim {
  taskId: string;
  agentId: string;
  agentLabel: string;
  claimedAt: number;
  leaseExpiresAt: number;
  lastSeenCommentId: string | null;
}
export interface TaskComment {
  id: string;
  taskId: string;
  authorType: TaskActorType;
  authorId: string;
  authorLabel: string;
  bodyMarkdown: string;
  kind: TaskCommentKind;
  createdAt: number;
  updatedAt: number | null;
}
export interface TaskBundle {
  list: TaskList | null;
  items: TaskItem[];
  dependencies: TaskDependency[];
  claims: TaskClaim[];
  comments: TaskComment[];
}
export interface TaskChangeSet {
  bundle: TaskBundle;
  deleted: Array<{ entity: "taskItem" | "taskDependency" | "taskClaim" | "taskComment"; id: string }>;
}
export type TaskErrorCode =
  | "not_found" | "claimed" | "not_available" | "lease_expired"
  | "lease_mismatch" | "unseen_comments" | "hierarchy_cycle"
  | "dependency_cycle" | "cross_list" | "invalid_input";
export type TaskMutationResult<T = TaskChangeSet> =
  | { ok: true; value: T }
  | { ok: false; code: TaskErrorCode; message: string; value?: TaskBundle };

export type TaskCommand =
  | { type: "task:create"; sessionId: string; id: string; title: string; parentTaskId?: string }
  | { type: "task:update"; taskId: string; title?: string; detailsMarkdown?: string }
  | { type: "task:move"; taskId: string; parentTaskId: string | null; position: number }
  | { type: "task:dependency:set"; taskId: string; blockerTaskIds: string[] }
  | { type: "task:complete"; taskId: string }
  | { type: "task:reopen"; taskId: string }
  | { type: "task:delete"; taskId: string; keepChildren: boolean }
  | { type: "task:forceRelease"; taskId: string }
  | { type: "task:comment"; taskId: string; id: string; bodyMarkdown: string }
  | { type: "task:comment:update"; commentId: string; bodyMarkdown: string }
  | { type: "task:comment:delete"; commentId: string };
