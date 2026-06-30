# Self-contained module build + v0.1.0 release

**Date:** 2026-07-01
**Status:** Approved

## Goal

Produce two ready-to-use artifacts — `client.js` and `server.js` — and attach them to a
GitHub release tagged `v0.1.0`, so a tabterm host can consume the notes module from the
release without running its own module build.

The repo currently ships **source, not bundles** (per CLAUDE.md): the bundling logic lives
in the tabterm host's `scripts/build-modules.ts`. This work ports a distilled, single-module
version of that build into this repo.

## Background: the host build contract

Learned from `~/dirs/tabterm/scripts/build-modules.ts` and `scripts/pack-release.ts`:

- **Client** (`src/index.tsx` → `client.js`): `Bun.build` API, `format: esm`, `minify: true`,
  `NODE_ENV=production` (forces the production JSX runtime `react/jsx-runtime`; the dev runtime
  emits an unmapped `react/jsx-dev-runtime` import that fails at runtime — the host re-execs the
  script with `NODE_ENV=production` to guarantee this from process start).
- **Externals:** `react`, `react-dom`, `react/jsx-runtime`, `zustand` — host-provided at runtime.
- **CSS:** side-effect imports (`@excalidraw/excalidraw/index.css`, `tippy.js/dist/tippy.css`)
  cannot be bundled into JS by Bun. The host extracts them into a sibling `client.css` injected
  by the loader.
- **Code-splitting:** the host splits because notes uses `lazy(() => import("./ExcalidrawNote.tsx"))`,
  emitting a hashed Excalidraw sibling chunk.
- **Server** (`server.ts` → `server.js`): `bun build … --format esm --target bun --minify`.

## Decisions (this repo diverges from the host deliberately)

To ship exactly **two self-contained files**:

1. **Splitting OFF.** Everything (including Excalidraw) inlines into a single `client.js`. The
   `lazy(() => import(...))` still works — Bun resolves it as an inline async chunk within the
   one file rather than a separate sibling. No hashed chunk file to ship.
2. **CSS injected at runtime from `client.js`.** The css-collect plugin still resolves and
   concatenates the same `.css` files, but instead of writing a sibling `client.css`, the
   concatenated CSS is handed to the entry as a virtual module that injects a `<style>` element
   on first evaluation (before React mounts). `client.js` is therefore truly self-contained:
   load it and styles apply, no host CSS wiring needed.
3. **Two artifacts only:** `client.js`, `server.js`.

## Components

### `scripts/build-modules.ts` (new)

Single-module build, `id = "notes"`, source at repo root (`src/index.tsx`, `server.ts`),
output to `dist/modules/notes/` (gitignored).

- **Re-exec guard** for `NODE_ENV=production` (verbatim host logic).
- **`resolveCss(spec, importer, req)`** — verbatim from host: handles relative paths, package
  `exports` subpaths honoring the `production`/`default`/`import`/`style` condition (needed for
  `@excalidraw`), and direct in-package file paths.
- **`cssCollectPlugin(sink, req, entry)`** — verbatim: collects `.css` side-effect imports into
  `sink`, strips them from the JS.
- **CSS injection** — after the build, if `sink` has CSS, it must end up inside `client.js`.
  Approach: a Bun plugin providing a virtual entry that (a) injects the collected CSS via a
  `<style>` tag, then (b) re-exports the real `src/index.tsx`. Because CSS is only known after a
  first resolve pass, build in the natural order: run `Bun.build` with the css-collect plugin to
  gather CSS and emit the JS, then **prepend** a small self-injecting IIFE carrying the CSS string
  to the emitted `client.js`. Prepending is simplest and avoids a two-pass virtual-module dance;
  the IIFE runs at module-evaluation time, before `activate()` is called.
- **Client build:** `entrypoints: [src/index.tsx]`, `outdir`, `format: esm`, `minify: true`,
  `external: ["react","react-dom","react/jsx-runtime","zustand"]`, `splitting: false`,
  `naming: { entry: "client.js" }`, css-collect plugin. `req = createRequire(<repo>/package.json)`.
- **Server build:** `bun build server.ts --outfile dist/modules/notes/server.js --format esm
  --target bun --minify`.
- Drops the host's multi-module loop, `--watch`, and multi-id reset — single module only.

### `Makefile`

Add a `build` target: `bun scripts/build-modules.ts`, wired into `make help` and listed in
`.PHONY`.

### Release

`make build`, then `gh release create v0.1.0 --title … --notes …
dist/modules/notes/client.js dist/modules/notes/server.js`. Tag `v0.1.0` matches
`package.json` version.

## Verification

1. `make build` exits 0; `dist/modules/notes/client.js` and `server.js` exist.
2. `client.js` is valid ESM, externalizes react/zustand (no bundled React), and contains the
   injected CSS (`grep` for an Excalidraw/tippy selector + a `style` injection).
3. `client.js` contains no `react/jsx-dev-runtime` import (prod JSX runtime confirmed).
4. `client.js` has no sibling-chunk import (splitting confirmed off / self-contained).
5. `make check` (typecheck + test) still passes — the script must not break the existing gate.
6. Release exists with both files attached (`gh release view v0.1.0`).

## Out of scope

- Wiring notes into a host (still the host's job — see README).
- Publishing to a package registry.
- Shipping `client.css` separately or any third artifact.
