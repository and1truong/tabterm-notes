import type { ServerHost } from "@tabterm/module-host/server";
import { migrations } from "./server/migrations.ts";
import { makeNotesDb } from "./server/db.ts";
import { makeNotesService } from "./server/service.ts";
import { makeTasksDb } from "./server/tasksDb.ts";
import { makeTasksService } from "./server/tasksService.ts";
import { registerUploadRoute } from "./server/upload.ts";

export default function activate(host: ServerHost) {
  host.migrate(migrations);
  const ndb = makeNotesDb(host.db);
  const notesService = makeNotesService(ndb, host.sync);
  const tdb = makeTasksDb(host.db, host.now);
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
