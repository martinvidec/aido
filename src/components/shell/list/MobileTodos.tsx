"use client";

import React, { useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaceMemberNames } from "@/lib/hooks/useMemberProfiles";
import TagFilterBar from "./TagFilterBar";
import TodoComposer from "./TodoComposer";
import TodoRow from "./TodoRow";
import TodoActions from "./TodoActions";
import TodoEditor from "./TodoEditor";
import BottomSheet from "../BottomSheet";
import type { Todo } from "@/lib/types";

/**
 * Mobile Todos tab (issue #45): tag filter + composer + card rows; the "…" menu
 * and edit form open as bottom sheets (the sheet covers the mobile shell root).
 */
export default function MobileTodos() {
  const { filtered, loading, editContent } = useTodos();
  const nameOf = useSpaceMemberNames();
  const [showDone, setShowDone] = useState(false);
  const [actionsFor, setActionsFor] = useState<Todo | null>(null);
  const [editFor, setEditFor] = useState<Todo | null>(null);

  const open = filtered.filter((t) => !t.completed);
  const done = filtered.filter((t) => t.completed);

  return (
    <div className="flex flex-col gap-3">
      <TagFilterBar />
      <TodoComposer />

      {loading ? (
        <p className="py-2 text-sm text-text-dim">Lädt …</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {open.map((t) => (
              <TodoRow key={t.id} todo={t} nameOf={nameOf} variant="mobile" onOpenActions={setActionsFor} />
            ))}
            {open.length === 0 && <p className="py-2 text-sm text-text-dim">Keine offenen Todos.</p>}
          </div>

          {done.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowDone((s) => !s)}
                className="self-start text-sm font-semibold text-text-dim"
              >
                Erledigt ({done.length}) {showDone ? "▲" : "▼"}
              </button>
              {showDone &&
                done.map((t) => (
                  <div key={t.id} style={{ opacity: 0.55 }}>
                    <TodoRow todo={t} nameOf={nameOf} variant="mobile" onOpenActions={setActionsFor} />
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      <BottomSheet open={!!actionsFor} onClose={() => setActionsFor(null)}>
        {actionsFor && (
          <TodoActions
            todo={actionsFor}
            nameOf={nameOf}
            onEdit={() => setEditFor(actionsFor)}
            onClose={() => setActionsFor(null)}
          />
        )}
      </BottomSheet>

      <BottomSheet open={!!editFor} onClose={() => setEditFor(null)}>
        {editFor && (
          <TodoEditor
            initialTitle={editFor.title}
            initialBody={editFor.body}
            submitLabel="Speichern"
            onCancel={() => setEditFor(null)}
            onSave={async (title, body) => {
              // Keep the editor open (edit intact) if the save fails (#68).
              if (await editContent(editFor.id, title, body)) setEditFor(null);
            }}
          />
        )}
      </BottomSheet>
    </div>
  );
}
