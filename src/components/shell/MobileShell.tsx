"use client";

import React, { useState } from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import MobileHeader from "./MobileHeader";
import BottomTabs, { type MobileTab } from "./BottomTabs";
import BottomSheet from "./BottomSheet";

/**
 * Per-tab content placeholders (issue #43). Interactive content is built in the
 * feature issues: Heute → #44, Todos → #45, Board → #46.
 */
function MobileContent({ tab }: { tab: MobileTab }) {
  if (tab === "heute") {
    return <p className="pt-8 text-center text-sm text-text-dim">Noch nichts für heute.</p>;
  }
  if (tab === "board") {
    return <p className="pt-8 text-center text-sm text-text-dim">Board folgt.</p>;
  }
  return <p className="pt-8 text-center text-sm text-text-dim">Noch keine Todos.</p>;
}

/** Fixed Heute chat input bar (placeholder; the real composer lands in #44). */
function HeuteInputBar() {
  return (
    <div className="shrink-0 px-4 pb-3 pt-1">
      <div
        className="flex items-center gap-2 rounded-full bg-bg-card"
        style={{ padding: "8px 8px 8px 18px" }}
      >
        <span className="flex-1 text-sm text-text-dim">Sag&apos;s aido kurz …</span>
        <span
          className="flex items-center justify-center rounded-full text-white"
          style={{ width: 30, height: 30, background: "var(--accent)" }}
          aria-hidden
        >
          ↑
        </span>
      </div>
    </div>
  );
}

/**
 * Mobile shell (issue #43): single column — fixed header, scrolling content,
 * contextual Heute input, fixed bottom tabs; bottom sheets overlay the root.
 * Shown only below the `md` breakpoint (desktop shell handles md+).
 */
export default function MobileShell() {
  const { activeSpace, loading } = useSpaces();
  const [tab, setTab] = useState<MobileTab>("todos");
  const [addSpaceOpen, setAddSpaceOpen] = useState(false);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-bg text-text md:hidden">
      <MobileHeader onAddSpace={() => setAddSpaceOpen(true)} />

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="pt-10 text-center text-sm text-text-dim">Lädt …</p>
        ) : !activeSpace ? (
          <div className="pt-16 text-center">
            <p className="text-lg font-extrabold">Noch keine Spaces</p>
            <p className="mt-1 text-sm text-text-dim">Leg über „+ Space“ deinen ersten Space an.</p>
          </div>
        ) : (
          <MobileContent tab={tab} />
        )}
      </div>

      {activeSpace && tab === "heute" && <HeuteInputBar />}

      <BottomTabs tab={tab} onChange={setTab} />

      {/* Space creation form lands in the spaces-management issue (#47). */}
      <BottomSheet open={addSpaceOpen} onClose={() => setAddSpaceOpen(false)} title="Neuer Space">
        <p className="pb-4 text-sm text-text-dim">Space anlegen — bald verfügbar.</p>
      </BottomSheet>
    </div>
  );
}
