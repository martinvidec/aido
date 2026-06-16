"use client";

import React, { useState } from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useCreateSpace } from "./useCreateSpace";
import MobileHeader from "./MobileHeader";
import BottomTabs, { type MobileTab } from "./BottomTabs";
import BottomSheet from "./BottomSheet";
import MemberManager from "./MemberManager";
import SpaceManager from "./SpaceManager";
import AccountActions from "./AccountActions";
import MobileTodos from "./list/MobileTodos";
import MobileHeute from "./heute/MobileHeute";
import HeuteInput from "./heute/HeuteInput";
import MobileBoard from "./board/MobileBoard";

/** Per-tab content (issue #43): Heute → #44, Todos → #45, Board → #46. */
function MobileContent({ tab }: { tab: MobileTab }) {
  if (tab === "heute") {
    return <MobileHeute />;
  }
  if (tab === "board") {
    return <MobileBoard />;
  }
  return <MobileTodos />;
}

/** "+ Space" creation form, shown inside the bottom sheet (issue #47). */
function NewSpaceForm({ onDone }: { onDone: () => void }) {
  const { name, setName, busy, submit } = useCreateSpace();

  return (
    <div className="flex flex-col gap-3 pb-2">
      <input
        autoFocus
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(onDone);
        }}
        placeholder="Space-Name"
        className="rounded-xl border border-border bg-bg-card px-4 py-3 text-base outline-none"
      />
      <button
        type="button"
        onClick={() => submit(onDone)}
        disabled={busy || !name.trim()}
        className="rounded-full px-4 text-base font-extrabold text-white disabled:opacity-50"
        style={{ background: "var(--accent)", minHeight: 48 }}
      >
        {busy ? "Anlegen …" : "Anlegen"}
      </button>
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
  const [membersOpen, setMembersOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-bg text-text md:hidden">
      <MobileHeader
        onAddSpace={() => setAddSpaceOpen(true)}
        onManageMembers={() => setMembersOpen(true)}
        onAccount={() => setAccountOpen(true)}
      />

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

      {activeSpace && tab === "heute" && (
        <div className="shrink-0 px-4 pb-3 pt-1">
          <HeuteInput />
        </div>
      )}

      <BottomTabs tab={tab} onChange={setTab} />

      <BottomSheet open={addSpaceOpen} onClose={() => setAddSpaceOpen(false)} title="Neuer Space">
        <NewSpaceForm onDone={() => setAddSpaceOpen(false)} />
      </BottomSheet>

      <BottomSheet open={membersOpen} onClose={() => setMembersOpen(false)} title="Space">
        <div className="flex flex-col gap-4 pb-2">
          <SpaceManager onDone={() => setMembersOpen(false)} />
          <div className="border-t border-border" />
          <MemberManager />
        </div>
      </BottomSheet>

      <BottomSheet open={accountOpen} onClose={() => setAccountOpen(false)} title="Konto">
        <AccountActions onNavigate={() => setAccountOpen(false)} />
      </BottomSheet>
    </div>
  );
}
