"use client";

import React, { useEffect } from "react";
import Image from "next/image";
import { useEditor, EditorContent } from "@tiptap/react";
import { useTiptapConfig } from "@/lib/hooks/useTiptapConfig";
import type { ThreadMessage as ThreadMessageType } from "@/lib/types";

interface ThreadMessageProps {
  message: ThreadMessageType;
  authorName: string;
  authorPhoto?: string | null;
  /** Show the delete affordance (only for the current user's own messages). */
  canDelete: boolean;
  onDelete: () => void;
}

/**
 * Read-only render of one thread message (epic #247). Mirrors {@link TodoBody}'s
 * XSS-safe ProseMirror path but WITHOUT the checklist write-back — a message is
 * immutable (no editing), so its checkboxes stay static. Header shows the author
 * (name/avatar), the time, and an "aido"-badge for session-authored messages.
 */
export default function ThreadMessage({
  message,
  authorName,
  authorPhoto,
  canDelete,
  onDelete,
}: ThreadMessageProps) {
  const { extensions, editorProps } = useTiptapConfig({
    editable: false,
    enableMentionSuggestion: false,
  });

  const editor = useEditor(
    {
      editable: false,
      content: message.body || "",
      extensions,
      editorProps,
      immediatelyRender: false,
    },
    []
  );

  useEffect(() => () => editor?.destroy(), [editor]);

  const time = message.createdAt
    ? message.createdAt.toDate().toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "gerade eben";

  const isAido = message.source === "aido";

  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-bg-card p-3" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-2">
        <div className="relative h-6 w-6 flex-shrink-0 overflow-hidden rounded-full border border-border">
          {authorPhoto ? (
            <Image src={authorPhoto} alt={authorName} fill className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-row-hover">
              <span className="text-xs text-text-dim">{authorName?.[0]?.toUpperCase() || "?"}</span>
            </div>
          )}
        </div>
        <span className="truncate text-sm font-extrabold text-text">{authorName}</span>
        {isAido && (
          <span
            className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            aido
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-text-dim">{time}</span>
        {canDelete && (
          <button
            type="button"
            aria-label="Nachricht löschen"
            title="Löschen"
            onClick={onDelete}
            className="text-text-dim hover:text-text"
          >
            ✕
          </button>
        )}
      </div>
      <div className="todo-body pl-8">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
