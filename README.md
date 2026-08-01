# @tabterm/module-notes

The optional Excalidraw extension for [tabterm](https://github.com/and1truong/tabterm)
core notes. On a capable core, this module owns diagram rendering, scene
serialization, diagram settings, and diagram-specific CSS only. Core owns Markdown
notes, folders, tasks, persistence, synchronization, uploads, and all Notes surfaces.

This compatibility release is dual-mode: an old core receives the complete legacy
notes feature, while a core exposing `host.notes.apiVersion === 1` receives only the
diagram integration. This lets deployments upgrade the module before core without a
flag-day data migration.

## Layout

```
capability.ts        Selects legacy or diagram-only activation
server.ts            Diagram setting on capable core; legacy server fallback otherwise
src/index.tsx        Registers the diagram editor on capable core
src/ExcalidrawNote   Scene parsing, rendering, and serialization
server/, shared.ts   Temporary old-core compatibility implementation
src/* notes/tasks    Temporary old-core compatibility implementation
```

The capable-core path talks to core through the narrow, versioned `host.notes`
contract. The registered editor receives and emits serialized content; core owns OCC,
transport, conflicts, and persistence and never parses Excalidraw JSON. The module's
server half defines only `excalidrawDebounceMs`. Existing diagram rows remain normal
`Note` rows with `type: "excalidraw"`.

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

## Consuming this module in tabterm

Markdown notes and tasks need no module. To enable diagram creation and editing, use
one of:

1. **External config path** — build this repository and point tabterm's `notes`
   module entry at `dist/modules/notes/client.js` and `server.js`.
2. **Prebuilt artifact** — drop the two files from a
   [GitHub release](https://github.com/and1truong/tabterm-notes/releases) into tabterm's
   `dist/modules/notes/`, keeping the existing `config.sample.yaml` entry. See
   [Install from a release](#install-from-a-release) below.
3. **Published package** — publish `@tabterm/module-notes` and have a deployment pull
   and bundle it.

Do not symlink this repository under tabterm's `modules/` directory.

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
