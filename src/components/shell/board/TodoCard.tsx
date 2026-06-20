"use client";

import React from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { checklistProgress } from "@/lib/utils/checklist";
import Avatar from "../Avatar";
import TokenizedText from "../TokenizedText";
import type { Todo } from "@/lib/types";

interface TodoCardProps {
  todo: Todo;
  accent: string;
  nameOf: (uid: string) => string;
  draggable?: boolean;
  onDragStart?: () => void;
  /** Mobile: open the column "Verschieben" sheet for this card. */
  onMove?: () => void;
  /** Open the "In Space" target-space picker for this card (issue #202). */
  onMoveToSpace?: () => void;
}

/** Board card (issue #46): title + progress + "bei X" chip + check circle. */
export default function TodoCard({ todo, accent, nameOf, draggable, onDragStart, onMove, onMoveToSpace }: TodoCardProps) {
  const { setCompleted } = useTodos();
  const progress = checklistProgress(todo.body);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className="flex flex-col gap-2 bg-bg-card p-3 shadow-soft"
      style={{ borderRadius: 12, cursor: draggable ? "grab" : undefined }}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={todo.completed ? "Wieder öffnen" : "Erledigen"}
          onClick={() => setCompleted(todo.id, !todo.completed)}
          className="mt-0.5 flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: 20,
            height: 20,
            border: `2px solid ${todo.completed ? accent : "var(--check-border)"}`,
            background: todo.completed ? accent : "transparent",
          }}
        >
          {todo.completed && <span className="text-white" style={{ fontSize: 11 }}>✓</span>}
        </button>
        <span className={`flex-1 text-sm font-bold ${todo.completed ? "line-through opacity-60" : ""}`}>
          <TokenizedText text={todo.title} />
        </span>
      </div>

      {(progress.total > 0 || todo.waitingOn) && (
        <div className="flex flex-wrap items-center gap-2 pl-7">
          {todo.waitingOn && (
            <span className="flex items-center gap-1 text-xs text-text-dim">
              <Avatar uid={todo.waitingOn} name={nameOf(todo.waitingOn)} size={18} /> bei {nameOf(todo.waitingOn)}
            </span>
          )}
          {progress.total > 0 && (
            <span className="font-mono text-xs text-text-dim">
              {progress.done}/{progress.total}
            </span>
          )}
        </div>
      )}

      {(onMove || onMoveToSpace) && (
        <div className="flex flex-wrap justify-end gap-2">
          {onMove && (
            <button
              type="button"
              onClick={onMove}
              className="rounded-full border border-border px-3 py-1 text-xs font-semibold"
              style={{ minHeight: 32 }}
            >
              Verschieben
            </button>
          )}
          {onMoveToSpace && (
            <button
              type="button"
              onClick={onMoveToSpace}
              className="rounded-full border border-border px-3 py-1 text-xs font-semibold"
              style={{ minHeight: 32 }}
            >
              In Space
            </button>
          )}
        </div>
      )}
    </div>
  );
}
