"use client";

import React from "react";
import { useSpaces, type SpaceView } from "@/lib/contexts/SpacesContext";

const TABS: { id: SpaceView; label: string }[] = [
  { id: "liste", label: "Liste" },
  { id: "board", label: "Board" },
];

/**
 * Liste | Board segmented control (issue #42). Active tab inverts to
 * bg=var(--text)/color=var(--bg); the track sits on bg-card with a border.
 */
export default function SegmentedControl() {
  const { view, setView } = useSpaces();

  return (
    <div className="flex shrink-0 gap-1 rounded-full border border-border bg-bg-card p-[3px]">
      {TABS.map((tab) => {
        const active = view === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            className="rounded-full px-4 py-1 text-sm font-extrabold transition-colors"
            style={
              active
                ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                : { color: "var(--text-dim)" }
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
