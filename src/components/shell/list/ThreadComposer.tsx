"use client";

import React, { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { useTiptapConfig } from "@/lib/hooks/useTiptapConfig";
import ComposerToolbar from "./ComposerToolbar";
import type { SuggestionItem } from "@/components/SuggestionList";
import type { TiptapContent } from "@/lib/types";

interface ThreadComposerProps {
  accentColor?: string;
  /** Space members offered as @mention suggestions (epic #247). */
  mentionCandidates: SuggestionItem[];
  /** Post the message; returns true on success (the editor is then cleared). */
  onSubmit: (body: TiptapContent) => Promise<boolean>;
}

/**
 * Thread message composer (epic #247). Mirrors {@link TodoEditor} but WITHOUT a
 * title — a thread message is just a rich-text body with the same TipTap
 * capabilities (formatting, checklists, code, `#`-tags, `@`-mentions). Mentions
 * are sourced from the space's members, not the user's contacts.
 */
export default function ThreadComposer({ accentColor, mentionCandidates, onSubmit }: ThreadComposerProps) {
  const [sending, setSending] = useState(false);

  const { extensions, editorProps } = useTiptapConfig({
    editable: true,
    enableMentionSuggestion: true,
    mentionCandidates,
    placeholder: "Nachricht, @Person, #Tag …",
  });

  const editor = useEditor(
    { editable: true, content: "", extensions, editorProps, immediatelyRender: false },
    []
  );

  useEffect(() => () => editor?.destroy(), [editor]);

  const send = async () => {
    if (!editor || sending) return;
    if (editor.getText().trim().length === 0) return; // never post an empty message
    const body = editor.getJSON() as TiptapContent;
    setSending(true);
    const ok = await onSubmit(body);
    setSending(false);
    if (ok) editor.commands.clearContent();
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-2xl bg-bg-card p-3"
      style={{ border: `1.5px solid ${accentColor ?? "var(--border)"}` }}
    >
      <ComposerToolbar editor={editor} />
      <div className="todo-body">
        <EditorContent editor={editor} />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="rounded-full px-4 py-1.5 text-sm font-extrabold text-white disabled:opacity-50"
          style={{ background: accentColor ?? "var(--accent)" }}
        >
          Senden
        </button>
      </div>
    </div>
  );
}
