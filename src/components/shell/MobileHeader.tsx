"use client";

import React from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useMemberProfiles } from "@/lib/hooks/useMemberProfiles";
import { spaceColorFromHue } from "@/lib/theme/colors";
import Avatar from "./Avatar";
import ThemeToggle from "./ThemeToggle";

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

interface MobileHeaderProps {
  /** Opens the "+ Space" creation sheet. */
  onAddSpace: () => void;
  /** Opens the members sheet for the active space (tapping the avatar stack). */
  onManageMembers: () => void;
}

/**
 * Fixed mobile header (issue #43): brand + member avatars + theme toggle, with a
 * horizontally scrollable row of space pills underneath. Blurred nav background.
 */
export default function MobileHeader({ onAddSpace, onManageMembers }: MobileHeaderProps) {
  const { spaces, activeSpaceId, activeSpace, openCounts, setActiveSpace } = useSpaces();
  const profiles = useMemberProfiles(activeSpace?.members ?? []);
  const members = activeSpace?.members ?? [];

  return (
    <header
      className="flex shrink-0 flex-col gap-2 border-b border-border"
      style={{
        background: "var(--nav-bg)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 10px",
      }}
    >
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-[17px] font-black">aido</span>
        <div className="ml-auto flex items-center gap-2">
          {members.length > 0 && (
            <button
              type="button"
              onClick={onManageMembers}
              className="flex items-center"
              aria-label="Mitglieder verwalten"
            >
              {members.map((uid, i) => (
                <div key={uid} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                  <Avatar uid={uid} name={profiles[uid]?.displayName} size={26} ring />
                </div>
              ))}
            </button>
          )}
          <ThemeToggle width={42} height={24} />
        </div>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {spaces.map((space) => {
          const active = space.id === activeSpaceId;
          const count = openCounts[space.id];
          return (
            <button
              key={space.id}
              type="button"
              onClick={() => setActiveSpace(space.id)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold"
              style={
                active
                  ? { background: "var(--accent-soft)", borderColor: "var(--accent)" }
                  : { borderColor: "var(--border)", color: "var(--text-dim)" }
              }
            >
              <span
                style={{ width: 8, height: 8, borderRadius: 3, background: spaceColorFromHue(space.color) }}
              />
              <span className="whitespace-nowrap">{space.name}</span>
              {typeof count === "number" && count > 0 && (
                <span className="text-xs text-text-dim">{count}</span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAddSpace}
          className="flex shrink-0 items-center whitespace-nowrap rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-text-dim"
        >
          + Space
        </button>
      </div>
    </header>
  );
}
