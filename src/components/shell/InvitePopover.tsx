"use client";

import React, { useEffect, useRef, useState } from "react";
import MemberManager from "./MemberManager";

/**
 * Desktop "+ einladen" popover (issue #47): toggles a panel with the member
 * manager. Closes on outside click.
 */
export default function InvitePopover() {
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
        className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-text-dim hover:text-text"
      >
        + einladen
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-64 rounded-xl border border-border bg-bg-pop p-2 shadow-soft">
          <MemberManager />
        </div>
      )}
    </div>
  );
}
