"use client";

import React from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import ListView from "./list/ListView";

/**
 * Main-column content placeholders for the desktop shell (issue #42).
 *
 * The shell renders the Heute container chrome and the Liste/Board frame; the
 * interactive content is built in the feature issues:
 *   - Heute  → #44
 *   - Liste  → #45
 *   - Board  → #46
 * These placeholders keep the layout faithful (spacing/containers) while those
 * land, and are meant to be replaced by the feature components.
 */
export default function WorkspaceContent() {
  const { view } = useSpaces();

  return (
    <>
      {/* Heute container (chrome only; chat content → #44) */}
      <section
        className="flex flex-col gap-2"
        style={{
          background: "var(--accent-soft)",
          borderRadius: 18,
          padding: "16px 18px 14px",
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center gap-[3px]"
            style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: "var(--accent)" }}
            aria-hidden
          >
            <span className="block rounded-full bg-white" style={{ width: 4, height: 4 }} />
            <span className="block rounded-full bg-white" style={{ width: 4, height: 4 }} />
          </div>
          <span className="text-[15px] font-black">Heute</span>
          <span className="text-sm text-text-dim">
            Kurzes für zwischendurch — landet nicht in der Liste
          </span>
          <span className="ml-auto text-sm text-accent-text">0 offen</span>
        </div>
        <p className="text-sm text-text-dim">Noch nichts für heute.</p>
      </section>

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
