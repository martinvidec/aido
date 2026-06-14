"use client";

import React, { useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { spaceColorFromHue } from "@/lib/theme/colors";
import TodoEditor from "./TodoEditor";

/**
 * Todo composer (issue #45): collapsed quick-add row (border in the space color)
 * that expands into the full TipTap editor via "⌵ Mehr".
 */
export default function TodoComposer() {
  const { createTodo } = useTodos();
  const { activeSpace } = useSpaces();
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState("");
  const accent = activeSpace ? spaceColorFromHue(activeSpace.color) : "var(--accent)";

  const quickAdd = async () => {
    const value = quick.trim();
    if (!value) return;
    // Clear only after a successful write so the text isn't lost on failure (#68).
    if (await createTodo({ title: value })) setQuick("");
  };

  if (open) {
    return (
      <TodoEditor
        accentColor={accent}
        submitLabel="Hinzufügen"
        onCancel={() => setOpen(false)}
        onSave={async (title, body) => {
          // Keep the editor open (draft intact) if the write fails (#68).
          if (await createTodo({ title, body })) setOpen(false);
        }}
      />
    );
  }

  return (
    <div
      className="flex items-center gap-2 rounded-2xl bg-bg-card px-3 py-2"
      style={{ border: `1.5px solid ${accent}` }}
    >
      <span className="text-lg font-bold" style={{ color: accent }}>
        +
      </span>
      <input
        value={quick}
        onChange={(e) => setQuick(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") quickAdd();
        }}
        placeholder="Strukturiertes Todo anlegen … @ Personen, # Tags"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-dim"
      />
      <button type="button" onClick={() => setOpen(true)} className="shrink-0 text-sm text-text-dim">
        ⌵ Mehr
      </button>
      <button
        type="button"
        onClick={quickAdd}
        className="shrink-0 rounded-full px-4 py-1.5 text-sm font-extrabold text-white"
        style={{ background: accent }}
      >
        Hinzufügen
      </button>
    </div>
  );
}
