"use client";

import React from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import ListView from "./list/ListView";
import Heute from "./heute/Heute";

/**
 * Main-column content for the desktop shell: Heute (#44) above the active view.
 * Board (#46) is still a placeholder.
 */
export default function WorkspaceContent() {
  const { view } = useSpaces();

  return (
    <>
      <Heute />

      {/* Liste (issue #45) or Board (placeholder until #46) */}
      {view === "board" ? (
        <div className="flex flex-col gap-3">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-dim">Board</div>
          <div
            className="flex items-center justify-center text-sm text-text-dim"
            style={{ border: "1px dashed var(--border)", borderRadius: 16, minHeight: 240 }}
          >
            Board folgt.
          </div>
        </div>
      ) : (
        <ListView />
      )}
    </>
  );
}
