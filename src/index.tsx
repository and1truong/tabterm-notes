import type { ClientHost, DiagramEditorProps } from "@tabterm/module-host/client";
import { PenTool } from "lucide-react";
import { HostCtx } from "./useHost.ts";
import ExcalidrawNote from "./ExcalidrawNote.tsx";
import { hasCoreNotesCapability } from "../capability.ts";

export default function activate(host: ClientHost) {
  if (!hasCoreNotesCapability(host) || !host.notes) return;

  function DiagramEditor(props: DiagramEditorProps) {
    return (
      <HostCtx.Provider value={host}>
        <ExcalidrawNote {...props} />
      </HostCtx.Provider>
    );
  }

  return host.notes.registerDiagram({
    Editor: DiagramEditor,
    icon: <PenTool size={14} />,
    summarize(content) {
      const parsed = JSON.parse(content || "{}");
      const count = Array.isArray(parsed.elements) ? parsed.elements.length : 0;
      return `${count} element(s)`;
    },
  });
}
