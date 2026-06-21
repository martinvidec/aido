"use client";

import React from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useAgentSessions } from "@/lib/hooks/useAgentSessions";
import type { Todo } from "@/lib/types";

/**
 * Picker that binds a todo to one of the user's Agent-Sessions registered for
 * the active space (epic #212, issue #218). Shared by the list actions and the
 * board card sheet. Offers "Lösen" when the todo is already attached.
 */
export default function AttachToSessionMenu({ todo, onDone }: { todo: Todo; onDone: () => void }) {
  const { attachToSession, detachSession } = useTodos();
  const { activeSpaceId } = useSpaces();
  const { sessions, loading } = useAgentSessions(activeSpaceId);
  const item = "rounded-lg px-3 py-2 text-left text-sm hover:bg-row-hover";

  const attach = async (sessionId: string) => {
    await attachToSession(todo.id, sessionId);
    onDone();
  };
  const detach = async () => {
    await detachSession(todo.id);
    onDone();
  };

  if (loading) {
    return <p className="px-3 py-2 text-sm text-text-dim">Lädt …</p>;
  }
  if (sessions.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-text-dim">
        Keine Agent-Session in diesem Space registriert.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {sessions.map((s) => {
        const attached = todo.attachedSession === s.id;
        const title = s.label || `${s.hostname} · ${s.workingFolder}`;
        return (
          <button
            key={s.id}
            type="button"
            className={`flex items-center justify-between gap-2 ${item}`}
            style={{ minHeight: 44 }}
            onClick={() => attach(s.id)}
          >
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {attached && <span className="text-accent">✓</span>}
          </button>
        );
      })}
      {todo.attachedSession && (
        <button
          type="button"
          className={item}
          style={{ minHeight: 44, color: "var(--danger)" }}
          onClick={detach}
        >
          Lösen
        </button>
      )}
    </div>
  );
}
