"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useToast } from "@/lib/contexts/ToastContext";
import {
  getSpacesForUser,
  subscribeSpacesForUser,
  getOpenTodoCount,
  createSpace as createSpaceDoc,
  addSpaceMember,
  removeSpaceMember,
} from "@/lib/firebase/firebaseUtils";
import type { Space } from "@/lib/types";

export type SpaceView = "liste" | "board";

interface SpacesContextType {
  spaces: Space[];
  loading: boolean;
  activeSpaceId: string | null;
  activeSpace: Space | null;
  /** Open-todo counts per spaceId (best-effort; absent until loaded). */
  openCounts: Record<string, number>;
  view: SpaceView;
  setActiveSpace: (id: string) => void;
  setView: (view: SpaceView) => void;
  refreshSpaces: () => Promise<void>;
  /** Create a space (creator = first member, cyclic palette color) and select it. */
  createSpace: (name: string) => Promise<string | null>;
  addMember: (spaceId: string, uid: string) => Promise<void>;
  removeMember: (spaceId: string, uid: string) => Promise<void>;
  /** Update one space's open-todo badge locally (e.g. after add/complete). */
  setOpenCount: (spaceId: string, count: number) => void;
}

const SpacesContext = createContext<SpacesContextType | undefined>(undefined);

/**
 * Holds the redesign's top-level workspace state (issue #42): the user's spaces,
 * the active space, and the list/board view. Feature contexts (Heute/Liste/Board)
 * key their own filters/drafts off `activeSpaceId`, which resets them on switch.
 */
export const SpacesProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { showError } = useToast();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const [view, setView] = useState<SpaceView>("liste");

  const applyLoaded = useCallback((loaded: Space[]) => {
    setSpaces(loaded);
    // Keep the current selection if it still exists, else default to the first.
    setActiveSpaceId((prev) =>
      prev && loaded.some((s) => s.id === prev) ? prev : loaded[0]?.id ?? null
    );
    setLoading(false);
  }, []);

  // Manual one-shot reload, kept as a fallback. Live updates flow through the
  // onSnapshot subscription below (issue #72), so mutations no longer call this.
  const refreshSpaces = useCallback(async () => {
    if (!user) {
      setSpaces([]);
      setActiveSpaceId(null);
      setOpenCounts({});
      setLoading(false);
      return;
    }
    applyLoaded(await getSpacesForUser(user.uid));
  }, [user, applyLoaded]);

  // Live subscription to the user's spaces (issue #72): a space created, renamed
  // or shared by a collaborator now appears without a manual reload.
  useEffect(() => {
    if (!user) {
      setSpaces([]);
      setActiveSpaceId(null);
      setOpenCounts({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeSpacesForUser(user.uid, applyLoaded, (e) => {
      console.error("spaces subscription failed", e);
      showError("Spaces konnten nicht geladen werden.");
      setLoading(false);
    });
    return unsubscribe;
  }, [user, applyLoaded, showError]);

  // Open-todo counts per space (sidebar badges). Best-effort, recomputed when
  // the set of spaces changes; the active space's count is also kept live by
  // TodosContext via setOpenCount. A failure must not break the shell.
  const spaceIdsKey = spaces.map((s) => s.id).join(",");
  useEffect(() => {
    if (!spaceIdsKey) return;
    let cancelled = false;
    (async () => {
      const ids = spaceIdsKey.split(",");
      const counts: Record<string, number> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            counts[id] = await getOpenTodoCount(id);
          } catch {
            /* ignore per-space count errors */
          }
        })
      );
      if (!cancelled) setOpenCounts((prev) => ({ ...prev, ...counts }));
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceIdsKey]);

  const createSpace = useCallback(
    async (name: string): Promise<string | null> => {
      if (!user || !name.trim()) return null;
      try {
        const id = await createSpaceDoc(user.uid, name, spaces.length);
        // The new space arrives via the live subscription; select it now.
        setActiveSpaceId(id);
        return id;
      } catch (e) {
        console.error("createSpace failed", e);
        showError("Space konnte nicht erstellt werden.");
        return null;
      }
    },
    [user, spaces.length, showError]
  );

  const addMember = useCallback(
    async (spaceId: string, uid: string) => {
      try {
        await addSpaceMember(spaceId, uid);
      } catch (e) {
        console.error("addMember failed", e);
        showError("Mitglied konnte nicht hinzugefügt werden.");
      }
    },
    [showError]
  );

  const removeMember = useCallback(
    async (spaceId: string, uid: string) => {
      try {
        await removeSpaceMember(spaceId, uid);
      } catch (e) {
        console.error("removeMember failed", e);
        showError("Mitglied konnte nicht entfernt werden.");
      }
    },
    [showError]
  );

  const setOpenCount = useCallback((spaceId: string, count: number) => {
    setOpenCounts((prev) => ({ ...prev, [spaceId]: count }));
  }, []);

  const activeSpace = spaces.find((s) => s.id === activeSpaceId) ?? null;

  const value: SpacesContextType = {
    spaces,
    loading,
    activeSpaceId,
    activeSpace,
    openCounts,
    view,
    setActiveSpace: setActiveSpaceId,
    setView,
    refreshSpaces,
    createSpace,
    addMember,
    removeMember,
    setOpenCount,
  };

  return <SpacesContext.Provider value={value}>{children}</SpacesContext.Provider>;
};

export const useSpaces = (): SpacesContextType => {
  const context = useContext(SpacesContext);
  if (context === undefined) {
    throw new Error("useSpaces must be used within a SpacesProvider");
  }
  return context;
};
