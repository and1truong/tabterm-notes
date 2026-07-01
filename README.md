# @tabterm/module-notes

The **notes** module for [tabterm](https://github.com/and1truong/tabterm) — markdown
notes and Excalidraw whiteboards, scoped per session or per workspace. Tiptap editor,
conflict-safe versioning, offline edit queue, image upload.

Extracted from the tabterm monorepo (`modules/notes/`) into its own repository.

## Layout

```
shared.ts            Notes domain + wire types (Note, NoteFolder, note:* messages)
server.ts            Server entry — activate(host): migrate, onMessage, routes
server/              DB schema + migrations, message service, image upload
src/index.tsx        Client entry — activate(host): registerUI (rail page, panel,
                     toggle), kv-backed visibility, offline collapse
src/                 Tiptap editor, Excalidraw note, panels, slash menu, etc.
```

The module talks to the host **only** through `@tabterm/module-host` (the type-only
contract) plus its own files — no deep imports into tabterm's `src/`. It owns its DB
tables (`host.migrate`), wire messages (`host.onMessage`), routes (`host.registerRoute`),
UI (`host.ui.registerUI`), its visibility setting and Excalidraw debounce (`host.kv`),
and its CSS (extracted at build into `client.css`). See `docs/modules.md` in tabterm
for the full host API.

## Development

```sh
bun install        # resolves tiptap/excalidraw + links @tabterm/module-host
bun run typecheck  # tsc --noEmit
bun test           # server + markdown round-trip tests
```

`@tabterm/module-host` (the type-only host contract) is **vendored** under
`vendor/module-host/` and resolved via `file:./vendor/module-host` (see `package.json`
devDependencies) — no npm/registry dependency. To update it, re-copy from tabterm's
`packages/module-host/` into `vendor/module-host/`.

## Consuming this module in tabterm — NOT YET WIRED

> **Gap:** tabterm's build (`scripts/build-modules.ts`) compiles every module found
> under its in-tree `modules/*/` directory, and `config.sample.yaml` points at
> `dist/modules/notes/{client,server}.js`. With notes removed from the monorepo, that
> bundle is no longer produced, so **the notes module will not load in tabterm until the
> build is re-wired to source it from here.**

To re-enable notes in tabterm, one of:

1. **Path/link build input** — teach `build-modules.ts` to also build modules from an
   external path (e.g. this repo via `link:`), emitting to `dist/modules/notes/`.
2. **Prebuilt artifact** — drop the two files from a
   [GitHub release](https://github.com/and1truong/tabterm-notes/releases) into tabterm's
   `dist/modules/notes/`, keeping the existing `config.sample.yaml` entry. See
   [Install from a release](#install-from-a-release) below.
3. **Published package** — publish `@tabterm/module-notes` and have tabterm's build pull
   and bundle it.

The build contract a consumer must satisfy (matches tabterm's `build-modules.ts`):
- bundle `src/index.tsx` → `client.js` (ESM, react/react-dom/zustand external,
  code-split since it uses dynamic `import()`);
- extract `.css` imports → sibling `client.css` (excalidraw + tippy stylesheets);
- bundle `server.ts` → `server.js` (`--target bun`).

### Install from a release

Each [release](https://github.com/and1truong/tabterm-notes/releases) ships two
self-contained files — no build step, no host CSS wiring:

- **`client.js`** — ESM client bundle. `react`/`react-dom`/`zustand` stay external
  (host-provided at runtime); Excalidraw is inlined and its + tippy's CSS is injected
  on load. Default export is `activate(host)`.
- **`server.js`** — server half (`--target bun` ESM). Default export is `activate(host)`.

Drop both into your tabterm host's serve tree under `modules/notes/`:

```sh
mkdir -p dist/modules/notes
curl -L -o dist/modules/notes/client.js \
  https://github.com/and1truong/tabterm-notes/releases/latest/download/client.js
curl -L -o dist/modules/notes/server.js \
  https://github.com/and1truong/tabterm-notes/releases/latest/download/server.js
```

and wire them in your tabterm config:

```yaml
modules:
  - { id: notes, enabled: true, client: modules/notes/client.js, server: modules/notes/server.js }
```

> **Note:** these release artifacts differ in shape from what tabterm's own
> `build-modules.ts` emits (a code-split `client.js` + sibling chunks + a separate
> `client.css`). The release folds everything into a single self-contained `client.js`
> — the right form for dropping in directly, but not a drop-in for a host that expects
> the split output. Build from source (`make build`) if you need the host's exact shape.
