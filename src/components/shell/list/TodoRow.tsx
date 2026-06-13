"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { spaceColorFromHue } from "@/lib/theme/colors";
import TodoTitle from "./TodoTitle";
import TodoBody from "./TodoBody";
import TodoEditor from "./TodoEditor";
import TodoActions from "./TodoActions";
import type { Todo } from "@/lib/types";

/** Counts task-list checkboxes in a Tiptap body → { done, total }. */
function checklistProgress(body: unknown): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "taskItem") {
      total++;
      if (n.attrs?.checked) done++;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(body);
  return { done, total };
}

interface TodoRowProps {
  todo: Todo;
  nameOf: (uid: string) => string;
  variant?: "desktop" | "mobile";
  /** Mobile: open the actions sheet for this todo (desktop uses an inline popover). */
  onOpenActions?: (todo: Todo) => void;
}

export default function TodoRow({ todo, nameOf, variant = "desktop", onOpenActions }: TodoRowProps) {
  const { setCompleted, editContent } = useTodos();
  const { activeSpace } = useSpaces();
  const accent = activeSpace ? spaceColorFromHue(activeSpace.color) : "var(--accent)";

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasBody = !!todo.body && Array.isArray((todo.body as any).content) && (todo.body as any).content.length > 0;
  const progress = hasBody ? checklistProgress(todo.body) : { done: 0, total: 0 };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (editing) {
    return (
      <TodoEditor
        accentColor={accent}
        submitLabel="Speichern"
        initialTitle={todo.title}
        initialBody={todo.body}
        onCancel={() => setEditing(false)}
        onSave={async (title, body) => {
          await editContent(todo.id, title, body);
          setEditing(false);
        }}
      />
    );
  }

  const container =
    variant === "mobile"
      ? "rounded-2xl bg-bg-card px-3 py-3"
      : "rounded-xl px-2 py-2 hover:bg-row-hover";

  return (
    <div
      className={`relative flex flex-col gap-2 ${container}`}
      style={variant === "mobile" ? { border: "1px solid var(--border)" } : undefined}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-label={todo.completed ? "Wieder öffnen" : "Erledigen"}
          onClick={() => setCompleted(todo.id, !todo.completed)}
          className="mt-0.5 flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: 22,
            height: 22,
            border: `2px solid ${todo.completed ? accent : "var(--check-border)"}`,
            background: todo.completed ? accent : "transparent",
          }}
        >
          {todo.completed && <span className="text-white" style={{ fontSize: 12 }}>✓</span>}
        </button>

        <div
          className={`min-w-0 flex-1 ${hasBody ? "cursor-pointer" : ""}`}
          onClick={() => hasBody && setExpanded((e) => !e)}
        >
          <TodoTitle title={todo.title} completed={todo.completed} />
          {(todo.waitingOn || progress.total > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {todo.waitingOn && (
                <span
                  className="rounded-md px-2 py-0.5 text-xs font-semibold"
                  style={{ background: "var(--wait-bg)", color: "var(--wait-text)" }}
                >
                  wartet auf {nameOf(todo.waitingOn)}
                </span>
              )}
              {progress.total > 0 && (
                <span className="font-mono text-xs text-text-dim">
                  {progress.done}/{progress.total}
                </span>
              )}
            </div>
          )}
        </div>

        {hasBody && (
          <button
            type="button"
            aria-label="Details"
            onClick={() => setExpanded((e) => !e)}
            className="shrink-0 text-text-dim"
          >
            <span
              style={{
                display: "inline-block",
                transform: expanded ? "rotate(180deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              ⌄
            </span>
          </button>
        )}

        {variant === "mobile" ? (
          <button
            type="button"
            aria-label="Aktionen"
            onClick={() => onOpenActions?.(todo)}
            className="shrink-0 text-text-dim"
          >
            …
          </button>
        ) : (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              aria-label="Aktionen"
              onClick={() => setMenuOpen((o) => !o)}
              className="text-text-dim"
            >
              …
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-border bg-bg-pop p-1 shadow-soft">
                <TodoActions
                  todo={todo}
                  nameOf={nameOf}
                  onEdit={() => setEditing(true)}
                  onClose={() => setMenuOpen(false)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && hasBody && (
        <div className="pl-[34px]">
          <TodoBody body={todo.body} onChange={(next) => editContent(todo.id, todo.title, next)} />
        </div>
      )}
    </div>
  );
}
