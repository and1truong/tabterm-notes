import type { ServerHost } from "@tabterm/module-host/server";
import { migrations } from "./server/migrations.ts";
import { makeNotesDb } from "./server/db.ts";
import { makeNotesService } from "./server/service.ts";
import { registerUploadRoute } from "./server/upload.ts";

export default function activate(host: ServerHost) {
  host.migrate(migrations);
  const ndb = makeNotesDb(host.db);
  const service = makeNotesService(ndb, host.sync);
  const off = host.onMessage(["note", "noteFolder"], (msg) => service.handle(msg));
  registerUploadRoute(host);
  host.registerRoute("GET", "/list", () => {
    const { notes, folders, active } = ndb.listAll();
    return Response.json({ notes, folders, active });
  });
  return () => off();
}
