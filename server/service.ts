import type { Effect } from "@tabterm/module-host/server";
import type { NoteClientMessage } from "../shared.ts";
import type { makeNotesDb } from "./db.ts";

type Sync = {
  set(entity: string, data: unknown): Effect;
  del(entity: string, id: string): Effect;
  toSender(msg: unknown): Effect;
};

export function makeNotesService(ndb: ReturnType<typeof makeNotesDb>, sync: Sync) {
  function handle(msg: NoteClientMessage): Effect[] {
    switch (msg.type) {
      case "note:create": {
        if (msg.primaryTabId) {
          const r = ndb.createWorkspaceNote(msg.primaryTabId, msg.id, msg.noteType);
          return r ? [sync.set("note", r.note), sync.set("activeNote", { id: r.activeScopeId, noteId: r.note.id })] : [];
        }
        if (msg.sessionId) {
          const r = ndb.createNote(msg.sessionId, msg.id, msg.noteType);
          return r ? [sync.set("note", r.note), sync.set("activeNote", { id: r.activeScopeId, noteId: r.note.id })] : [];
        }
        return [];
      }
      case "note:update": {
        const out: Effect[] = [];
        if (msg.content !== undefined) {
          const r = ndb.updateNoteContent(msg.noteId, msg.content, msg.baseVersion);
          if (r?.applied) out.push(sync.set("note", r.note));
          else if (r) out.push(sync.toSender({ type: "module:patch", moduleId: "notes", entity: "conflict", op: "set", data: { id: r.note.id, note: r.note } }));
        }
        if (msg.title !== undefined) {
          const n = ndb.updateNoteTitle(msg.noteId, msg.title);
          if (n) out.push(sync.set("note", n));
        }
        if (msg.widthPreset !== undefined) {
          const n = ndb.updateNoteWidthPreset(msg.noteId, msg.widthPreset);
          if (n) out.push(sync.set("note", n));
        }
        return out;
      }
      case "note:delete": {
        const r = ndb.deleteNote(msg.noteId);
        if (!r) return [];
        const out: Effect[] = [sync.del("note", r.deletedId)];
        if (r.activeChange) out.push(sync.set("activeNote", { id: r.activeChange.scopeId, noteId: r.activeChange.noteId }));
        return out;
      }
      case "note:setActive": {
        const r = ndb.setActiveNote(msg.scopeId, msg.noteId);
        return r ? [sync.set("activeNote", { id: r.scopeId, noteId: r.noteId })] : [];
      }
      case "note:setPinned": {
        const n = ndb.setNotePinned(msg.noteId, msg.pinned);
        return n ? [sync.set("note", n)] : [];
      }
      case "note:promote": {
        const r = ndb.promoteNote(msg.noteId, msg.targetPrimaryTabId);
        if (!r) return [];
        const out: Effect[] = [sync.set("note", r.note), sync.set("activeNote", { id: r.targetScopeId, noteId: r.note.id })];
        if (r.activeChange) out.push(sync.set("activeNote", { id: r.activeChange.scopeId, noteId: r.activeChange.noteId }));
        return out;
      }
      case "note:move": {
        const n = ndb.moveNote(msg.noteId, msg.folderId);
        return n ? [sync.set("note", n)] : [];
      }
      case "noteFolder:create":
        return [sync.set("noteFolder", ndb.createNoteFolder(msg.primaryTabId, msg.label, msg.id))];
      case "noteFolder:update": {
        const f = ndb.updateNoteFolder(msg.folderId, { label: msg.label, position: msg.position });
        return f ? [sync.set("noteFolder", f)] : [];
      }
      case "noteFolder:delete": {
        const r = ndb.deleteNoteFolder(msg.folderId);
        if (!r) return [];
        return [...r.reparented.map((n) => sync.set("note", n)), sync.del("noteFolder", r.deletedId)];
      }
      default:
        return [];
    }
  }
  return { handle };
}
