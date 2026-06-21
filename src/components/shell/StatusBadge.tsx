"use client";

import React from "react";
import type { Todo } from "@/lib/types";

/**
 * Agent-Session state badge (epic #212): derives "bei aido" / "in Arbeit" /
 * "bei dir" from a todo's binding fields. Renders nothing when not attached.
 * (The exact lease isn't known client-side; a present `claimedBy` is treated as
 * "in Arbeit" — good enough for the badge.)
 */
export default function StatusBadge({ todo }: { todo: Todo }) {
  if (!todo.attachedSession) return null;

  const state =
    todo.aidoTurn === "user"
      ? { label: "bei dir", dot: "var(--accent)" }
      : todo.claimedBy
        ? { label: "in Arbeit", dot: "var(--wait-text)" }
        : { label: "bei aido", dot: "var(--text-dim)" };

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold"
      style={{ border: "1px solid var(--border)", color: "var(--text-dim)" }}
      title={`Agent-Session: ${state.label}`}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: state.dot }} />
      {state.label}
    </span>
  );
}
