import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "./migrations.ts";

function freshDb() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT NOT NULL, primary_tab_id TEXT NOT NULL)");
  db.exec("INSERT INTO sessions VALUES ('sess1', 'Session', 'tab1')");
  for (const m of migrations) m.up(db);
  return db;
}

test("task migration creates all task tables and cascades from session", () => {
  const db = freshDb();
  const names = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'task_%'",
  ).all().map((r) => r.name).sort();
  expect(names).toEqual(["task_claims", "task_comments", "task_dependencies", "task_items", "task_lists"]);
  db.run("INSERT INTO task_lists (id, session_id) VALUES ('l1', 'sess1')");
  db.run("INSERT INTO task_items (id, list_id, title, position) VALUES ('t1', 'l1', 'Work', 0)");
  db.run("DELETE FROM sessions WHERE id = 'sess1'");
  expect(db.query("SELECT id FROM task_lists").all()).toEqual([]);
  expect(db.query("SELECT id FROM task_items").all()).toEqual([]);
});
