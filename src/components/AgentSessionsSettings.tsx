"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/firebase";
import { useAuth } from "@/lib/hooks/useAuth";
import {
  subscribeAllAgentSessions,
  renameAgentSession,
  deleteAgentSession,
  setAgentSessionConfig,
  setUserAgentDefaults,
} from "@/lib/firebase/firebaseUtils";
import type { AgentSession, AgentToolName } from "@/lib/types";

// Manage Claude-Code "Agent-Sessions" (epic #212, issue #219). Deliberately
// separate from SessionSettings (device-/login sessions): here the user renames,
// removes, and configures the per-session tool allowlist + lease, plus the
// default lease for new sessions. The MCP server writes these docs via the Admin
// SDK; the owner edits them here (firestore.rules allows owner read/write).

const TOOLS: { key: AgentToolName; label: string }[] = [
  { key: "update-todo", label: "Antworten" },
  { key: "handoff", label: "Zurückgeben" },
  { key: "complete-todo", label: "Abschließen" },
];

function formatLastSeen(ts: AgentSession["lastSeenAt"]): string {
  const d = ts && typeof (ts as { toDate?: () => Date }).toDate === "function" ? (ts as { toDate: () => Date }).toDate() : null;
  return d ? d.toLocaleString() : "—";
}

export default function AgentSessionsSettings() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaseDefault, setLeaseDefault] = useState(600);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeAllAgentSessions(
      user.uid,
      (s) => {
        setSessions([...s].sort((a, b) => a.spaceId.localeCompare(b.spaceId)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    getDoc(doc(db, "users", user.uid))
      .then((d) => {
        const v = d.data()?.agentSessionDefaults?.leaseTtlSeconds;
        if (typeof v === "number" && v > 0) setLeaseDefault(v);
      })
      .catch(() => {});
    return () => unsub();
  }, [user]);

  if (!user) return null;

  const toggleTool = (s: AgentSession, tool: AgentToolName) => {
    const next = s.allowedTools.includes(tool)
      ? s.allowedTools.filter((t) => t !== tool)
      : [...s.allowedTools, tool];
    setAgentSessionConfig(user.uid, s.id, { allowedTools: next });
  };

  const numInput = "w-24 rounded border border-border bg-transparent px-2 py-1 text-text";

  return (
    <div className="bg-bg-card p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-2 text-text">Agent-Sessions</h2>
      <p className="text-sm text-text-dim mb-4">
        Laufende Claude-Code-Sessions, an die du Todos anhängen kannst (nicht mit den Geräte-Sitzungen
        oben zu verwechseln). Erlaubte Aktionen und die Lease-Dauer steuerst du hier.
      </p>

      <label className="mb-5 flex items-center gap-2 text-sm text-text-dim">
        Standard-Lease für neue Sessions (Sek.)
        <input
          type="number"
          min={30}
          value={leaseDefault}
          onChange={(e) => setLeaseDefault(parseInt(e.target.value || "0", 10))}
          onBlur={() => {
            if (leaseDefault > 0) setUserAgentDefaults(user.uid, { leaseTtlSeconds: leaseDefault });
          }}
          className={numInput}
        />
      </label>

      {loading ? (
        <p className="text-sm text-text-dim">Lädt …</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-text-dim">
          Noch keine Agent-Session registriert. Eine Claude-Code-Session meldet sich über
          <span className="font-mono"> register-session</span> an.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <input
                    defaultValue={s.label ?? ""}
                    placeholder={s.hostname}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (s.label ?? "")) renameAgentSession(user.uid, s.id, v);
                    }}
                    className="w-full bg-transparent text-sm font-semibold text-text outline-none"
                  />
                  <p className="truncate text-xs text-text-dim">
                    {s.hostname} · {s.workingFolder}
                  </p>
                  <p className="text-xs text-text-dim">zuletzt aktiv {formatLastSeen(s.lastSeenAt)}</p>
                </div>
                {confirmId === s.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        deleteAgentSession(user.uid, s.id);
                        setConfirmId(null);
                      }}
                      className="font-semibold text-danger"
                    >
                      Wirklich?
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} className="text-text-dim">
                      ✕
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(s.id)}
                    className="shrink-0 text-xs font-semibold text-danger"
                  >
                    Entfernen
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                {TOOLS.map((t) => (
                  <label key={t.key} className="flex items-center gap-1 text-xs text-text-dim">
                    <input
                      type="checkbox"
                      checked={s.allowedTools.includes(t.key)}
                      onChange={() => toggleTool(s, t.key)}
                    />
                    {t.label}
                  </label>
                ))}
                <label className="ml-auto flex items-center gap-2 text-xs text-text-dim">
                  Lease (Sek.)
                  <input
                    type="number"
                    min={30}
                    defaultValue={s.leaseTtlSeconds}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (v > 0 && v !== s.leaseTtlSeconds) {
                        setAgentSessionConfig(user.uid, s.id, { leaseTtlSeconds: v });
                      }
                    }}
                    className={numInput}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
