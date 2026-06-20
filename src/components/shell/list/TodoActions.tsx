"use client";

import React, { useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { spaceColorFromHue } from "@/lib/theme/colors";
import type { Todo } from "@/lib/types";

/**
 * "…" menu actions for a todo (issue #45): Bearbeiten · Wartet auf … (members +
 * Niemand) · Verschieben → (other spaces, issue #201) · Löschen. Used inside the
 * desktop popover and the mobile sheet.
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
  const { setWaitingOn, moveTodo, remove } = useTodos();
  const { activeSpace, spaces } = useSpaces();
  const [waitOpen, setWaitOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // spaceId whose waitingOn-loss warning is currently expanded (null = none).
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const members = activeSpace?.members ?? [];

  // Every space except the one the todo lives in (FA-08: hide the entry when
  // there is nowhere to move it to).
  const targets = spaces.filter((s) => s.id !== todo.spaceId);

  const item = "rounded-lg px-3 py-2 text-left text-sm hover:bg-row-hover";

  const doMove = async (targetId: string) => {
    // moveTodo shows its own toast (success or error). Close only on success so
    // a failed move keeps the menu open for another try.
    if (await moveTodo(todo.id, targetId)) onClose();
  };

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

      {targets.length > 0 && (
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
            <div className="flex flex-col border-l border-border pl-2">
              {targets.map((target) => {
                const creatorHasAccess = target.members.includes(todo.createdBy);
                const losesWaiting =
                  !!todo.waitingOn && !target.members.includes(todo.waitingOn);
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
                      <span className="px-3 pb-1 text-xs text-text-dim">
                        Ersteller hat keinen Zugriff
                      </span>
                    )}
                    {confirming && (
                      <div className="mx-3 mb-2 rounded-lg border border-border p-2 text-xs">
                        <p className="text-text-dim">
                          „Wartet auf {nameOf(todo.waitingOn as string)}“ geht beim Verschieben
                          verloren.
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
