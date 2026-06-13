"use client";

import React from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";

export type MobileTab = "heute" | "todos" | "board";

function SpeechIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
    </svg>
  );
}
function LinesIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
function BarsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="10" rx="1.5" /><rect x="17" y="4" width="5" height="13" rx="1.5" />
    </svg>
  );
}

const TABS: { id: MobileTab; label: string; Icon: () => React.JSX.Element }[] = [
  { id: "heute", label: "Heute", Icon: SpeechIcon },
  { id: "todos", label: "Todos", Icon: LinesIcon },
  { id: "board", label: "Board", Icon: BarsIcon },
];

interface BottomTabsProps {
  tab: MobileTab;
  onChange: (tab: MobileTab) => void;
}

/**
 * Mobile bottom tab bar (issue #43): Heute · Todos · Board. The Todos tab shows
 * the active space's open-todo count as a badge pin.
 */
export default function BottomTabs({ tab, onChange }: BottomTabsProps) {
  const { activeSpaceId, openCounts } = useSpaces();
  const openCount = activeSpaceId ? openCounts[activeSpaceId] : undefined;

  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-border"
      style={{
        background: "var(--nav-bg)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        padding: "8px 8px calc(env(safe-area-inset-bottom, 0px) + 10px)",
      }}
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = tab === id;
        const showBadge = id === "todos" && typeof openCount === "number" && openCount > 0;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className="flex flex-1 flex-col items-center gap-1 py-1"
            style={{ color: active ? "var(--accent)" : "var(--text-dim)", minHeight: 44 }}
          >
            <span className="relative">
              <Icon />
              {showBadge && (
                <span
                  className="absolute -right-2 -top-1 flex items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                  style={{ minWidth: 16, height: 16, background: "var(--accent)" }}
                >
                  {openCount}
                </span>
              )}
            </span>
            <span className="text-[11px] font-extrabold">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
