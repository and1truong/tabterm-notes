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
