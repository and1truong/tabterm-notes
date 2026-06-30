import { useMemo } from "react";
import type { ClientHost } from "@tabterm/module-host/client";
import type { Note, NoteFolder } from "../shared.ts";

// Stable empty references — the module store initializes state to {} so these
// buckets are undefined until their first patch. Returning `?? {}` inline would
// allocate a fresh object every getSnapshot call, breaking useSyncExternalStore's
// Object.is snapshot check and causing an infinite render loop on initial mount.
const EMPTY_NOTES: Record<string, Note> = {};
const EMPTY_FOLDERS: Record<string, NoteFolder> = {};
const EMPTY_CONFLICT: Record<string, unknown> = {};

export function useNotesAll(host: ClientHost): Record<string, Note> {
  return host.store.use((s) => (s.note as Record<string, Note> | undefined) ?? EMPTY_NOTES);
}

export function useFoldersAll(host: ClientHost): Record<string, NoteFolder> {
  return host.store.use((s) => (s.noteFolder as Record<string, NoteFolder> | undefined) ?? EMPTY_FOLDERS);
}

// Active note id for a scope (sessionId or primaryTabId).
export function useActiveNoteId(host: ClientHost, scopeId: string | null): string | null {
  return host.store.use((s) => (scopeId ? (s.activeNote?.[scopeId]?.noteId ?? null) : null));
}

// Conflict bucket: a note id is "conflicted" if present. Value carries authoritative note.
// Select the raw bucket (stable ref until a patch hits the `conflict` entity) and
// memoize the Set — building `new Set(...)` inside the getSnapshot selector returns
// a fresh reference every call, failing useSyncExternalStore's Object.is check and
// causing an infinite render loop.
export function useConflictIds(host: ClientHost): Set<string> {
  const raw = host.store.use((s) => (s.conflict as Record<string, unknown> | undefined) ?? EMPTY_CONFLICT);
  return useMemo(() => new Set(Object.keys(raw)), [raw]);
}

export function getConflictNote(host: ClientHost, noteId: string): Note | null {
  return ((host.store.getState().conflict ?? {}) as any)[noteId]?.note ?? null;
}

export function clearConflict(host: ClientHost, noteId: string): void {
  host.store.patch({ entity: "conflict", op: "delete", id: noteId });
}
