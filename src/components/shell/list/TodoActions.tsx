"use client";

import React, { useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import MoveToSpaceMenu from "../MoveToSpaceMenu";
import type { Todo } from "@/lib/types";

/**
 * "…" menu actions for a todo (issue #45): Bearbeiten · Wartet auf … (members +
 * Niemand) · Verschieben … (other spaces, issue #201 — picker shared with the
 * board via MoveToSpaceMenu, #202) · Löschen. Used inside the desktop popover
 * and the mobile sheet.
 */
export default function TodoActions({
  todo,
  nameOf,
  onEdit,
  onClose,
}: {
  todo: Todo;
  nameOf: (uid: string) => string;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { setWaitingOn, remove } = useTodos();
  const { activeSpace, spaces } = useSpaces();
  const [waitOpen, setWaitOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const members = activeSpace?.members ?? [];

  // FA-08: hide the move entry when there is nowhere to move the todo to.
  const hasTargets = spaces.some((s) => s.id !== todo.spaceId);

  const item = "rounded-lg px-3 py-2 text-left text-sm hover:bg-row-hover";

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className={item}
        style={{ minHeight: 44 }}
        onClick={() => {
          onEdit();
          onClose();
        }}
      >
        Bearbeiten
      </button>

      <button
        type="button"
        className={`flex items-center justify-between ${item}`}
        style={{ minHeight: 44 }}
        onClick={() => setWaitOpen((o) => !o)}
      >
        Wartet auf … <span className="text-text-dim">{waitOpen ? "⌄" : "›"}</span>
      </button>
      {waitOpen && (
        <div className="flex flex-col border-l border-border pl-2">
          <button
            type="button"
            className={`flex items-center justify-between ${item}`}
            style={{ minHeight: 44 }}
            onClick={async () => {
              await setWaitingOn(todo.id, null);
              onClose();
            }}
          >
            Niemand {todo.waitingOn === null && <span className="text-accent">✓</span>}
          </button>
          {members.map((uid) => (
            <button
              key={uid}
              type="button"
              className={`flex items-center justify-between ${item}`}
              style={{ minHeight: 44 }}
              onClick={async () => {
                await setWaitingOn(todo.id, uid);
                onClose();
              }}
            >
              {nameOf(uid)} {todo.waitingOn === uid && <span className="text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}

      {hasTargets && (
        <>
          <button
            type="button"
            className={`flex items-center justify-between ${item}`}
            style={{ minHeight: 44 }}
            onClick={() => setMoveOpen((o) => !o)}
          >
            Verschieben … <span className="text-text-dim">{moveOpen ? "⌄" : "›"}</span>
          </button>
          {moveOpen && (
            <div className="border-l border-border pl-2">
              <MoveToSpaceMenu todo={todo} nameOf={nameOf} onDone={onClose} />
            </div>
          )}
        </>
      )}

      <button
        type="button"
        className={item}
        style={{ minHeight: 44, color: "var(--danger)" }}
        onClick={async () => {
          await remove(todo.id);
          onClose();
        }}
      >
        Löschen
      </button>
    </div>
  );
}
