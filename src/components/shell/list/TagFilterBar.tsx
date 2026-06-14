"use client";

import React from "react";
import { useTodos } from "@/lib/contexts/TodosContext";

/**
 * Tag chip bar (issue #45): all tags of the space; chips are combinable (AND).
 * Active chip = accent/white. "✕ Filter" resets.
 */
export default function TagFilterBar() {
  const { tags, tagFilters, toggleTag, clearTags } = useTodos();
  // Render while there are tags to pick OR a filter is still active, so the
  // "✕ Filter" reset stays reachable even if the last filtered tag just vanished
  // (issue #74) — otherwise the list could be stuck empty with no affordance.
  if (tags.length === 0 && tagFilters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => {
        const active = tagFilters.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => toggleTag(tag)}
            className="rounded-full px-3 py-1 font-mono text-xs"
            style={
              active
                ? { background: "var(--accent)", color: "#fff" }
                : { background: "var(--bg-card)", color: "var(--tag)" }
            }
          >
            #{tag}
          </button>
        );
      })}
      {tagFilters.length > 0 && (
        <button
          type="button"
          onClick={clearTags}
          className="text-xs text-text-dim hover:text-text"
        >
          ✕ Filter
        </button>
      )}
    </div>
  );
}
