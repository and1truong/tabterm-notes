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
  {
    v: 2,
    up: (db) => {
      db.exec(`CREATE TABLE task_lists (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`);
      db.exec(`CREATE TABLE task_items (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
        parent_task_id TEXT REFERENCES task_items(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        details_markdown TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','in_progress','completed')),
        completed_at INTEGER,
        completed_by_type TEXT CHECK(completed_by_type IS NULL OR completed_by_type IN ('user','agent')),
        completed_by_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`);
      db.exec(`CREATE TABLE task_dependencies (
        task_id TEXT NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
        blocker_task_id TEXT NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (task_id, blocker_task_id),
        CHECK(task_id != blocker_task_id)
      )`);
      db.exec(`CREATE TABLE task_claims (
        task_id TEXT PRIMARY KEY REFERENCES task_items(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        agent_label TEXT NOT NULL,
        lease_token_hash TEXT NOT NULL,
        claimed_at INTEGER NOT NULL DEFAULT (unixepoch()),
        lease_expires_at INTEGER NOT NULL,
        last_seen_comment_id TEXT REFERENCES task_comments(id) ON DELETE SET NULL
      )`);
      db.exec(`CREATE TABLE task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL CHECK(author_type IN ('user','agent')),
        author_id TEXT NOT NULL,
        author_label TEXT NOT NULL,
        body_markdown TEXT NOT NULL CHECK(length(trim(body_markdown)) > 0),
        kind TEXT NOT NULL DEFAULT 'comment' CHECK(kind IN ('comment','completion_summary')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER
      )`);
      db.exec(`CREATE INDEX idx_task_items_list_parent_position ON task_items(list_id, parent_task_id, position)`);
      db.exec(`CREATE INDEX idx_task_dependencies_blocker ON task_dependencies(blocker_task_id)`);
      db.exec(`CREATE INDEX idx_task_comments_task_created ON task_comments(task_id, created_at)`);
      db.exec(`CREATE INDEX idx_task_claims_lease_expires ON task_claims(lease_expires_at)`);
    },
  },
];
