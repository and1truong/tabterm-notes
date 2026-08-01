import type { ServerHost } from "@tabterm/module-host/server";
import { hasCoreNotesCapability } from "./capability.ts";

export default function activate(host: ServerHost) {
  if (!hasCoreNotesCapability(host)) return;

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
