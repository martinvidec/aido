"use client";

import React, { useMemo, useState } from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useTodos } from "@/lib/contexts/TodosContext";
import BottomSheet from "../BottomSheet";
import MoveToSpaceMenu from "../MoveToSpaceMenu";
import AttachToSessionMenu from "../AttachToSessionMenu";
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
  const { reorder } = useTodos();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Card being hovered as a same-column reorder target (issue #237).
  const [dropCard, setDropCard] = useState<{ id: string; pos: "above" | "below" } | null>(null);
  // Drag & drop moves cards between columns (same space); "In Space" opens a
  // picker to move to another space (issue #202). All board todos are in the
  // active space, so "another space exists" is global.
  const [moveSpaceCard, setMoveSpaceCard] = useState<Todo | null>(null);
  const [attachCard, setAttachCard] = useState<Todo | null>(null);
  const canMoveToSpace = spaces.length > 1;

  // The dragged card's todo + its current column (issue #237). Reordering is
  // limited to OPEN todos in the SAME column; completed cards (status "Erledigt")
  // aren't reorderable — mirrors the list, where the done section is fixed.
  const draggedTodo = useMemo(
    () => (dragId ? columns.flatMap((c) => c.todos).find((t) => t.id === dragId) ?? null : null),
    [columns, dragId]
  );
  const draggedColId = useMemo(
    () => (dragId ? columns.find((c) => c.todos.some((t) => t.id === dragId))?.id ?? null : null),
    [columns, dragId]
  );
  const canReorderDragged = !!draggedTodo && !draggedTodo.completed;

  const dropPos = (e: React.DragEvent<HTMLElement>): "above" | "below" => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? "above" : "below";
  };

  // Same-column reorder owns the card's drag events; stopping propagation keeps
  // the column from also reacting (which would treat it as a status/person drop).
  const onCardOver = (target: Todo) => (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    setDropCard(target.id === dragId ? null : { id: target.id, pos: dropPos(e) });
  };

  const onCardDrop = (col: BoardColumn, target: Todo) => async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const moved = dragId;
    const pos = dropPos(e);
    setDragId(null);
    setDragOver(null);
    setDropCard(null);
    if (!moved || moved === target.id) return;
    const ids = col.todos.map((t) => t.id).filter((id) => id !== moved);
    const at = ids.indexOf(target.id);
    if (at < 0) return;
    ids.splice(pos === "above" ? at : at + 1, 0, moved);
    await reorder(moved, ids);
  };

  const onDrop = async (col: BoardColumn) => {
    const id = dragId;
    setDragId(null);
    setDragOver(null);
    setDropCard(null);
    if (id && col.apply) await col.apply(id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-dim">Gruppieren</span>
        <BoardGroupToggle value={groupBy} onChange={setGroupBy} />
        <span className="ml-auto text-xs text-text-dim">Karten ziehen, um sie zu verschieben oder umzusortieren</span>
      </div>

      {loading ? (
        <p className="text-sm text-text-dim">Lädt …</p>
      ) : (
        <div
          className="grid gap-3 overflow-x-auto pb-2"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(190px, 1fr))` }}
          onDragEnd={() => {
            setDragId(null);
            setDragOver(null);
            setDropCard(null);
          }}
        >
          {columns.map((col) => (
            <div
              key={col.id}
              onDragOver={(e) => {
                if (col.apply) {
                  e.preventDefault();
                  setDragOver(col.id);
                  // Over the column padding (not a card) → no insertion line.
                  setDropCard(null);
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
              {col.todos.map((t) => {
                const reorderable = canReorderDragged && draggedColId === col.id;
                return (
                  <TodoCard
                    key={t.id}
                    todo={t}
                    accent={accent}
                    nameOf={nameOf}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onReorderOver={reorderable ? onCardOver(t) : undefined}
                    onReorderDrop={reorderable ? onCardDrop(col, t) : undefined}
                    dropHint={dropCard?.id === t.id ? dropCard.pos : null}
                    onMoveToSpace={canMoveToSpace ? () => setMoveSpaceCard(t) : undefined}
                    onAttach={() => setAttachCard(t)}
                  />
                );
              })}
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

      <BottomSheet
        open={!!attachCard}
        onClose={() => setAttachCard(null)}
        title="An Agent-Session anhängen"
      >
        {attachCard && (
          <AttachToSessionMenu todo={attachCard} onDone={() => setAttachCard(null)} />
        )}
      </BottomSheet>
    </div>
  );
}
