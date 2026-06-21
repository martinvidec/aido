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
import { useMemberProfiles } from "@/lib/hooks/useMemberProfiles";
import {
  getTodosForSpace,
  subscribeTodosForSpace,
  createTodo as createTodoDoc,
  editTodoContent,
  setTodoCompleted,
  setTodoWaitingOn,
  setTodoStatus,
  deleteTodo,
  moveTodoToSpace,
  setTodoOrder,
  normalizeTodoOrders,
  attachTodoToSession,
  detachTodoSession,
} from "@/lib/firebase/firebaseUtils";
import { orderBetween } from "@/lib/utils/order";
import type { MentionMember } from "@/lib/utils/textUtils";
import type { Todo, TiptapContent } from "@/lib/types";

interface CreateTodoInput {
  title: string;
  body?: TiptapContent | null;
}

interface TodosContextType {
  todos: Todo[];
  loading: boolean;
  /** Unique tags across the active space's todos. */
  tags: string[];
  tagFilters: string[];
  toggleTag: (tag: string) => void;
  clearTags: () => void;
  /** Todos matching the active tag filter (AND), still split open/done by callers. */
  filtered: Todo[];
  refresh: () => Promise<void>;
  /** Returns true on success; on failure shows an error toast and returns false. */
  createTodo: (input: CreateTodoInput) => Promise<boolean>;
  /** Returns true on success; on failure shows an error toast and returns false. */
  editContent: (id: string, title: string, body: TiptapContent | null) => Promise<boolean>;
  setCompleted: (id: string, completed: boolean) => Promise<void>;
  setWaitingOn: (id: string, waitingOn: string | null) => Promise<void>;
  /** Atomic status transition (completed + waitingOn in one write); board drops. */
  setStatus: (id: string, status: { completed: boolean; waitingOn: string | null }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /**
   * Move a todo to another space (issue #200). Blocks with an error toast if the
   * todo's creator isn't a member of the target (the rules would reject it). On
   * success shows a confirmation toast and returns true. `waitingOn` is cleared
   * when the target doesn't have that member.
   */
  moveTodo: (id: string, targetSpaceId: string) => Promise<boolean>;
  /**
   * Manual reordering (issue #235, epic #234): move `movedId` to its new slot.
   * `visibleOrderedIds` is the already-reordered list of the *visible* todos
   * (it honours the active tag filter — only visible neighbours anchor the new
   * `order`). Persists a single midpoint write, or renumbers when the gap is too
   * tight or stored orders collide.
   */
  reorder: (movedId: string, visibleOrderedIds: string[]) => Promise<void>;
  /** Agent-Sessions (epic #212): bind a todo to a session ("bei aido"). */
  attachToSession: (id: string, sessionId: string) => Promise<void>;
  /** Remove a todo's session binding. */
  detachSession: (id: string) => Promise<void>;
}

const TodosContext = createContext<TodosContextType | undefined>(undefined);

/**
 * Loads and mutates the active space's todos (issue #45). Shared by the Liste
 * and Board views (#46). Tag filters reset when the active space changes.
 */
export const TodosProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { spaces, activeSpaceId, activeSpace, setOpenCount } = useSpaces();
  const { showToast, showError } = useToast();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilters, setTagFilters] = useState<string[]>([]);

  // Member profiles of the active space, used to resolve plain-text @mentions in
  // a todo title against members (issue #76) — symmetric with #tags, which are
  // already derived from the title.
  const memberProfiles = useMemberProfiles(activeSpace?.members ?? []);
  const mentionMembers = useMemo<MentionMember[]>(
    () =>
      (activeSpace?.members ?? []).map((uid) => ({
        uid,
        displayName: memberProfiles[uid]?.displayName ?? null,
      })),
    [activeSpace, memberProfiles]
  );

  // Manual one-shot reload, kept as a fallback. Live updates flow through the
  // onSnapshot subscription below (issue #72), so mutations no longer call this.
  const refresh = useCallback(async () => {
    if (!activeSpaceId) {
      setTodos([]);
      setLoading(false);
      return;
    }
    const loaded = await getTodosForSpace(activeSpaceId);
    setTodos(loaded);
    setLoading(false);
    setOpenCount(activeSpaceId, loaded.filter((t) => !t.completed).length);
  }, [activeSpaceId, setOpenCount]);

  // Live subscription to the active space's todos (issue #72): collaborators'
  // edits now appear in real time instead of needing a manual reload. Reset the
  // tag filter on space switch.
  useEffect(() => {
    setTagFilters([]);
    if (!activeSpaceId) {
      setTodos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeTodosForSpace(
      activeSpaceId,
      (loaded) => {
        setTodos(loaded);
        setLoading(false);
        setOpenCount(activeSpaceId, loaded.filter((t) => !t.completed).length);
      },
      (e) => {
        console.error("todos subscription failed", e);
        showError("Todos konnten nicht geladen werden.");
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [activeSpaceId, setOpenCount, showError]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const t of todos) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  }, [todos]);

  // Drop filters for tags that no longer exist on any todo (issue #74): deleting
  // or renaming the last todo carrying a filtered tag removes it from `tags`, so
  // a stale filter would otherwise keep the list empty with no way to recover
  // (TagFilterBar renders no chips when there are no tags). Pruning the state
  // keeps the chips honest and stops a vanished tag from silently re-activating
  // if it later reappears.
  useEffect(() => {
    setTagFilters((prev) => {
      const next = prev.filter((tag) => tags.includes(tag));
      return next.length === prev.length ? prev : next;
    });
  }, [tags]);

  const toggleTag = useCallback((tag: string) => {
    setTagFilters((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const clearTags = useCallback(() => setTagFilters([]), []);

  const filtered = useMemo(() => {
    // Only filter by tags that still exist, so the list never strands empty in
    // the brief window before the prune effect above runs (issue #74).
    const active = tagFilters.filter((tag) => tags.includes(tag));
    if (active.length === 0) return todos;
    // AND filter: a todo must carry every active tag.
    return todos.filter((t) => active.every((tag) => t.tags.includes(tag)));
  }, [todos, tagFilters, tags]);

  const createTodo = useCallback(
    async (input: CreateTodoInput): Promise<boolean> => {
      if (!activeSpaceId || !user) return false;
      try {
        const maxOrder = todos.reduce((m, t) => Math.max(m, t.order), 0);
        await createTodoDoc(activeSpaceId, user.uid, {
          title: input.title,
          body: input.body ?? null,
          order: maxOrder + 1,
          mentionMembers,
        });
        return true;
      } catch (e) {
        console.error("createTodo failed", e);
        showError("Todo konnte nicht erstellt werden.");
        return false;
      }
    },
    [activeSpaceId, user, todos, mentionMembers, showError]
  );

  const editContent = useCallback(
    async (id: string, title: string, body: TiptapContent | null): Promise<boolean> => {
      if (!activeSpaceId || !user) return false;
      try {
        await editTodoContent(activeSpaceId, id, title, body, user.uid, mentionMembers);
        return true;
      } catch (e) {
        console.error("editContent failed", e);
        showError("Änderung konnte nicht gespeichert werden.");
        return false;
      }
    },
    [activeSpaceId, user, mentionMembers, showError]
  );

  const setCompleted = useCallback(
    async (id: string, completed: boolean) => {
      if (!activeSpaceId || !user) return;
      try {
        await setTodoCompleted(activeSpaceId, id, completed, user.uid);
      } catch (e) {
        console.error("setCompleted failed", e);
        showError("Status konnte nicht geändert werden.");
      }
    },
    [activeSpaceId, user, showError]
  );

  const setWaitingOn = useCallback(
    async (id: string, waitingOn: string | null) => {
      if (!activeSpaceId || !user) return;
      try {
        await setTodoWaitingOn(activeSpaceId, id, waitingOn, user.uid);
      } catch (e) {
        console.error("setWaitingOn failed", e);
        showError("Zuweisung konnte nicht gespeichert werden.");
      }
    },
    [activeSpaceId, user, showError]
  );

  const setStatus = useCallback(
    async (id: string, status: { completed: boolean; waitingOn: string | null }) => {
      if (!activeSpaceId || !user) return;
      try {
        await setTodoStatus(activeSpaceId, id, status, user.uid);
      } catch (e) {
        console.error("setStatus failed", e);
        showError("Status konnte nicht geändert werden.");
      }
    },
    [activeSpaceId, user, showError]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!activeSpaceId) return;
      try {
        await deleteTodo(activeSpaceId, id);
      } catch (e) {
        console.error("remove failed", e);
        showError("Todo konnte nicht gelöscht werden.");
      }
    },
    [activeSpaceId, showError]
  );

  const moveTodo = useCallback(
    async (id: string, targetSpaceId: string): Promise<boolean> => {
      if (!user) return false;
      const todo = todos.find((t) => t.id === id);
      const target = spaces.find((s) => s.id === targetSpaceId);
      if (!todo || !target) return false;
      // The rules require the (preserved) creator to be a member of the target;
      // check here so the user gets a clear message instead of a permission error.
      if (!target.members.includes(todo.createdBy)) {
        showError("Verschieben nicht möglich: der Ersteller hat keinen Zugriff auf diesen Space.");
        return false;
      }
      const clearWaitingOn = !!todo.waitingOn && !target.members.includes(todo.waitingOn);
      const sourceSpaceId = todo.spaceId;
      try {
        const newId = await moveTodoToSpace(todo, targetSpaceId, user.uid, { clearWaitingOn });
        // Undo (issue #202): move the now-target-resident todo back to its source.
        // The source had the original members, so the original waitingOn is valid
        // there again — reconstruct from the original `todo` (with the new id) so
        // undo also restores a waitingOn the forward move had to clear.
        showToast(`In „${target.name}" verschoben.`, {
          label: "Rückgängig",
          onAction: () => {
            moveTodoToSpace({ ...todo, id: newId, spaceId: targetSpaceId }, sourceSpaceId, user.uid)
              .then(() => showToast("Verschieben rückgängig gemacht."))
              .catch((e) => {
                console.error("undo move failed", e);
                showError("Rückgängig machen fehlgeschlagen.");
              });
          },
        });
        return true;
      } catch (e) {
        console.error("moveTodo failed", e);
        showError("Todo konnte nicht verschoben werden.");
        return false;
      }
    },
    [user, todos, spaces, showToast, showError]
  );

  const reorder = useCallback(
    async (movedId: string, visibleOrderedIds: string[]) => {
      if (!activeSpaceId || !user) return;
      const idx = visibleOrderedIds.indexOf(movedId);
      if (idx === -1) return;
      const byId = new Map(todos.map((t) => [t.id, t]));
      const orderOf = (id: string | undefined): number | null =>
        id ? byId.get(id)?.order ?? null : null;
      // Anchor to the visible neighbours only, so reordering works (and stays
      // intuitive) while a tag filter hides part of the list (FA-07).
      const prevOrder = orderOf(visibleOrderedIds[idx - 1]);
      const nextOrder = orderOf(visibleOrderedIds[idx + 1]);
      const next = orderBetween(prevOrder, nextOrder);
      try {
        if (next !== null) {
          await setTodoOrder(activeSpaceId, movedId, next, user.uid);
          return;
        }
        // Gap too tight (or stored ties): renumber the whole open list with the
        // move applied. Rebuild from the globally ordered open todos so the
        // filtered-out ones keep their relative slots — insert moved before its
        // visible successor (or at the end when it moved to the bottom).
        const nextVisibleId = visibleOrderedIds[idx + 1];
        const open = todos
          .filter((t) => !t.completed && t.id !== movedId)
          .map((t) => t.id);
        const at = nextVisibleId ? open.indexOf(nextVisibleId) : -1;
        open.splice(at < 0 ? open.length : at, 0, movedId);
        await normalizeTodoOrders(activeSpaceId, open, user.uid);
      } catch (e) {
        console.error("reorder failed", e);
        showError("Reihenfolge konnte nicht gespeichert werden.");
      }
    },
    [activeSpaceId, user, todos, showError]
  );

  const attachToSession = useCallback(
    async (id: string, sessionId: string) => {
      if (!activeSpaceId || !user) return;
      try {
        await attachTodoToSession(activeSpaceId, id, sessionId, user.uid);
      } catch (e) {
        console.error("attachToSession failed", e);
        showError("An Agent-Session anhängen fehlgeschlagen.");
      }
    },
    [activeSpaceId, user, showError]
  );

  const detachSession = useCallback(
    async (id: string) => {
      if (!activeSpaceId || !user) return;
      try {
        await detachTodoSession(activeSpaceId, id, user.uid);
      } catch (e) {
        console.error("detachSession failed", e);
        showError("Lösen der Agent-Session fehlgeschlagen.");
      }
    },
    [activeSpaceId, user, showError]
  );

  const value: TodosContextType = {
    todos,
    loading,
    tags,
    tagFilters,
    toggleTag,
    clearTags,
    filtered,
    refresh,
    createTodo,
    editContent,
    setCompleted,
    setWaitingOn,
    setStatus,
    remove,
    moveTodo,
    reorder,
    attachToSession,
    detachSession,
  };

  return <TodosContext.Provider value={value}>{children}</TodosContext.Provider>;
};

export const useTodos = (): TodosContextType => {
  const context = useContext(TodosContext);
  if (context === undefined) {
    throw new Error("useTodos must be used within a TodosProvider");
  }
  return context;
};
