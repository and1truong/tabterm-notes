import type { ServerHost } from "@tabterm/module-host/server";
import { migrations } from "./server/migrations.ts";
import { makeNotesDb } from "./server/db.ts";
import { makeNotesService } from "./server/service.ts";
import { makeTasksDb } from "./server/tasksDb.ts";
import { registerTaskMcpTools } from "./server/tasksMcp.ts";
import { makeTasksService } from "./server/tasksService.ts";
import { registerUploadRoute } from "./server/upload.ts";
import { hasCoreNotesCapability } from "./capability.ts";

export function activateLegacy(host: ServerHost) {
  host.migrate(migrations);
  const ndb = makeNotesDb(host.db);
  const notesService = makeNotesService(ndb, host.sync);
  const tdb = makeTasksDb(host.db, host.now);
  registerTaskMcpTools(host, tdb);
  const tasksService = makeTasksService(tdb, host.sync);
  const offNotes = host.onMessage(["note", "noteFolder"], (msg) => notesService.handle(msg));
  const offTasks = host.onMessage(["task"], (msg) => tasksService.handle(msg));
  registerUploadRoute(host);
  host.registerRoute("GET", "/list", () => {
    const { notes, folders, active } = ndb.listAll();
    const sessionIds = host.db.query<{ id: string }, []>("SELECT id FROM sessions").all()
      .map((row) => row.id);
    const tasks = sessionIds.map((id) => tdb.getBundle(id)).filter((bundle) => bundle.list !== null);
    return Response.json({ notes, folders, active, tasks });
  });
  return () => {
    offTasks();
    offNotes();
  };
}

export default function activate(host: ServerHost) {
  if (!hasCoreNotesCapability(host)) return activateLegacy(host);

  let defaultDebounce = 700;
  const row = host.db.query<{ value: string }, []>(
    "SELECT value FROM module_kv WHERE module_id = 'notes' AND key = 'excalidrawDebounceMs'",
  ).get();
  if (row) {
    try {
      const value = JSON.parse(row.value);
      if (typeof value === "number" && Number.isFinite(value)) defaultDebounce = value;
    } catch {}
  }
  host.settings.define({
    type: "object",
    properties: {
      excalidrawDebounceMs: {
        type: "integer",
        minimum: 100,
        maximum: 5000,
        default: defaultDebounce,
      },
    },
  }, { excalidrawDebounceMs: defaultDebounce });
}
