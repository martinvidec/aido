import type { Todo } from "@/lib/types";

export type GroupBy = "person" | "status";

export interface BoardColumn {
  id: string;
  label: string;
  /** Member uid for the "bei X" avatar (person view). */
  badgeUid?: string;
  todos: Todo[];
  /** Drop / move action for this column; undefined → not a drop target. */
  apply?: (todoId: string) => Promise<void>;
}

interface BuildArgs {
  groupBy: GroupBy;
  todos: Todo[];
  members: string[];
  currentUid: string | undefined;
  nameOf: (uid: string) => string;
  setWaitingOn: (id: string, waitingOn: string | null) => Promise<void>;
  setStatus: (id: string, status: { completed: boolean; waitingOn: string | null }) => Promise<void>;
}

/**
 * Builds the board columns for the active grouping (issue #46).
 * - Person: OFFEN (no waitingOn, or waitingOn pointing at a non-member) + one
 *   "bei X" column per member; dropping sets waitingOn. Folding unknown
 *   waitingOn into OFFEN keeps such todos visible/assignable (issue #67).
 * - Status: Offen / Wartet / Erledigt; dropping sets completed/waitingOn (Wartet
 *   needs a person, so it is display-only — move via the person view).
 */
export function buildColumns({
  groupBy,
  todos,
  members,
  currentUid,
  nameOf,
  setWaitingOn,
  setStatus,
}: BuildArgs): BoardColumn[] {
  if (groupBy === "person") {
    const open = todos.filter((t) => !t.completed);
    const memberSet = new Set(members);
    const columns: BoardColumn[] = [
      {
        id: "open",
        label: "Offen",
        // No waitingOn, OR waitingOn pointing at someone who is no longer a
        // member: such todos have no "bei X" column, so they must surface here
        // rather than vanishing from the board (issue #67).
        todos: open.filter((t) => !t.waitingOn || !memberSet.has(t.waitingOn)),
        apply: (id) => setWaitingOn(id, null),
      },
    ];
    for (const uid of members) {
      columns.push({
        id: `member:${uid}`,
        label: uid === currentUid ? "bei dir" : `bei ${nameOf(uid)}`,
        badgeUid: uid,
        todos: open.filter((t) => t.waitingOn === uid),
        apply: (id) => setWaitingOn(id, uid),
      });
    }
    return columns;
  }

  // Status grouping. Each drop is a single atomic write of completed + waitingOn
  // (issue #79): "Offen" clears both flags, "Erledigt" also clears waitingOn so a
  // done card stops showing "bei X" and doesn't reappear in a person column when
  // reopened. One updateDoc → no visible half-applied state, no double load.
  return [
    {
      id: "offen",
      label: "Offen",
      todos: todos.filter((t) => !t.completed && !t.waitingOn),
      apply: (id) => setStatus(id, { completed: false, waitingOn: null }),
    },
    {
      id: "wartet",
      label: "Wartet",
      todos: todos.filter((t) => !t.completed && !!t.waitingOn),
      // No apply: "Wartet" needs a specific person — use the person view to assign.
    },
    {
      id: "erledigt",
      label: "Erledigt",
      todos: todos.filter((t) => t.completed),
      apply: (id) => setStatus(id, { completed: true, waitingOn: null }),
    },
  ];
}
