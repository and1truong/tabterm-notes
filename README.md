# @tabterm/module-notes

The optional Excalidraw extension for [tabterm](https://github.com/and1truong/tabterm)
core notes. Core owns Markdown notes, folders, tasks, persistence, synchronization,
uploads, conflicts, and every Notes surface. This module owns only diagram rendering,
scene serialization, diagram settings, and diagram-specific CSS.

The module requires a host exposing `host.notes.apiVersion === 1`. Old cores must use
the retained dual-mode bridge release; this final diagram-only release has no legacy
notes fallback.

## Boundary

```
capability.ts          Host contract version check
server.ts              Defines the Excalidraw debounce setting
src/index.tsx          Registers the diagram editor, icon, and summary callback
src/ExcalidrawNote.tsx Scene parsing, rendering, and serialization
src/tailwind.css       Diagram-specific theme and welcome styles
```

The registered editor receives and emits an opaque serialized string. Core owns OCC,
transport, conflicts, and persistence and never parses Excalidraw JSON. Existing
diagrams remain core `Note` rows with `type: "excalidraw"` when this module is disabled.

## Development

```sh
bun install
bun run typecheck
bun test
bun scripts/build-modules.ts
bun ~/dirs/tabterm/scripts/check-bundle.ts dist/modules/notes
```

`@tabterm/module-host` is vendored under `vendor/module-host/` and resolved through
`file:./vendor/module-host`. Refresh it from core with `make vendor TABTERM=<path>`.

## Installation

Build this repository and point tabterm's external `notes` module entry at the two
generated artifacts:

```yaml
modules:
  - { id: notes, enabled: true, client: ~/dirs/tabterm-modules/tabterm-notes/dist/modules/notes/client.js, server: ~/dirs/tabterm-modules/tabterm-notes/dist/modules/notes/server.js }
```

Do not symlink this repository under tabterm's `modules/` directory.

Release artifacts are self-contained `client.js` and `server.js` files. The client
keeps host-provided React imports external and injects its bundled Excalidraw CSS.
