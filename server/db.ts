import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { Note, NoteFolder, NoteType, NoteWidthPreset } from "../shared.ts";

// ---- Row types ---------------------------------------------------------------

interface NoteRow {
  id: string;
  session_id: string | null;
  primary_tab_id: string;
  title: string;
  content: string;
  type: string;
  title_auto_derived: number;
  pinned: number;
  position: number;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
  version: number;
  width_preset: string;
}

interface NoteFolderRow {
  id: string;
  primary_tab_id: string;
  label: string;
  position: number;
  created_at: number;
}

// ---- Mappers -----------------------------------------------------------------

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  sessionId: r.session_id,
  primaryTabId: r.primary_tab_id,
  type: (r.type ?? "markdown") as NoteType,
  title: r.title,
  content: r.content,
  titleAutoDerived: r.title_auto_derived === 1,
  pinned: (r.pinned ?? 0) === 1,
  position: r.position,
  folderId: r.folder_id ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  version: r.version ?? 1,
  widthPreset: (r.width_preset ?? "default") as NoteWidthPreset,
});

const toNoteFolder = (r: NoteFolderRow): NoteFolder => ({
  id: r.id,
  primaryTabId: r.primary_tab_id,
  label: r.label,
  position: r.position,
  createdAt: r.created_at,
});

// ---- Title helpers -----------------------------------------------------------

function deriveTitle(content: string): string {
  const line = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  const stripped = (line ?? "").replace(/^#{1,6}\s+/, "");
  return stripped.slice(0, 60) || "Untitled";
}

function firstContentLineIndex(lines: string[]): number {
  const i = lines.findIndex((l) => l.trim().length > 0);
  return i === -1 ? 0 : i;
}

function currentH1(content: string): string | null {
  const line = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (line == null) return null;
  const m = line.match(/^#{1,6}\s+(.*)$/);
  return m ? m[1].trim() : null;
}

function setH1(content: string, label: string): string {
  const lines = content.split("\n");
  const idx = firstContentLineIndex(lines);
  const first = lines[idx]?.trim() ?? "";
  if (/^#{1,6}\s/.test(first)) {
    lines[idx] = `# ${label}`;
    return lines.join("\n");
  }
  return `# ${label}\n\n${content}`;
}

// ---- Factory -----------------------------------------------------------------

export function makeNotesDb(db: Database) {
  const q = {
    getNote: db.query<NoteRow, [string]>("SELECT * FROM notes WHERE id = ?"),
    insertNote: db.query(
      "INSERT INTO notes (id, session_id, primary_tab_id, title, content, title_auto_derived, type, position, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())",
    ),
    maxNotePos: db.query<{ p: number | null }, [string]>(
      "SELECT MAX(position) AS p FROM notes WHERE session_id = ?",
    ),
    maxWorkspaceNotePos: db.query<{ p: number | null }, [string]>(
      "SELECT MAX(position) AS p FROM notes WHERE primary_tab_id = ? AND session_id IS NULL",
    ),
    maxWorkspaceNotePosInFolder: db.query<{ p: number | null }, [string, string]>(
      "SELECT MAX(position) AS p FROM notes WHERE primary_tab_id = ? AND session_id IS NULL AND folder_id = ?",
    ),
    maxWorkspaceNotePosUnsorted: db.query<{ p: number | null }, [string]>(
      "SELECT MAX(position) AS p FROM notes WHERE primary_tab_id = ? AND session_id IS NULL AND folder_id IS NULL",
    ),
    setNoteFolderPos: db.query("UPDATE notes SET folder_id = ?, position = ? WHERE id = ?"),
    notesInFolder: db.query<NoteRow, [string]>("SELECT * FROM notes WHERE folder_id = ? ORDER BY position"),
    unsetNoteFolder: db.query("UPDATE notes SET folder_id = NULL WHERE folder_id = ?"),
    sessionMarkdownNotes: db.query<NoteRow, [string]>(
      "SELECT * FROM notes WHERE session_id = ? AND type = 'markdown'",
    ),
    updateNoteContent: db.query(
      "UPDATE notes SET content = ?, version = version + 1, updated_at = unixepoch() WHERE id = ?",
    ),
    updateNoteContentAndTitle: db.query(
      "UPDATE notes SET content = ?, title = ?, version = version + 1, updated_at = unixepoch() WHERE id = ?",
    ),
    updateNoteTitle: db.query(
      "UPDATE notes SET title = ?, title_auto_derived = 0, version = version + 1, updated_at = unixepoch() WHERE id = ?",
    ),
    setNotePinned: db.query(
      "UPDATE notes SET pinned = ?, version = version + 1, updated_at = unixepoch() WHERE id = ?",
    ),
    setNoteWidthPreset: db.query("UPDATE notes SET width_preset = ? WHERE id = ?"),
    deleteNote: db.query("DELETE FROM notes WHERE id = ?"),
    mostRecentNoteForSession: db.query<{ id: string }, [string, string]>(
      "SELECT id FROM notes WHERE session_id = ? AND id != ? ORDER BY updated_at DESC LIMIT 1",
    ),
    mostRecentNoteForWorkspace: db.query<{ id: string }, [string, string]>(
      "SELECT id FROM notes WHERE primary_tab_id = ? AND session_id IS NULL AND id != ? " +
        "ORDER BY updated_at DESC LIMIT 1",
    ),
    getNoteFolder: db.query<NoteFolderRow, [string]>("SELECT * FROM note_folders WHERE id = ?"),
    insertNoteFolder: db.query(
      "INSERT INTO note_folders (id, primary_tab_id, label, position) VALUES (?, ?, ?, ?)",
    ),
    updateNoteFolderLabel: db.query("UPDATE note_folders SET label = ? WHERE id = ?"),
    updateNoteFolderPos: db.query("UPDATE note_folders SET position = ? WHERE id = ?"),
    deleteNoteFolder: db.query("DELETE FROM note_folders WHERE id = ?"),
    maxNoteFolderPos: db.query<{ p: number | null }, [string]>(
      "SELECT MAX(position) AS p FROM note_folders WHERE primary_tab_id = ?",
    ),
    // ---- active_note table (REPLACES sessions/primary_tabs.active_note_id) ----
    getActiveNote: db.query<{ note_id: string | null }, [string]>(
      "SELECT note_id FROM active_note WHERE scope_id = ?",
    ),
    setActiveNoteRow: db.query(
      "INSERT INTO active_note (scope_id, note_id) VALUES (?, ?) " +
        "ON CONFLICT(scope_id) DO UPDATE SET note_id = excluded.note_id",
    ),
    // ---- existence checks against core tables (same host.db) ----
    sessionExists: db.query<{ id: string }, [string]>("SELECT id FROM sessions WHERE id = ?"),
    sessionLabel: db.query<{ label: string }, [string]>("SELECT label FROM sessions WHERE id = ?"),
    sessionPrimaryTab: db.query<{ primary_tab_id: string }, [string]>(
      "SELECT primary_tab_id FROM sessions WHERE id = ?",
    ),
    tabExists: db.query<{ id: string }, [string]>("SELECT id FROM primary_tabs WHERE id = ?"),
  };

  // ---- CRUD functions --------------------------------------------------------

  function createNote(
    sessionId: string,
    id: string = randomUUID(),
    type: NoteType = "markdown",
  ): { note: Note; activeScopeId: string } | null {
    if (!q.sessionExists.get(sessionId)) return null;
    const sessionLabelRow = q.sessionLabel.get(sessionId);
    const sessionPrimaryTabRow = q.sessionPrimaryTab.get(sessionId);
    if (!sessionLabelRow || !sessionPrimaryTabRow) return null;
    const position = (q.maxNotePos.get(sessionId)?.p ?? -1) + 1;
    const isDiagram = type === "excalidraw";
    const content = isDiagram ? "" : setH1("", sessionLabelRow.label);
    q.insertNote.run(
      id,
      sessionId,
      sessionPrimaryTabRow.primary_tab_id,
      isDiagram ? "Untitled diagram" : deriveTitle(content),
      content,
      isDiagram ? 0 : 1,
      type,
      position,
    );
    q.setActiveNoteRow.run(sessionId, id);
    return {
      note: toNote(q.getNote.get(id)!),
      activeScopeId: sessionId,
    };
  }

  function createWorkspaceNote(
    primaryTabId: string,
    id: string = randomUUID(),
    type: NoteType = "markdown",
  ): { note: Note; activeScopeId: string } | null {
    if (!q.tabExists.get(primaryTabId)) return null;
    const position = (q.maxWorkspaceNotePos.get(primaryTabId)?.p ?? -1) + 1;
    const isDiagram = type === "excalidraw";
    q.insertNote.run(
      id,
      null,
      primaryTabId,
      isDiagram ? "Untitled diagram" : "Untitled",
      "",
      isDiagram ? 0 : 1,
      type,
      position,
    );
    q.setActiveNoteRow.run(primaryTabId, id);
    return {
      note: toNote(q.getNote.get(id)!),
      activeScopeId: primaryTabId,
    };
  }

  function resyncSessionNoteHeadings(
    sessionId: string,
    oldLabel: string,
    newLabel: string,
  ): Note[] {
    if (oldLabel === newLabel) return [];
    const out: Note[] = [];
    for (const row of q.sessionMarkdownNotes.all(sessionId)) {
      if (currentH1(row.content) !== oldLabel) continue;
      const content = setH1(row.content, newLabel);
      q.updateNoteContentAndTitle.run(content, deriveTitle(content), row.id);
      out.push(toNote(q.getNote.get(row.id)!));
    }
    return out;
  }

  function updateNoteContent(
    noteId: string,
    content: string,
    baseVersion?: number,
  ): { note: Note; applied: boolean } | null {
    const existing = q.getNote.get(noteId);
    if (!existing) return null;
    if (baseVersion != null && (existing.version ?? 1) !== baseVersion) {
      return { note: toNote(existing), applied: false };
    }
    if (existing.title_auto_derived === 1) {
      q.updateNoteContentAndTitle.run(content, deriveTitle(content), noteId);
    } else {
      q.updateNoteContent.run(content, noteId);
    }
    return { note: toNote(q.getNote.get(noteId)!), applied: true };
  }

  function updateNoteTitle(noteId: string, title: string): Note | null {
    const existing = q.getNote.get(noteId);
    if (!existing) return null;
    q.updateNoteTitle.run(title.trim() || "Untitled", noteId);
    return toNote(q.getNote.get(noteId)!);
  }

  function deleteNote(
    noteId: string,
  ): { deletedId: string; activeChange?: { scopeId: string; noteId: string | null } } | null {
    const existing = q.getNote.get(noteId);
    if (!existing) return null;
    const sessionId = existing.session_id;
    const primaryTabId = existing.primary_tab_id;
    q.deleteNote.run(noteId);
    let activeChange: { scopeId: string; noteId: string | null } | undefined;
    if (sessionId) {
      const currentActive = q.getActiveNote.get(sessionId)?.note_id ?? null;
      if (currentActive === noteId) {
        const next = q.mostRecentNoteForSession.get(sessionId, noteId)?.id ?? null;
        q.setActiveNoteRow.run(sessionId, next);
        activeChange = { scopeId: sessionId, noteId: next };
      }
    } else {
      const currentActive = q.getActiveNote.get(primaryTabId)?.note_id ?? null;
      if (currentActive === noteId) {
        const next = q.mostRecentNoteForWorkspace.get(primaryTabId, noteId)?.id ?? null;
        q.setActiveNoteRow.run(primaryTabId, next);
        activeChange = { scopeId: primaryTabId, noteId: next };
      }
    }
    return { deletedId: noteId, ...(activeChange !== undefined ? { activeChange } : {}) };
  }

  // scopeId is a session id (session-private note) or a primary_tab id (workspace
  // note). Active-note is module-owned (active_note table), so this is the single
  // setter for both scopes — no core sessions/primary_tabs writes.
  function setActiveNote(
    scopeId: string,
    noteId: string,
  ): { scopeId: string; noteId: string } | null {
    if (!q.sessionExists.get(scopeId) && !q.tabExists.get(scopeId)) return null;
    if (!q.getNote.get(noteId)) return null;
    q.setActiveNoteRow.run(scopeId, noteId);
    return { scopeId, noteId };
  }

  function setNotePinned(noteId: string, pinned: boolean): Note | null {
    if (!q.getNote.get(noteId)) return null;
    q.setNotePinned.run(pinned ? 1 : 0, noteId);
    return toNote(q.getNote.get(noteId)!);
  }

  function updateNoteWidthPreset(noteId: string, preset: NoteWidthPreset): Note | null {
    if (!q.getNote.get(noteId)) return null;
    q.setNoteWidthPreset.run(preset, noteId);
    return toNote(q.getNote.get(noteId)!);
  }

  function promoteNote(
    noteId: string,
    targetPrimaryTabId: string,
  ): { note: Note; activeChange?: { scopeId: string; noteId: string | null }; targetScopeId: string } | null {
    const existing = q.getNote.get(noteId);
    if (!existing) return null;
    if (!q.tabExists.get(targetPrimaryTabId)) return null;

    const wasSessionId = existing.session_id;
    const wasPrimaryTabId = existing.primary_tab_id;
    if (wasSessionId === null && wasPrimaryTabId === targetPrimaryTabId) {
      return { note: toNote(existing), targetScopeId: targetPrimaryTabId };
    }

    const position = (q.maxWorkspaceNotePos.get(targetPrimaryTabId)?.p ?? -1) + 1;
    let activeChange: { scopeId: string; noteId: string | null } | undefined;

    db.transaction(() => {
      db.query(
        "UPDATE notes SET session_id = NULL, primary_tab_id = ?, position = ?, " +
          "version = version + 1, updated_at = unixepoch() WHERE id = ?",
      ).run(targetPrimaryTabId, position, noteId);
      q.setActiveNoteRow.run(targetPrimaryTabId, noteId);
      if (wasSessionId) {
        const currentActive = q.getActiveNote.get(wasSessionId)?.note_id ?? null;
        if (currentActive === noteId) {
          q.setActiveNoteRow.run(wasSessionId, null);
          activeChange = { scopeId: wasSessionId, noteId: null };
        }
      }
    })();

    return {
      note: toNote(q.getNote.get(noteId)!),
      ...(activeChange !== undefined ? { activeChange } : {}),
      targetScopeId: targetPrimaryTabId,
    };
  }

  function createNoteFolder(
    primaryTabId: string,
    label: string,
    id: string = randomUUID(),
  ): NoteFolder {
    const position = (q.maxNoteFolderPos.get(primaryTabId)?.p ?? -1) + 1;
    q.insertNoteFolder.run(id, primaryTabId, label, position);
    return toNoteFolder(q.getNoteFolder.get(id)!);
  }

  function updateNoteFolder(
    folderId: string,
    patch: { label?: string; position?: number },
  ): NoteFolder | null {
    if (!q.getNoteFolder.get(folderId)) return null;
    if (patch.label !== undefined) q.updateNoteFolderLabel.run(patch.label, folderId);
    if (patch.position !== undefined) q.updateNoteFolderPos.run(patch.position, folderId);
    return toNoteFolder(q.getNoteFolder.get(folderId)!);
  }

  function deleteNoteFolder(
    folderId: string,
  ): { deletedId: string; reparented: Note[] } | null {
    if (!q.getNoteFolder.get(folderId)) return null;
    const childIds = q.notesInFolder.all(folderId).map((r) => r.id);
    db.transaction(() => {
      q.unsetNoteFolder.run(folderId);
      q.deleteNoteFolder.run(folderId);
    })();
    const reparented = childIds
      .map((id) => q.getNote.get(id))
      .filter((r): r is NoteRow => r !== null)
      .map(toNote);
    return { deletedId: folderId, reparented };
  }

  function moveNote(noteId: string, folderId: string | null = null): Note | null {
    const existing = q.getNote.get(noteId);
    if (!existing) return null;
    if (existing.session_id !== null) return null;
    if (folderId !== null) {
      const f = q.getNoteFolder.get(folderId);
      if (!f || f.primary_tab_id !== existing.primary_tab_id) return null;
    }
    const position =
      folderId === null
        ? (q.maxWorkspaceNotePosUnsorted.get(existing.primary_tab_id)?.p ?? -1) + 1
        : (q.maxWorkspaceNotePosInFolder.get(existing.primary_tab_id, folderId)?.p ?? -1) + 1;
    q.setNoteFolderPos.run(folderId, position, noteId);
    return toNote(q.getNote.get(noteId)!);
  }

  function listAll(): { notes: Note[]; folders: NoteFolder[]; active: { scopeId: string; noteId: string | null }[] } {
    const notes = db.query<NoteRow, []>("SELECT * FROM notes ORDER BY session_id, position").all().map(toNote);
    const folders = db.query<NoteFolderRow, []>("SELECT * FROM note_folders ORDER BY primary_tab_id, position").all().map(toNoteFolder);
    const active = db.query<{ scope_id: string; note_id: string | null }, []>("SELECT scope_id, note_id FROM active_note").all()
      .map((r) => ({ scopeId: r.scope_id, noteId: r.note_id }));
    return { notes, folders, active };
  }

  return {
    createNote,
    createWorkspaceNote,
    resyncSessionNoteHeadings,
    updateNoteContent,
    updateNoteTitle,
    updateNoteWidthPreset,
    deleteNote,
    setActiveNote,
    setNotePinned,
    promoteNote,
    moveNote,
    createNoteFolder,
    updateNoteFolder,
    deleteNoteFolder,
    listAll,
  };
}
