"use client";

import React, { useRef, useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useOutsideClick } from "@/lib/hooks/useOutsideClick";
import Avatar from "./Avatar";
import AccountActions from "./AccountActions";

/**
 * Desktop sidebar-footer account menu (issue #49): the current user's avatar +
 * name open a popover with Settings / Kontakte / Abmelden.
 */
export default function AccountMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, open, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2">
        <Avatar uid={user?.uid ?? "me"} name={user?.displayName} size={28} />
        <span className="flex-1 truncate text-left text-sm font-semibold">
          {user?.displayName ?? "Account"}
        </span>
        <span className="text-text-dim">⌄</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-full rounded-xl border border-border bg-bg-pop p-1 shadow-soft">
          <AccountActions onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
