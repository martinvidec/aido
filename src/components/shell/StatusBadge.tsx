"use client";

import React from "react";
import type { Todo } from "@/lib/types";

/**
 * Agent-Session state badge (epic #212): "bei aido" (queued) or "in Arbeit"
 * (claimed). Renders nothing when the todo isn't bound to a session or is
 * completed (a done todo is released from its session). The exact lease isn't
 * known client-side; a present `claimedBy` is treated as "in Arbeit".
 */
export default function StatusBadge({ todo }: { todo: Todo }) {
  // Not bound, completed, or a legacy handed-off todo (aidoTurn 'user' is no
  // longer produced — handoff now releases the binding) → no badge.
  if (!todo.attachedSession || todo.completed || todo.aidoTurn === "user") return null;

  const state = todo.claimedBy
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
