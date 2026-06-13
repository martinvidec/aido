"use client";

import React, { useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaceMemberNames } from "@/lib/hooks/useMemberProfiles";
import TagFilterBar from "./TagFilterBar";
import TodoComposer from "./TodoComposer";
import TodoRow from "./TodoRow";

/**
 * Desktop Liste view (issue #45): tag filter + composer + open todos + a
 * collapsible "Erledigt" section.
 */
export default function ListView() {
  const { filtered, loading } = useTodos();
  const nameOf = useSpaceMemberNames();
  const [showDone, setShowDone] = useState(false);

  const open = filtered.filter((t) => !t.completed);
  const done = filtered.filter((t) => t.completed);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-dim">Todos</div>
      <TagFilterBar />
      <TodoComposer />

      {loading ? (
        <p className="py-2 text-sm text-text-dim">Lädt …</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {open.map((t) => (
              <TodoRow key={t.id} todo={t} nameOf={nameOf} />
            ))}
            {open.length === 0 && <p className="py-2 text-sm text-text-dim">Keine offenen Todos.</p>}
          </div>

          {done.length > 0 && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setShowDone((s) => !s)}
                className="self-start text-sm font-semibold text-text-dim hover:text-text"
              >
                Erledigt ({done.length}) {showDone ? "▲" : "▼"}
              </button>
              {showDone &&
                done.map((t) => (
                  <div key={t.id} style={{ opacity: 0.55 }}>
                    <TodoRow todo={t} nameOf={nameOf} />
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
