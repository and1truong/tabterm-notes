import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Reusable hover/focus tooltip. The bubble renders into document.body via a
// portal so it is not clipped by overflow-hidden ancestors (the status footer
// and its panel both clip). It positions itself above the trigger by default,
// clamped into the viewport, after a short delay. Styled to match existing
// floating UI (z-50, var(--panel)/var(--border), mono 11px).
export function Tooltip({
  children,
  label,
  side = "top",
  delay = 400,
}: {
  children: ReactNode;
  label: ReactNode;
  side?: "top" | "bottom";
  delay?: number;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  // Offscreen until the layout effect measures it, so the bubble's first paint
  // is already positioned (no flash from the viewport corner).
  const [coords, setCoords] = useState({ left: -9999, top: -9999 });

  const clearHover = () => {
    if (hoverTimer.current !== undefined) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = undefined;
    }
  };
  const show = () => {
    clearHover();
    hoverTimer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearHover();
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const trig = triggerRef.current?.getBoundingClientRect();
    const tip = tipRef.current;
    if (!trig || !tip) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - w - 8, trig.left + trig.width / 2 - w / 2),
    );
    const top = side === "top" ? Math.max(8, trig.top - h - 8) : trig.bottom + 8;
    setCoords({ left, top });
  }, [open, side]);

  useLayoutEffect(() => () => clearHover(), []);

  // Force the bubble closed when the label goes falsy (e.g. the timer chip
  // nulls its label while its popover is open). The early return below drops
  // the wrapper span that owns onMouseLeave, so without this the internal open
  // state — and the portal — would stay stuck on screen.
  useLayoutEffect(() => {
    if (!label) {
      clearHover();
      setOpen(false);
    }
  }, [label]);

  if (!label) return <>{children}</>;

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="fixed z-50 max-w-xs px-2 py-1 rounded-md border border-[var(--border)] shadow-lg text-[11px] mono pointer-events-none text-left"
            style={{
              left: coords.left,
              top: coords.top,
              background: "var(--panel)",
              color: "var(--text)",
            }}
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
