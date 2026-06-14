"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useToast } from "@/lib/contexts/ToastContext";
import {
  getOpenDailyForSpace,
  subscribeOpenDailyForSpace,
  createDaily,
  setDailyCompleted,
  deleteDaily,
  isStaleDaily,
  todayString,
} from "@/lib/firebase/firebaseUtils";
import type { Daily } from "@/lib/types";

interface DailyContextType {
  /** Today's open daily items (chat bubbles). */
  today: Daily[];
  /** Open daily items from before today ("liegengeblieben"). */
  stale: Daily[];
  loading: boolean;
  /** Returns true on success; on failure shows an error toast and returns false. */
  add: (text: string) => Promise<boolean>;
  /** Returns true on success; on failure shows an error toast and returns false. */
  setCompleted: (id: string, completed: boolean) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const DailyContext = createContext<DailyContextType | undefined>(undefined);

/**
 * Loads and mutates the active space's "Heute" items (issue #44). Daily items
 * are short-lived and deliberately separate from todos. Resets on space switch.
 */
export const DailyProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { activeSpaceId } = useSpaces();
  const { showError } = useToast();
  const [items, setItems] = useState<Daily[]>([]);
  const [loading, setLoading] = useState(true);

  // Manual one-shot reload, kept as a fallback. Live updates flow through the
  // onSnapshot subscription below (issue #72), so mutations no longer call this.
  const refresh = useCallback(async () => {
    if (!activeSpaceId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const loaded = await getOpenDailyForSpace(activeSpaceId);
    setItems(loaded);
    setLoading(false);
  }, [activeSpaceId]);

  // Live subscription to the active space's open daily items (issue #72).
  useEffect(() => {
    if (!activeSpaceId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeOpenDailyForSpace(
      activeSpaceId,
      (loaded) => {
        setItems(loaded);
        setLoading(false);
      },
      (e) => {
        console.error("daily subscription failed", e);
        showError("Heute-Einträge konnten nicht geladen werden.");
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [activeSpaceId, showError]);

  const todayStr = todayString();
  const today = useMemo(() => items.filter((d) => d.date === todayStr), [items, todayStr]);
  const stale = useMemo(() => items.filter((d) => isStaleDaily(d, todayStr)), [items, todayStr]);

  const add = useCallback(
    async (text: string): Promise<boolean> => {
      if (!activeSpaceId || !user || !text.trim()) return false;
      try {
        await createDaily(activeSpaceId, user.uid, text);
        return true;
      } catch (e) {
        console.error("daily add failed", e);
        showError("Konnte nicht gesendet werden.");
        return false;
      }
    },
    [activeSpaceId, user, showError]
  );

  const setCompleted = useCallback(
    async (id: string, completed: boolean): Promise<boolean> => {
      if (!activeSpaceId) return false;
      try {
        await setDailyCompleted(activeSpaceId, id, completed);
        return true;
      } catch (e) {
        console.error("daily setCompleted failed", e);
        showError("Status konnte nicht geändert werden.");
        return false;
      }
    },
    [activeSpaceId, showError]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!activeSpaceId) return;
      try {
        await deleteDaily(activeSpaceId, id);
      } catch (e) {
        console.error("daily remove failed", e);
        showError("Konnte nicht gelöscht werden.");
      }
    },
    [activeSpaceId, showError]
  );

  const value: DailyContextType = { today, stale, loading, add, setCompleted, remove, refresh };

  return <DailyContext.Provider value={value}>{children}</DailyContext.Provider>;
};

export const useDaily = (): DailyContextType => {
  const context = useContext(DailyContext);
  if (context === undefined) {
    throw new Error("useDaily must be used within a DailyProvider");
  }
  return context;
};
