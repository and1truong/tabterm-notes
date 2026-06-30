import type { Migration } from "@tabterm/module-host/server";

export const migrations: Migration[] = [
  {
    v: 1,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        primary_tab_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Untitled',
        content TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'markdown',
        title_auto_derived INTEGER NOT NULL DEFAULT 1,
        pinned INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL,
        folder_id TEXT,
        width_preset TEXT NOT NULL DEFAULT 'default',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        version INTEGER NOT NULL DEFAULT 1
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id, position)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_workspace ON notes(primary_tab_id, position)`);
      db.exec(`CREATE TABLE IF NOT EXISTS note_folders (
        id TEXT PRIMARY KEY,
        primary_tab_id TEXT NOT NULL,
        label TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`);
      // Active-note pointer relocated out of core sessions.active_note_id /
      // primary_tabs.active_note_id. scope_id = a session id OR a primary_tab id.
      db.exec(`CREATE TABLE IF NOT EXISTS active_note (
        scope_id TEXT PRIMARY KEY,
        note_id TEXT
      )`);
    },
  },
];
