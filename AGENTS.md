# tabterm-notes

The **notes** module for [tabterm](https://github.com/and1truong/tabterm), extracted
into its own repository — markdown notes + Excalidraw whiteboards, session- or
workspace-scoped. A tabterm *module*, not a standalone app: it has no server/SPA of its
own; it activates inside a tabterm host through the `@tabterm/module-host` contract.

## Toolchain

- **Runtime + package manager: [Bun](https://bun.sh)** (required ≥1.3.5, see `package.json` engines).
  Use `bun` for everything. Do **not** use `npm`, `yarn`, or `pnpm`. Lockfile is `bun.lock`.
- **Typecheck:** `bun run typecheck` (`tsc --noEmit`) — or `make typecheck`.
- **Test:** `bun test` (server DB/service/upload + markdown round-trip) — or `make test`.
- **Full local gate:** `make check` (typecheck + test).
- `make help` lists every target.

## Architecture

The module talks to the host **only** through `@tabterm/module-host` plus its own files —
no deep imports into a host's `src/`. It owns everything it needs:

- `shared.ts` — notes domain + wire types (`Note`, `NoteFolder`, `note:*` / `noteFolder:*` messages).
- `server.ts` — server entry: `activate(host)` wires `host.migrate`, `host.onMessage`, upload + list routes.
- `server/` — `db.ts` (queries) + `migrations.ts` (owns the `notes` / `note_folders` / `active_note` tables), `service.ts` (message handler), `upload.ts` (image upload via `host.dataDir`).
- `src/index.tsx` — client entry: `activate(host)` registers the rail page, session panel, and a self-gating toggle (`tabBarAction`); panel visibility + Excalidraw debounce are owned via `host.kv`.
- `src/` — Tiptap editor (`noteEditor.tsx`, `TiptapEditor.tsx`, `editor/`), Excalidraw note, panels, slash menu, markdown round-trip.

## Host contract (`@tabterm/module-host`)

- **Vendored** under `vendor/module-host/`, resolved via `file:./vendor/module-host` — no
  registry dependency. Pinned to a tagged snapshot (see `vendor/README.md`).
- Refresh it with `make vendor TABTERM=<path-to-tabterm>` when the contract changes, then
  bump `vendor/module-host/package.json` and re-tag.
- `react` / `react-dom` / `zustand` are **host-provided** at runtime (externalized in the
  host's module build) — declared here as peer/dev deps for typecheck + tests only.

## Building / consuming this module

This repo ships **source**, not bundles. A tabterm host's build (`scripts/build-modules.ts`)
is what compiles a module to `dist/modules/notes/{client.js,client.css,server.js}`:
`src/index.tsx` → `client.js` (ESM, react/react-dom/zustand external, code-split — it uses
dynamic `import()` for Excalidraw), `.css` imports extracted → sibling `client.css`,
`server.ts` → `server.js` (`--target bun`).

> **Not yet wired into tabterm.** tabterm builds modules from its in-tree `modules/*/`.
> Since notes was removed from that tree, the host must be taught to source notes from
> this repo (path/link build input, a prebuilt artifact dropped into `dist/modules/notes/`,
> or a published package) before notes loads again. See `README.md` for the options.

## Conventions

- Surgical changes; match existing style. The module's clean host-only boundary is the
  whole point of the extraction — never reach back into a host's internals.
- Tests are colocated (`*.test.ts[x]`). DOM tests use `happy-dom`.
