// Build the notes module into two self-contained runtime artifacts under dist/:
//   src/index.tsx -> dist/modules/notes/client.js   (ESM, react/zustand external)
//   server.ts     -> dist/modules/notes/server.js   (ESM, --target bun)
//
// This is a single-module distillation of the tabterm host's scripts/build-modules.ts.
// Unlike the host build, it deliberately ships just TWO files:
//   * splitting is OFF, so the lazily-imported Excalidraw inlines into one client.js
//     instead of a hashed sibling chunk;
//   * extracted CSS (Excalidraw + tippy) is prepended to client.js as a self-injecting
//     IIFE rather than emitted as a sibling client.css the host loader injects.
// The result: client.js loads with styles applied and no host CSS wiring, and server.js
// is the server half. Output lives in dist/ (gitignored). Run from the repo root.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

// Force the production JSX runtime (react/jsx-runtime, not …/jsx-dev-runtime).
// Bun's transpiler picks dev-vs-prod automatic JSX from NODE_ENV, read once at
// process start — so setting process.env here is too late. The dev runtime emits
// a bare `react/jsx-dev-runtime` import the host import map doesn't map, which
// fails to resolve at runtime. If NODE_ENV isn't already production, re-exec this
// script once with it set so Bun.build() sees it from the start.
if (process.env.NODE_ENV !== "production") {
  const proc = Bun.spawn(["bun", "run", import.meta.path, ...process.argv.slice(2)], {
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
}

const REPO = process.cwd();
const OUT = join(REPO, "dist", "modules", "notes");
const CLIENT_SRC = join(REPO, "src", "index.tsx");
const SERVER_SRC = join(REPO, "server.ts");

// react/react-dom/zustand are provided by the host SPA at runtime (import map →
// host-shims), so the client bundle keeps them external.
const CLIENT_EXTERNALS = ["react", "react-dom", "react/jsx-runtime", "zustand"];

// Resolve a CSS specifier to a physical file. Handles a relative path, a package
// exports subpath (honoring the production condition, since some packages — e.g.
// @excalidraw — expose their stylesheet only via conditional exports), and a
// direct in-package file path. Returns null if it can't be found. Verbatim from
// the host build.
function resolveCss(spec: string, importer: string, req: NodeJS.Require): string | null {
  if (spec.startsWith(".")) {
    const p = join(dirname(importer), spec);
    return existsSync(p) ? p : null;
  }
  const parts = spec.split("/");
  const pkg = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  let pkgDir: string;
  try { pkgDir = dirname(req.resolve(join(pkg, "package.json"))); }
  catch { return null; }
  const rest = spec.slice(pkg.length + 1);
  const direct = join(pkgDir, rest);
  if (existsSync(direct)) return direct;
  try {
    const pj = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const ent = pj.exports?.["./" + rest];
    const target = typeof ent === "string" ? ent : (ent?.production ?? ent?.default ?? ent?.import ?? ent?.style);
    if (target) { const p = join(pkgDir, target); return existsSync(p) ? p : null; }
  } catch {}
  return null;
}

// A plugin that collects (and strips from the JS) every `.css` side-effect import.
// `sink` accumulates the file contents; we prepend them to client.js afterward.
// Bun cannot bundle a side-effect `import "….css"` into JS, so without this the
// build fails to resolve the import outright.
function cssCollectPlugin(sink: string[], req: NodeJS.Require, entry: string): import("bun").BunPlugin {
  return {
    name: "css-collect",
    setup(b) {
      b.onResolve({ filter: /\.css$/ }, (a) => {
        const r = resolveCss(a.path, a.importer || entry, req);
        if (!r) console.warn(`[build] could not resolve CSS import "${a.path}" — skipped`);
        return { path: r ?? a.path, namespace: "css-collect" };
      });
      b.onLoad({ filter: /.*/, namespace: "css-collect" }, (a) => {
        try { sink.push(readFileSync(a.path, "utf8")); } catch {}
        return { contents: "", loader: "js" };
      });
    },
  };
}

// A self-injecting prelude prepended to client.js: on module evaluation (before
// activate() runs) it appends one <style> with the module's concatenated CSS, so
// client.js is fully self-styled with no host CSS wiring. Guarded so a second
// evaluation (e.g. HMR) doesn't duplicate the tag. The CSS is JSON-encoded to
// survive any characters safely.
function cssPrelude(css: string): string {
  return `(function(){try{if(typeof document==="undefined")return;` +
    `if(document.getElementById("tabterm-notes-styles"))return;` +
    `var s=document.createElement("style");s.id="tabterm-notes-styles";` +
    `s.textContent=${JSON.stringify(css)};document.head.appendChild(s);}catch(e){}})();\n`;
}

async function buildClient(): Promise<void> {
  const css: string[] = [];
  // Resolve module-declared CSS deps against this module's own package.json.
  const req = createRequire(join(REPO, "package.json"));
  const res = await Bun.build({
    entrypoints: [CLIENT_SRC],
    outdir: OUT,
    format: "esm",
    minify: true,
    external: CLIENT_EXTERNALS,
    plugins: [cssCollectPlugin(css, req, CLIENT_SRC)],
    // Splitting OFF: the lazy Excalidraw import inlines into the single client.js
    // instead of a hashed sibling chunk, so only one client file ships.
    splitting: false,
    naming: { entry: "client.js" },
  });
  if (!res.success) {
    console.error("[build] client failed:");
    for (const log of res.logs) console.error(log);
    process.exit(1);
  }
  // Fold the extracted CSS into client.js so it stays a single self-contained file.
  if (css.length) {
    const out = join(OUT, "client.js");
    const js = readFileSync(out, "utf8");
    writeFileSync(out, cssPrelude(css.join("\n")) + js);
  }
}

async function buildServer(): Promise<void> {
  const proc = Bun.spawn(
    ["bun", "build", SERVER_SRC, "--outfile", join(OUT, "server.js"),
      "--format", "esm", "--target", "bun", "--minify"],
    { cwd: REPO, env: { ...process.env, NODE_ENV: "production" }, stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`[build] server failed (exit ${code})`);
    process.exit(code || 1);
  }
}

// Fresh output dir — drops stale artifacts from a previous build.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await buildClient();
await buildServer();

console.log(`[build] notes → ${join("dist", "modules", "notes")}/{client.js,server.js}`);
