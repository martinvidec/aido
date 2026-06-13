"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/hooks/useAuth";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { spaceColorFromHue } from "@/lib/theme/colors";
import Avatar from "./Avatar";
import ThemeToggle from "./ThemeToggle";
import NewSpaceButton from "./NewSpaceButton";

/** aido logo: rounded accent square with two white "robot eyes". */
function Logo() {
  return (
    <div
      className="flex items-center justify-center gap-[3px]"
      style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: "var(--accent)" }}
      aria-hidden
    >
      <span className="block rounded-full bg-white" style={{ width: 5, height: 5 }} />
      <span className="block rounded-full bg-white" style={{ width: 5, height: 5 }} />
    </div>
  );
}

export default function Sidebar() {
  const { user } = useAuth();
  const { spaces, activeSpaceId, openCounts, setActiveSpace } = useSpaces();

  return (
    <aside
      className="flex shrink-0 flex-col gap-1 border-r border-border bg-bg-side"
      style={{ width: 256, padding: "22px 14px 18px" }}
    >
      {/* Brand + theme toggle */}
      <div className="flex items-center gap-2 px-1">
        <Logo />
        <span className="text-[17px] font-black tracking-tight">aido</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>

      {/* Spaces section */}
      <div
        className="mt-5 px-3 text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-dim"
      >
        Spaces
      </div>

      <nav className="flex flex-col gap-1">
        {spaces.map((space) => {
          const active = space.id === activeSpaceId;
          const count = openCounts[space.id];
          return (
            <button
              key={space.id}
              type="button"
              onClick={() => setActiveSpace(space.id)}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-row-hover ${
                active ? "bg-row-hover font-extrabold" : "font-semibold"
              }`}
            >
              <span
                className="shrink-0"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 4,
                  backgroundColor: spaceColorFromHue(space.color),
                }}
              />
              <span className="flex-1 truncate">{space.name}</span>
              {typeof count === "number" && count > 0 && (
                <span className="text-xs text-text-dim">{count}</span>
              )}
            </button>
          );
        })}

        <NewSpaceButton />
      </nav>

      {/* Footer: current user + settings */}
      <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
        <Avatar uid={user?.uid ?? "me"} name={user?.displayName} size={28} />
        <span className="flex-1 truncate text-sm font-semibold">
          {user?.displayName ?? "Account"}
        </span>
        <Link href="/settings" className="text-sm text-text-dim hover:text-text">
          Settings
        </Link>
      </div>
    </aside>
  );
}
