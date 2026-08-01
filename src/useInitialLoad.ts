import { useEffect } from "react";
import type { ClientHost } from "@tabterm/module-host/client";

// One-time (per mount) fetch of the module's persisted notes/folders/active-note
// pointers, seeding host.store so existing notes render on app open. After this,
// live edits arrive via module:patch as usual. Idempotent: patches by id, so a
// re-fetch (e.g. remount) just re-affirms the same records.
export function useInitialLoad(host: ClientHost): void {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/modules/notes/r/list");
        if (!res.ok || cancelled) return;
        const { notes, folders, active, tasks } = await res.json();
        for (const n of notes ?? []) host.store.patch({ entity: "note", op: "set", data: n });
        for (const f of folders ?? []) host.store.patch({ entity: "noteFolder", op: "set", data: f });
        for (const a of active ?? []) host.store.patch({ entity: "activeNote", op: "set", data: { id: a.scopeId, noteId: a.noteId } });
        for (const bundle of tasks ?? []) {
          if (bundle.list) host.store.patch({ entity: "taskList", op: "set", data: bundle.list });
          for (const item of bundle.items ?? []) host.store.patch({ entity: "taskItem", op: "set", data: item });
          for (const dependency of bundle.dependencies ?? []) {
            host.store.patch({
              entity: "taskDependency",
              op: "set",
              data: { ...dependency, id: `${dependency.taskId}:${dependency.blockerTaskId}` },
            });
          }
          for (const claim of bundle.claims ?? []) {
            host.store.patch({ entity: "taskClaim", op: "set", data: { ...claim, id: claim.taskId } });
          }
          for (const comment of bundle.comments ?? []) {
            host.store.patch({ entity: "taskComment", op: "set", data: comment });
          }
        }
      } catch { /* offline / transient — live edits still arrive via module:patch */ }
    })();
    return () => { cancelled = true; };
  }, [host]);
}
