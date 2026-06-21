"use client";

import React, { useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaceMemberNames } from "@/lib/hooks/useMemberProfiles";
import TodoRow from "./TodoRow";
import type { Todo } from "@/lib/types";

/**
 * Shared open + collapsible "Erledigt" todo sections (issue #82) for the desktop
 * Liste (`ListView`) and the mobile Todos tab (`MobileTodos`). The two views
 * differ only in row chrome: desktop rows use an inline actions popover; mobile
 * rows open a bottom sheet via `onOpenActions` (handled by the caller).
 */
export default function TodoSections({
  variant = "desktop",
  onOpenActions,
}: {
  variant?: "desktop" | "mobile";
  onOpenActions?: (todo: Todo) => void;
}) {
  const { filtered, loading } = useTodos();
  const nameOf = useSpaceMemberNames();
  const [showDone, setShowDone] = useState(false);

  const open = filtered.filter((t) => !t.completed);
  const done = filtered.filter((t) => t.completed);
  const gap = variant === "mobile" ? "gap-2" : "gap-1";

  if (loading) return <p className="py-2 text-sm text-text-dim">Lädt …</p>;

  return (
    <>
      <div className={`flex flex-col ${gap}`}>
        {open.map((t) => (
          <TodoRow key={t.id} todo={t} nameOf={nameOf} variant={variant} onOpenActions={onOpenActions} />
        ))}
        {open.length === 0 && <p className="py-2 text-sm text-text-dim">Keine offenen Todos.</p>}
      </div>

      {done.length > 0 && (
        <div className={`flex flex-col ${gap}`}>
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            className="self-start text-sm font-semibold text-text-dim hover:text-text"
          >
            Erledigt ({done.length}) {showDone ? "▲" : "▼"}
          </button>
          {showDone &&
            done.map((t) => (
              <TodoRow key={t.id} todo={t} nameOf={nameOf} variant={variant} onOpenActions={onOpenActions} dimmed />
            ))}
        </div>
      )}
    </>
  );
}
