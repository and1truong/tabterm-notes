import { useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  serializeAsJSON,
  WelcomeScreen,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useHost } from "./useHost.ts";

// Default-exported so NotesPanel can lazy-load it (React.lazy needs a default
// export), which keeps Excalidraw's large bundle + CSS out of the main chunk
// until a diagram note is actually opened.
//
// Contract mirrors TiptapEditor: `content` is the canonical serialized scene
// (JSON string, or "" for an empty diagram) loaded once at mount; `onChange`
// emits a freshly serialized scene. NotesPanel keys this component by note id,
// so switching notes remounts it with fresh `content` — we never need to react
// to `content` changes after mount.

type Scene = { elements: unknown; appState: unknown; files: unknown };

// `ink` is tabterm's text color for the current theme — used as the default
// stroke/font color for newly-drawn shapes so they match the app palette.
// (Existing elements keep their own saved colors; this only sets the active
// tool color, resolved once at mount.)
function buildInitialData(
  content: string,
  ink: string,
): { elements: any; appState: any; files: any } | undefined {
  if (!content.trim()) {
    // empty diagram → Excalidraw's default scene, with grid enabled by default
    return {
      elements: [],
      appState: {
        gridSize: 20,
        currentItemStrokeColor: ink,
        currentItemFontColor: ink,
      },
      files: {},
    };
  }
  try {
    const d = JSON.parse(content);
    return {
      elements: d.elements ?? [],
      appState: {
        ...(d.appState ?? {}),
        currentItemStrokeColor: ink,
        currentItemFontColor: ink,
      },
      files: d.files ?? {},
    };
  } catch {
    return undefined; // corrupt body → start empty rather than crash
  }
}

export default function ExcalidrawNote({
  content,
  onChange,
}: {
  content: string;
  onChange: (json: string) => void;
}) {
  const host = useHost();
  // Match Excalidraw's theme to tabterm's configured theme (reactive).
  const [theme, setTheme] = useState(host.theme.current().mode);
  useEffect(() => host.theme.subscribe((t) => setTheme(t.mode)), [host]);

  const ink = theme === "dark" ? "#f5f0e8" : "#1a1200"; // tabterm --text per theme
  // Autosave debounce — groups rapid edits/zoom/pan into one write. Default 700ms,
  // overridable via the module's own `excalidrawDebounceMs` host.kv key.
  const debounceMs = (host.kv.get("excalidrawDebounceMs") as number | null) ?? 700;
  // Excalidraw fires onChange constantly (pointer move, selection, scroll). We
  // debounce serialization (expensive) and dedupe identical bodies. The first
  // onChange is the mount echo of `initialData` — skip it so opening a diagram
  // doesn't immediately re-persist + bump the version.
  const initial = useRef(buildInitialData(content, ink));
  const latest = useRef<Scene | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const firstChange = useRef(true);
  const lastEmitted = useRef(content);
  // The "Keyboard shortcuts" item isn't a built-in: MenuItemHelp takes no props
  // (can't relabel) and the imperative API lacks executeAction/setOpenDialog.
  // But the help dialog IS bound to the `?` key (action `toggleShortcuts`), so
  // we open it by dispatching that keydown on the Excalidraw container — the
  // same code path a real `?` press takes.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const openShortcuts = () => {
    wrapperRef.current
      ?.querySelector(".excalidraw")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "?",
          code: "Slash",
          keyCode: 191,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div ref={wrapperRef} className="excalidraw-themed h-full w-full">
      <Excalidraw
        initialData={initial.current}
        theme={theme}
        onChange={(elements, appState, files) => {
          if (firstChange.current) {
            firstChange.current = false;
            return;
          }
          latest.current = { elements, appState, files };
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            const s = latest.current!;
            const a = s.appState as {
              zoom?: { value: number };
              scrollX?: number;
              scrollY?: number;
            };
            const json = serializeAsJSON(
              s.elements as any,
              s.appState as any,
              s.files as any,
              "local",
            );
            // serializeAsJSON strips view state (zoom/scrollX/scrollY are
            // export:false in Excalidraw's APP_STATE_STORAGE_CONF). Re-inject it
            // so the viewport — not just the drawing — survives reload.
            // buildInitialData already spreads the saved appState into
            // initialData, and restoreAppState honors these fields.
            const data = JSON.parse(json);
            data.appState.zoom = { value: a.zoom?.value ?? 1 };
            data.appState.scrollX = a.scrollX ?? 0;
            data.appState.scrollY = a.scrollY ?? 0;
            const out = JSON.stringify(data, null, 2);
            if (out === lastEmitted.current) return;
            lastEmitted.current = out;
            onChange(out);
          }, debounceMs);
        }}
      >
        {/* Empty-state splash. Renders only on a blank canvas and auto-dismisses
            once the user picks a tool or draws. Styled to match tabterm (see the
            `.tt-ws-*` rules in index.css); the heading uses Excalidraw's bundled
            hand-drawn face (Excalifont) so it reads like part of the sketch. */}
        <WelcomeScreen>
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Logo>
              <span className="tt-ws-logo">
                <span className="tt-ws-dot" />
                Diagram
              </span>
            </WelcomeScreen.Center.Logo>
            <WelcomeScreen.Center.Heading>
              <div className="tt-ws-heading">Sketch an idea.</div>
              <svg
                className="tt-ws-underline"
                viewBox="0 0 168 10"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M2 6 C 30 2, 60 9, 90 5 S 150 3, 166 6" />
              </svg>
              <p className="tt-ws-sub">
                Pick a tool from top, or just start drawing — this note
                autosaves.
              </p>
            </WelcomeScreen.Center.Heading>
            <WelcomeScreen.Center.Menu>
              <WelcomeScreen.Center.MenuItem
                onSelect={openShortcuts}
                shortcut="?"
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" />
                    <circle cx="12" cy="16.6" r="0.6" fill="currentColor" stroke="none" />
                  </svg>
                }
              >
                Keyboard shortcuts
              </WelcomeScreen.Center.MenuItem>
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
          <WelcomeScreen.Hints.MenuHint>
            Menu — top left
          </WelcomeScreen.Hints.MenuHint>
          <WelcomeScreen.Hints.ToolbarHint>
            Tools — left toolbar
          </WelcomeScreen.Hints.ToolbarHint>
          <WelcomeScreen.Hints.HelpHint>
            Shortcuts — press ?
          </WelcomeScreen.Hints.HelpHint>
        </WelcomeScreen>
      </Excalidraw>
    </div>
  );
}
