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
import {
  getTodosForSpace,
  createTodo as createTodoDoc,
  editTodoContent,
  setTodoCompleted,
  setTodoWaitingOn,
  deleteTodo,
} from "@/lib/firebase/firebaseUtils";
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
  createTodo: (input: CreateTodoInput) => Promise<void>;
  editContent: (id: string, title: string, body: TiptapContent | null) => Promise<void>;
  setCompleted: (id: string, completed: boolean) => Promise<void>;
  setWaitingOn: (id: string, waitingOn: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const TodosContext = createContext<TodosContextType | undefined>(undefined);

/**
 * Loads and mutates the active space's todos (issue #45). Shared by the Liste
 * and Board views (#46). Tag filters reset when the active space changes.
 */
export const TodosProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { activeSpaceId, setOpenCount } = useSpaces();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilters, setTagFilters] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!activeSpaceId) {
      setTodos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const loaded = await getTodosForSpace(activeSpaceId);
    setTodos(loaded);
    setLoading(false);
    setOpenCount(activeSpaceId, loaded.filter((t) => !t.completed).length);
  }, [activeSpaceId, setOpenCount]);

  // Reload + reset filters whenever the active space changes.
  useEffect(() => {
    setTagFilters([]);
    refresh();
  }, [refresh]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const t of todos) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  }, [todos]);

  const toggleTag = useCallback((tag: string) => {
    setTagFilters((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const clearTags = useCallback(() => setTagFilters([]), []);

  const filtered = useMemo(() => {
    if (tagFilters.length === 0) return todos;
    // AND filter: a todo must carry every active tag.
    return todos.filter((t) => tagFilters.every((tag) => t.tags.includes(tag)));
  }, [todos, tagFilters]);

  const createTodo = useCallback(
    async (input: CreateTodoInput) => {
      if (!activeSpaceId || !user) return;
      const maxOrder = todos.reduce((m, t) => Math.max(m, t.order), 0);
      await createTodoDoc(activeSpaceId, user.uid, {
        title: input.title,
        body: input.body ?? null,
        order: maxOrder + 1,
      });
      await refresh();
    },
    [activeSpaceId, user, todos, refresh]
  );

  const editContent = useCallback(
    async (id: string, title: string, body: TiptapContent | null) => {
      if (!activeSpaceId) return;
      await editTodoContent(activeSpaceId, id, title, body);
      await refresh();
    },
    [activeSpaceId, refresh]
  );

  const setCompleted = useCallback(
    async (id: string, completed: boolean) => {
      if (!activeSpaceId) return;
      await setTodoCompleted(activeSpaceId, id, completed);
      await refresh();
    },
    [activeSpaceId, refresh]
  );

  const setWaitingOn = useCallback(
    async (id: string, waitingOn: string | null) => {
      if (!activeSpaceId) return;
      await setTodoWaitingOn(activeSpaceId, id, waitingOn);
      await refresh();
    },
    [activeSpaceId, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!activeSpaceId) return;
      await deleteTodo(activeSpaceId, id);
      await refresh();
    },
    [activeSpaceId, refresh]
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
    remove,
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
