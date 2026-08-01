# tabterm-notes

The optional Excalidraw extension for tabterm core notes. It is a tabterm module, not
a standalone app, and requires `host.notes.apiVersion === 1`.

## Toolchain

- **Runtime + package manager: [Bun](https://bun.sh)** (required ≥1.3.5, see `package.json` engines).
  Use `bun` for everything. Do **not** use `npm`, `yarn`, or `pnpm`. Lockfile is `bun.lock`.
- **Typecheck:** `bun run typecheck` (`tsc --noEmit`) — or `make typecheck`.
- **Test:** `bun test` — or `make test`.
- **Full local gate:** `make check` (typecheck + test).
- `make help` lists every target.

## Architecture

The module talks to the host only through `@tabterm/module-host`; never import a
host's `src/`. Core owns note/task data and UI. This repository owns only:

- `server.ts` — defines the diagram-specific debounce setting.
- `src/index.tsx` — registers the diagram editor, icon, and summary callback.
- `src/ExcalidrawNote.tsx` — scene parsing, rendering, and serialization.
- `src/tailwind.css` — diagram-specific theme and welcome styles.

## Host contract (`@tabterm/module-host`)

- **Vendored** under `vendor/module-host/`, resolved via `file:./vendor/module-host` — no
  registry dependency. Pinned to a tagged snapshot (see `vendor/README.md`).
- Refresh it with `make vendor TABTERM=<path-to-tabterm>` when the contract changes, then
  bump `vendor/module-host/package.json` and re-tag.
- `react` / `react-dom` / `zustand` are **host-provided** at runtime (externalized in the
  host's module build) — declared here as peer/dev deps for typecheck + tests only.

## Building / consuming this module

`bun scripts/build-modules.ts` produces self-contained
`dist/modules/notes/{client.js,server.js}` artifacts. Verify the client with core's
`scripts/check-bundle.ts` before release.

## Conventions

- Surgical changes; match existing style. The module's clean host-only boundary is the
  whole point of the extraction — never reach back into a host's internals.
- Tests are colocated (`*.test.ts[x]`).
