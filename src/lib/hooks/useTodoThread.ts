"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useToast } from "@/lib/contexts/ToastContext";
import {
  subscribeThread,
  postThreadMessage,
  deleteThreadMessage,
} from "@/lib/firebase/firebaseUtils";
import type { ThreadMessage, TiptapContent } from "@/lib/types";

export interface UseTodoThread {
  /** The todo's messages, oldest first. */
  messages: ThreadMessage[];
  loading: boolean;
  /** Post the current user's message; returns true on success. */
  post: (body: TiptapContent | null) => Promise<boolean>;
  /** Delete a message (rules allow only the author); returns true on success. */
  remove: (messageId: string) => Promise<boolean>;
}

/**
 * Live per-todo discussion thread (epic #247). Subscribes to
 * `spaces/{spaceId}/todos/{todoId}/messages` while mounted and exposes
 * post/remove. Deliberately a standalone hook (not a context): a component
 * subscribes only while a todo's thread is open, so many list rows don't each
 * hold an onSnapshot listener. Passing a null spaceId/todoId yields an empty,
 * idle thread (nothing subscribed).
 */
export function useTodoThread(
  spaceId: string | null | undefined,
  todoId: string | null | undefined
): UseTodoThread {
  const { user } = useAuth();
  const { showError } = useToast();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!spaceId || !todoId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeThread(
      spaceId,
      todoId,
      (loaded) => {
        setMessages(loaded);
        setLoading(false);
      },
      (e) => {
        console.error("thread subscription failed", e);
        showError("Thread konnte nicht geladen werden.");
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [spaceId, todoId, showError]);

  const post = useCallback(
    async (body: TiptapContent | null): Promise<boolean> => {
      if (!spaceId || !todoId || !user) return false;
      try {
        await postThreadMessage(spaceId, todoId, user.uid, body);
        return true;
      } catch (e) {
        console.error("thread post failed", e);
        showError("Nachricht konnte nicht gesendet werden.");
        return false;
      }
    },
    [spaceId, todoId, user, showError]
  );

  const remove = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!spaceId || !todoId) return false;
      try {
        await deleteThreadMessage(spaceId, todoId, messageId);
        return true;
      } catch (e) {
        console.error("thread remove failed", e);
        showError("Nachricht konnte nicht gelöscht werden.");
        return false;
      }
    },
    [spaceId, todoId, showError]
  );

  return { messages, loading, post, remove };
}
