"use client";

import React from "react";
import HeuteList from "./HeuteList";

/**
 * Mobile Heute tab content (issue #44): a light header + the bubble/stale list.
 * The chat input is rendered as a fixed bar by MobileShell (HeuteInput).
 */
export default function MobileHeute() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-black">Heute</span>
        <span className="text-sm text-text-dim">landet nicht in der Liste</span>
      </div>
      <HeuteList />
    </div>
  );
}
