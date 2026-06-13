"use client";

import React, { useState } from "react";
import { useDaily } from "@/lib/contexts/DailyContext";
import { useMemberResolver } from "./useMemberResolver";

/**
 * Heute chat input (issue #44): pill with a round send button. A trailing
 * @token opens a member-autocomplete popover above the field; Enter picks the
 * first suggestion when open, otherwise sends. Creates a Daily for today.
 */
export default function HeuteInput() {
  const { add } = useDaily();
  const resolver = useMemberResolver();
  const [value, setValue] = useState("");

  const tokenMatch = value.match(/@(\w*)$/);
  const query = tokenMatch ? tokenMatch[1].toLowerCase() : null;
  const suggestions =
    query !== null
      ? resolver.members.filter((uid) => resolver.nameOf(uid).toLowerCase().includes(query)).slice(0, 5)
      : [];
  const showSuggestions = query !== null && suggestions.length > 0;

  const pick = (uid: string) => {
    setValue(value.replace(/@(\w*)$/, `@${resolver.firstName(uid)} `));
  };

  const send = () => {
    const text = value.trim();
    if (!text) return;
    setValue("");
    add(text);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (showSuggestions) {
        e.preventDefault();
        pick(suggestions[0]);
        return;
      }
      send();
    }
  };

  return (
    <div className="relative">
      {showSuggestions && (
        <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-border bg-bg-pop p-1 shadow-soft">
          {suggestions.map((uid) => (
            <button
              key={uid}
              type="button"
              // Keep focus in the input on click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(uid)}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-row-hover"
              style={{ minHeight: 44 }}
            >
              @{resolver.firstName(uid)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-full bg-bg-card" style={{ padding: "8px 8px 8px 18px" }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Sag's aido kurz … „Pakete annehmen @Michi“"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-dim"
        />
        <button
          type="button"
          onClick={send}
          aria-label="Senden"
          className="flex shrink-0 items-center justify-center rounded-full text-white"
          style={{ width: 30, height: 30, background: "var(--accent)" }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
