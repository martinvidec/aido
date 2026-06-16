"use client";

import React, { useState } from "react";
import { useCreateSpace } from "./useCreateSpace";

/**
 * Sidebar "+ Neuer Space" entry (issue #47): a dim button that turns into an
 * inline input on click. Enter confirms, Escape/blur cancels.
 */
export default function NewSpaceButton() {
  const { name, setName, busy, submit } = useCreateSpace();
  const [editing, setEditing] = useState(false);

  const cancel = () => {
    setName("");
    setEditing(false);
  };

  // Enter on an empty input closes the inline editor (matching the original).
  const onEnter = () => {
    if (!name.trim()) cancel();
    else submit(() => setEditing(false));
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-text-dim hover:bg-row-hover hover:text-text"
      >
        + Neuer Space
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={name}
      disabled={busy}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onEnter();
        else if (e.key === "Escape") cancel();
      }}
      onBlur={() => {
        if (!busy) cancel();
      }}
      placeholder="Space-Name … ⏎"
      className="rounded-xl border border-border bg-bg-card px-3 py-2.5 text-sm outline-none"
    />
  );
}
