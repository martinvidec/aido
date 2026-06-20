"use client";

import React, { useState } from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import BottomSheet from "../BottomSheet";
import MoveToSpaceMenu from "../MoveToSpaceMenu";
import BoardGroupToggle from "./BoardGroupToggle";
import ColumnHeader from "./ColumnHeader";
import TodoCard from "./TodoCard";
import { useBoardColumns } from "./useBoardColumns";
import { type BoardColumn, type GroupBy } from "./columns";
import type { Todo } from "@/lib/types";

/** Desktop Board view (issue #46): horizontal columns with HTML5 drag & drop. */
export default function BoardView() {
  const [groupBy, setGroupBy] = useState<GroupBy>("person");
  const { columns, loading, accent, nameOf } = useBoardColumns(groupBy);
  const { spaces } = useSpaces();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Drag & drop moves cards between columns (same space); "In Space" opens a
  // picker to move to another space (issue #202). All board todos are in the
  // active space, so "another space exists" is global.
  const [moveSpaceCard, setMoveSpaceCard] = useState<Todo | null>(null);
  const canMoveToSpace = spaces.length > 1;

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
              <ColumnHeader col={col} nameOf={nameOf} className="px-1 pb-1" />
              {col.todos.map((t) => (
                <TodoCard
                  key={t.id}
                  todo={t}
                  accent={accent}
                  nameOf={nameOf}
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  onMoveToSpace={canMoveToSpace ? () => setMoveSpaceCard(t) : undefined}
                />
              ))}
              {col.todos.length === 0 && col.apply && (
                <p className="px-1 py-4 text-center text-xs text-text-dim">Karten hierher ziehen</p>
              )}
            </div>
          ))}
        </div>
      )}

      <BottomSheet
        open={!!moveSpaceCard}
        onClose={() => setMoveSpaceCard(null)}
        title="In Space verschieben"
      >
        {moveSpaceCard && (
          <MoveToSpaceMenu
            todo={moveSpaceCard}
            nameOf={nameOf}
            onDone={() => setMoveSpaceCard(null)}
          />
        )}
      </BottomSheet>
    </div>
  );
}
