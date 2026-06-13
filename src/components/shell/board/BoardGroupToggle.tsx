"use client";

import React from "react";
import type { GroupBy } from "./columns";

const OPTIONS: { id: GroupBy; label: string }[] = [
  { id: "person", label: "Nach Person" },
  { id: "status", label: "Nach Status" },
];

/** "Nach Person" / "Nach Status" grouping toggle (issue #46). */
export default function BoardGroupToggle({
  value,
  onChange,
}: {
  value: GroupBy;
  onChange: (next: GroupBy) => void;
}) {
  return (
    <div className="flex gap-2">
      {OPTIONS.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="rounded-full px-4 py-1.5 text-sm font-bold"
            style={
              active
                ? { background: "var(--accent)", color: "#fff" }
                : { background: "var(--bg-card)", color: "var(--text-dim)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
