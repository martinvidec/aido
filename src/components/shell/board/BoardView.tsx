"use client";

import React, { useMemo, useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useAuth } from "@/lib/hooks/useAuth";
import { useSpaceMemberNames } from "@/lib/hooks/useMemberProfiles";
import Avatar from "../Avatar";
import BoardGroupToggle from "./BoardGroupToggle";
import TodoCard from "./TodoCard";
import { buildColumns, type BoardColumn, type GroupBy } from "./columns";

/** Desktop Board view (issue #46): horizontal columns with HTML5 drag & drop. */
export default function BoardView() {
  const { todos, loading, setWaitingOn, setStatus } = useTodos();
  const { activeSpace, accent } = useSpaces();
  const { user } = useAuth();
  const nameOf = useSpaceMemberNames();

  const [groupBy, setGroupBy] = useState<GroupBy>("person");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

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

  const onDrop = async (col: BoardColumn) => {
    const id = dragId;
    setDragId(null);
    setDragOver(null);
    if (id && col.apply) await col.apply(id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-dim">Gruppieren</span>
        <BoardGroupToggle value={groupBy} onChange={setGroupBy} />
        <span className="ml-auto text-xs text-text-dim">Karten ziehen, um sie zu verschieben</span>
      </div>

      {loading ? (
        <p className="text-sm text-text-dim">Lädt …</p>
      ) : (
        <div
          className="grid gap-3 overflow-x-auto pb-2"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(190px, 1fr))` }}
        >
          {columns.map((col) => (
            <div
              key={col.id}
              onDragOver={(e) => {
                if (col.apply) {
                  e.preventDefault();
                  setDragOver(col.id);
                }
              }}
              onDragLeave={() => setDragOver((o) => (o === col.id ? null : o))}
              onDrop={() => onDrop(col)}
              className="flex flex-col gap-2 p-2"
              style={{
                border: `1.5px dashed ${dragOver === col.id ? accent : "var(--border)"}`,
                borderRadius: 16,
                minHeight: 240,
                background: dragOver === col.id ? "var(--row-hover)" : "transparent",
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              <div className="flex items-center gap-2 px-1 pb-1">
                {col.badgeUid && <Avatar uid={col.badgeUid} name={nameOf(col.badgeUid)} size={20} />}
                <span className="text-xs font-extrabold uppercase tracking-wide text-text-dim">{col.label}</span>
                {col.todos.length > 0 && <span className="ml-auto text-xs text-text-dim">{col.todos.length}</span>}
              </div>
              {col.todos.map((t) => (
                <TodoCard
                  key={t.id}
                  todo={t}
                  accent={accent}
                  nameOf={nameOf}
                  draggable
                  onDragStart={() => setDragId(t.id)}
                />
              ))}
              {col.todos.length === 0 && col.apply && (
                <p className="px-1 py-4 text-center text-xs text-text-dim">Karten hierher ziehen</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
