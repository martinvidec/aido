"use client";

import React, { useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { spaceColorFromHue } from "@/lib/theme/colors";
import type { Todo } from "@/lib/types";

/**
 * Target-space picker for moving a todo (issue #201/#202). Shared by the list
 * actions (TodoActions) and the board card sheets so the rules — hide when there
 * is no other space, disable a target the todo's creator can't access (FA-06),
 * and confirm before dropping a waitingOn the target doesn't have (FA-07) — live
 * in one place. Calls TodosContext.moveTodo (which also wires the undo toast) and
 * onDone() on a successful move.
 */
export default function MoveToSpaceMenu({
  todo,
  nameOf,
  onDone,
}: {
  todo: Todo;
  nameOf: (uid: string) => string;
  onDone: () => void;
}) {
  const { moveTodo } = useTodos();
  const { spaces } = useSpaces();
  // spaceId whose waitingOn-loss warning is currently expanded (null = none).
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  const targets = spaces.filter((s) => s.id !== todo.spaceId);
  const item = "rounded-lg px-3 py-2 text-left text-sm hover:bg-row-hover";

  const doMove = async (targetId: string) => {
    // moveTodo shows its own toast (success or error). Close only on success so
    // a failed move keeps the menu open for another try.
    if (await moveTodo(todo.id, targetId)) onDone();
  };

  if (targets.length === 0) {
    return <p className="px-3 py-2 text-sm text-text-dim">Kein anderer Space vorhanden.</p>;
  }

  return (
    <div className="flex flex-col">
      {targets.map((target) => {
        const creatorHasAccess = target.members.includes(todo.createdBy);
        const losesWaiting = !!todo.waitingOn && !target.members.includes(todo.waitingOn);
        const confirming = confirmTarget === target.id;

        return (
          <div key={target.id} className="flex flex-col">
            <button
              type="button"
              disabled={!creatorHasAccess}
              className={`flex items-center gap-2 ${item} ${
                creatorHasAccess ? "" : "cursor-not-allowed opacity-50 hover:bg-transparent"
              }`}
              style={{ minHeight: 44 }}
              onClick={() => {
                if (!creatorHasAccess) return;
                if (losesWaiting) {
                  setConfirmTarget(target.id);
                  return;
                }
                doMove(target.id);
              }}
            >
              <span
                aria-hidden
                className="shrink-0"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 3,
                  background: spaceColorFromHue(target.color),
                }}
              />
              <span className="min-w-0 flex-1 truncate">{target.name}</span>
            </button>
            {!creatorHasAccess && (
              <span className="px-3 pb-1 text-xs text-text-dim">Ersteller hat keinen Zugriff</span>
            )}
            {confirming && (
              <div className="mx-3 mb-2 rounded-lg border border-border p-2 text-xs">
                <p className="text-text-dim">
                  „Wartet auf {nameOf(todo.waitingOn as string)}“ geht beim Verschieben verloren.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 font-semibold text-white"
                    style={{ background: "var(--accent)", minHeight: 36 }}
                    onClick={() => doMove(target.id)}
                  >
                    Verschieben
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 hover:bg-row-hover"
                    style={{ minHeight: 36 }}
                    onClick={() => setConfirmTarget(null)}
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
