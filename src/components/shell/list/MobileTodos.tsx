"use client";

import React, { useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaceMemberNames } from "@/lib/hooks/useMemberProfiles";
import TagFilterBar from "./TagFilterBar";
import TodoComposer from "./TodoComposer";
import TodoSections from "./TodoSections";
import TodoActions from "./TodoActions";
import TodoEditor from "./TodoEditor";
import BottomSheet from "../BottomSheet";
import type { Todo } from "@/lib/types";

/**
 * Mobile Todos tab (issue #45): tag filter + composer + card rows; the "…" menu
 * and edit form open as bottom sheets (the sheet covers the mobile shell root).
 */
export default function MobileTodos() {
  const { editContent } = useTodos();
  const nameOf = useSpaceMemberNames();
  const [actionsFor, setActionsFor] = useState<Todo | null>(null);
  const [editFor, setEditFor] = useState<Todo | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <TagFilterBar />
      <TodoComposer />
      <TodoSections variant="mobile" onOpenActions={setActionsFor} />

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
