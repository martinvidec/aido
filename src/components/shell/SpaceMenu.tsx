"use client";

import React, { useEffect, useRef, useState } from "react";
import SpaceManager from "./SpaceManager";

/**
 * Desktop space "⋯" menu (issue #78): a kebab button next to the space name that
 * opens a popover with rename / delete (SpaceManager). Closes on outside click,
 * mirroring InvitePopover.
 */
export default function SpaceMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Space-Optionen"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center justify-center rounded-full border border-border text-text-dim hover:text-text"
        style={{ width: 30, height: 30 }}
      >
        ⋯
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-72 rounded-xl border border-border bg-bg-pop p-3 shadow-soft">
          <SpaceManager onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
