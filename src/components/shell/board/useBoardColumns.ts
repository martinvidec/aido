"use client";

import { useMemo } from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useAuth } from "@/lib/hooks/useAuth";
import { useSpaceMemberNames } from "@/lib/hooks/useMemberProfiles";
import { buildColumns, type BoardColumn, type GroupBy } from "./columns";

export interface BoardColumnsState {
  columns: BoardColumn[];
  loading: boolean;
  accent: string;
  nameOf: (uid: string) => string;
}

/**
 * Shared Board state for the desktop and mobile boards (issue #82): builds the
 * grouped columns and exposes the accent + name resolver they both need. The two
 * boards previously carried an identical hooks block + `buildColumns` useMemo and
 * differ only in chrome (desktop drag & drop grid vs. mobile stacked sections +
 * "Verschieben" sheet).
 */
export function useBoardColumns(groupBy: GroupBy): BoardColumnsState {
  const { todos, loading, setWaitingOn, setStatus } = useTodos();
  const { activeSpace, accent } = useSpaces();
  const { user } = useAuth();
  const nameOf = useSpaceMemberNames();

  const columns = useMemo(
    () =>
      buildColumns({
        groupBy,
        todos,
        members: activeSpace?.members ?? [],
        currentUid: user?.uid,
        nameOf,
        setWaitingOn,
        setStatus,
      }),
    [groupBy, todos, activeSpace, user, nameOf, setWaitingOn, setStatus]
  );

  return { columns, loading, accent, nameOf };
}
