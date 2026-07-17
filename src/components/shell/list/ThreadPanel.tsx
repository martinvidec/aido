"use client";

import React, { useMemo } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useTodoThread } from "@/lib/hooks/useTodoThread";
import { useMemberProfiles, nameFromProfiles } from "@/lib/hooks/useMemberProfiles";
import ThreadComposer from "./ThreadComposer";
import ThreadMessage from "./ThreadMessage";
import type { SuggestionItem } from "@/components/SuggestionList";

/**
 * Per-todo discussion thread shown in the expanded list row (epic #247). Keeps
 * the member<->aido back-and-forth out of the todo body. Subscribes only while
 * mounted (i.e. while the row is expanded) via {@link useTodoThread}. @mentions
 * are sourced from the space's members.
 */
export default function ThreadPanel({
  spaceId,
  todoId,
  accentColor,
}: {
  spaceId: string;
  todoId: string;
  accentColor?: string;
}) {
  const { user } = useAuth();
  const { activeSpace } = useSpaces();
  const { messages, loading, post, remove } = useTodoThread(spaceId, todoId);

  const members = useMemo(() => activeSpace?.members ?? [], [activeSpace]);
  const profiles = useMemberProfiles(members);

  const mentionCandidates = useMemo<SuggestionItem[]>(
    () =>
      members.map((uid) => ({
        id: uid,
        label: nameFromProfiles(profiles, uid),
        photoURL: profiles[uid]?.photoURL ?? null,
      })),
    [members, profiles]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-bold uppercase tracking-wide text-text-dim">Thread</div>

      {loading ? (
        <div className="text-sm text-text-dim">Wird geladen …</div>
      ) : messages.length === 0 ? (
        <div className="text-sm text-text-dim">Noch keine Nachrichten.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <ThreadMessage
              key={m.id}
              message={m}
              authorName={nameFromProfiles(profiles, m.author)}
              authorPhoto={profiles[m.author]?.photoURL ?? null}
              canDelete={!!user && m.author === user.uid}
              onDelete={() => remove(m.id)}
            />
          ))}
        </div>
      )}

      <ThreadComposer accentColor={accentColor} mentionCandidates={mentionCandidates} onSubmit={post} />
    </div>
  );
}
