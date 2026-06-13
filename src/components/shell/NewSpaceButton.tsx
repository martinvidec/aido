"use client";

import React, { useState } from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";

/**
 * Sidebar "+ Neuer Space" entry (issue #47): a dim button that turns into an
 * inline input on click. Enter confirms, Escape/blur cancels.
 */
export default function NewSpaceButton() {
  const { createSpace } = useSpaces();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const cancel = () => {
    setName("");
    setEditing(false);
  };

  const submit = async () => {
    const value = name.trim();
    if (!value) {
      cancel();
      return;
    }
    setBusy(true);
    await createSpace(value);
    setBusy(false);
    setName("");
    setEditing(false);
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
        if (e.key === "Enter") submit();
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
