"use client";

import React, { useMemo, useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useAuth } from "@/lib/hooks/useAuth";
import { useSpaceMemberNames } from "@/lib/hooks/useMemberProfiles";
import Avatar from "../Avatar";
import BottomSheet from "../BottomSheet";
import BoardGroupToggle from "./BoardGroupToggle";
import TodoCard from "./TodoCard";
import { buildColumns, type GroupBy } from "./columns";
import type { Todo } from "@/lib/types";

/**
 * Mobile Board (issue #46): columns stacked vertically; instead of drag & drop,
 * each card has a "Verschieben" sheet listing the other columns as targets.
 */
export default function MobileBoard() {
  const { todos, loading, setWaitingOn, setStatus } = useTodos();
  const { activeSpace, accent } = useSpaces();
  const { user } = useAuth();
  const nameOf = useSpaceMemberNames();

  const [groupBy, setGroupBy] = useState<GroupBy>("person");
  const [moveCard, setMoveCard] = useState<Todo | null>(null);

  const columns = useMemo(
    () =>
      buildColumns({
        groupBy,
        todos,
        members: activeSpace?.members ?? [],
        currentUid: user?.uid,
        nameOf,
        setWaitingOn,
        setStatus,
      }),
    [groupBy, todos, activeSpace, user, nameOf, setWaitingOn, setStatus]
  );

  const targets = columns.filter((c) => c.apply);

  return (
    <div className="flex flex-col gap-4">
      <BoardGroupToggle value={groupBy} onChange={setGroupBy} />

      {loading ? (
        <p className="text-sm text-text-dim">Lädt …</p>
      ) : (
        columns.map((col) => (
          <section key={col.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {col.badgeUid && <Avatar uid={col.badgeUid} name={nameOf(col.badgeUid)} size={20} />}
              <span className="text-xs font-extrabold uppercase tracking-wide text-text-dim">{col.label}</span>
              {col.todos.length > 0 && <span className="ml-auto text-xs text-text-dim">{col.todos.length}</span>}
            </div>
            {col.todos.map((t) => (
              <TodoCard key={t.id} todo={t} accent={accent} nameOf={nameOf} onMove={() => setMoveCard(t)} />
            ))}
            {col.todos.length === 0 && <p className="text-xs text-text-dim">—</p>}
          </section>
        ))
      )}

      <BottomSheet open={!!moveCard} onClose={() => setMoveCard(null)} title="Verschieben">
        <div className="flex flex-col">
          {targets.map((col) => (
            <button
              key={col.id}
              type="button"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-row-hover"
              style={{ minHeight: 44 }}
              onClick={async () => {
                if (moveCard && col.apply) await col.apply(moveCard.id);
                setMoveCard(null);
              }}
            >
              {col.badgeUid && <Avatar uid={col.badgeUid} name={nameOf(col.badgeUid)} size={20} />}
              {col.label}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
