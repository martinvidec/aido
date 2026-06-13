"use client";

import React from "react";
import { useDaily } from "@/lib/contexts/DailyContext";
import HeuteList from "./HeuteList";
import HeuteInput from "./HeuteInput";

/** Logo icon with two robot eyes (24px), matching the sidebar logo. */
function HeuteIcon() {
  return (
    <div
      className="flex items-center justify-center gap-[3px]"
      style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: "var(--accent)" }}
      aria-hidden
    >
      <span className="block rounded-full bg-white" style={{ width: 4, height: 4 }} />
      <span className="block rounded-full bg-white" style={{ width: 4, height: 4 }} />
    </div>
  );
}

/**
 * Desktop Heute (issue #44): accent-soft container with the header, the
 * liegengeblieben/bubble list, and the chat input pill.
 */
export default function Heute() {
  const { today } = useDaily();

  return (
    <section
      className="flex flex-col gap-3"
      style={{ background: "var(--accent-soft)", borderRadius: 18, padding: "16px 18px 14px" }}
    >
      <div className="flex items-center gap-2">
        <HeuteIcon />
        <span className="text-[15px] font-black">Heute</span>
        <span className="text-sm text-text-dim">
          Kurzes für zwischendurch — landet nicht in der Liste
        </span>
        {today.length > 0 && (
          <span className="ml-auto text-sm text-accent-text">{today.length} offen</span>
        )}
      </div>
      <HeuteList />
      <HeuteInput />
    </section>
  );
}
