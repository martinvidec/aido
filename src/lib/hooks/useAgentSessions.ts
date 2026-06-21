"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { subscribeAgentSessionsForSpace } from "@/lib/firebase/firebaseUtils";
import type { AgentSession } from "@/lib/types";

// Live list of the current user's Agent-Sessions for a space (epic #212, #217).
// Used by the attach picker (#218) and the settings panel (#219).
export function useAgentSessions(spaceId: string | null): {
  sessions: AgentSession[];
  loading: boolean;
} {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !spaceId) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeAgentSessionsForSpace(
      user.uid,
      spaceId,
      (s) => {
        setSessions(s);
        setLoading(false);
      },
      (e) => {
        console.error("agent sessions subscription failed", e);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user, spaceId]);

  return { sessions, loading };
}
