"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/hooks/useAuth";

/**
 * Account actions (issue #49): Settings · Kontakte · Abmelden. Shared by the
 * desktop AccountMenu popover and the mobile account sheet — replaces the old
 * Navbar/UserDropdown navigation.
 */
export default function AccountActions({ onNavigate }: { onNavigate?: () => void }) {
  const { signOut } = useAuth();
  const item = "block rounded-lg px-3 py-2 text-left text-sm hover:bg-row-hover";

  return (
    <div className="flex flex-col">
      <Link href="/settings" onClick={onNavigate} className={item} style={{ minHeight: 44 }}>
        Settings
      </Link>
      <Link href="/contacts" onClick={onNavigate} className={item} style={{ minHeight: 44 }}>
        Kontakte
      </Link>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          signOut();
        }}
        className={item}
        style={{ minHeight: 44, color: "var(--danger)" }}
      >
        Abmelden
      </button>
    </div>
  );
}
