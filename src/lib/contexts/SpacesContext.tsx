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
import {
  getSpacesForUser,
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
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const [view, setView] = useState<SpaceView>("liste");

  const refreshSpaces = useCallback(async () => {
    if (!user) {
      setSpaces([]);
      setActiveSpaceId(null);
      setOpenCounts({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const loaded = await getSpacesForUser(user.uid);
    setSpaces(loaded);
    // Keep the current selection if it still exists, else default to the first.
    setActiveSpaceId((prev) =>
      prev && loaded.some((s) => s.id === prev) ? prev : loaded[0]?.id ?? null
    );
    setLoading(false);

    // Open-todo counts are best-effort: a failure must not break the shell.
    const counts: Record<string, number> = {};
    await Promise.all(
      loaded.map(async (s) => {
        try {
          counts[s.id] = await getOpenTodoCount(s.id);
        } catch {
          /* ignore per-space count errors */
        }
      })
    );
    setOpenCounts(counts);
  }, [user]);

  useEffect(() => {
    refreshSpaces();
  }, [refreshSpaces]);

  const createSpace = useCallback(
    async (name: string): Promise<string | null> => {
      if (!user || !name.trim()) return null;
      const id = await createSpaceDoc(user.uid, name, spaces.length);
      await refreshSpaces();
      setActiveSpaceId(id);
      return id;
    },
    [user, spaces.length, refreshSpaces]
  );

  const addMember = useCallback(
    async (spaceId: string, uid: string) => {
      await addSpaceMember(spaceId, uid);
      await refreshSpaces();
    },
    [refreshSpaces]
  );

  const removeMember = useCallback(
    async (spaceId: string, uid: string) => {
      await removeSpaceMember(spaceId, uid);
      await refreshSpaces();
    },
    [refreshSpaces]
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
