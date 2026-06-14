"use client";

import React from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useDaily } from "@/lib/contexts/DailyContext";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useToast } from "@/lib/contexts/ToastContext";
import Avatar from "../Avatar";
import { useMemberResolver, type MemberResolver } from "./useMemberResolver";
import type { Daily } from "@/lib/types";

/** Direction meta-label: "du → Michi" / "Michi → dich" / "von Michi". */
function directionLabel(daily: Daily, currentUid: string | undefined, r: MemberResolver): string {
  const mentioned = r.matchMention(daily.text);
  if (daily.author === currentUid) {
    return mentioned ? `du → ${r.firstName(mentioned)}` : "du";
  }
  if (mentioned && mentioned === currentUid) return `${r.firstName(daily.author)} → dich`;
  return `von ${r.firstName(daily.author)}`;
}

function StaleItem({ daily, onPromote, onDismiss }: {
  daily: Daily;
  onPromote: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="rounded-md px-2 py-0.5 text-xs font-semibold"
        style={{ background: "var(--wait-bg)", color: "var(--wait-text)" }}
      >
        liegengeblieben
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{daily.text}</span>
      <button type="button" onClick={onPromote} className="shrink-0 text-xs text-accent-text hover:underline">
        → in die Liste
      </button>
      <button type="button" onClick={onDismiss} aria-label="Verwerfen" className="shrink-0 text-text-dim">
        ✕
      </button>
    </div>
  );
}

function Bubble({ daily, currentUid, resolver, onToggle, onDelete }: {
  daily: Daily;
  currentUid: string | undefined;
  resolver: MemberResolver;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const own = daily.author === currentUid;
  const label = directionLabel(daily, currentUid, resolver);

  return (
    <div className={`flex flex-col ${own ? "items-end" : "items-start"}`}>
      <span className="px-1 pb-0.5 text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
        {label}
      </span>
      <div className={`flex max-w-[85%] items-start gap-2 ${own ? "flex-row-reverse" : ""}`}>
        {!own && <Avatar uid={daily.author} name={resolver.nameOf(daily.author)} size={26} />}
        <div
          className="flex items-start gap-2 bg-bg-card px-3 py-2"
          style={{
            borderRadius: own ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
          }}
        >
          <button
            type="button"
            aria-label="Erledigt"
            onClick={onToggle}
            className="mt-0.5 shrink-0 rounded-full"
            style={{ width: 19, height: 19, border: "2px solid var(--check-border)" }}
          />
          <span className="text-sm font-bold">{daily.text}</span>
          <button type="button" aria-label="Löschen" onClick={onDelete} className="shrink-0 text-text-dim">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

/** Liegengebliebene + today's chat bubbles (issue #44). Shared by desktop/mobile. */
export default function HeuteList() {
  const { user } = useAuth();
  const { today, stale, setCompleted, remove } = useDaily();
  const { createTodo } = useTodos();
  const { showToast } = useToast();
  const resolver = useMemberResolver();

  const promote = async (d: Daily) => {
    // Only remove the daily once the todo actually exists — otherwise a failed
    // createTodo would still delete the daily and lose it (#68). createTodo
    // shows its own error toast on failure.
    if (!(await createTodo({ title: d.text }))) return;
    await remove(d.id);
    showToast("In die Liste übernommen.");
  };

  if (today.length === 0 && stale.length === 0) {
    return <p className="text-sm text-text-dim">Noch nichts für heute.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {stale.map((d) => (
        <StaleItem key={d.id} daily={d} onPromote={() => promote(d)} onDismiss={() => remove(d.id)} />
      ))}
      {today.map((d) => (
        <Bubble
          key={d.id}
          daily={d}
          currentUid={user?.uid}
          resolver={resolver}
          onToggle={() => setCompleted(d.id, true)}
          onDelete={() => remove(d.id)}
        />
      ))}
    </div>
  );
}
