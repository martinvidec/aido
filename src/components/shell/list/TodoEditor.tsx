"use client";

import React, { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useTiptapConfig } from "@/lib/hooks/useTiptapConfig";
import ComposerToolbar from "./ComposerToolbar";
import type { TiptapContent } from "@/lib/types";

interface TodoEditorProps {
  initialTitle?: string;
  initialBody?: TiptapContent | null;
  submitLabel?: string;
  accentColor?: string;
  onSave: (title: string, body: TiptapContent | null) => void;
  onCancel: () => void;
}

/**
 * Open composer / edit form (issue #45): title input (17/800) + TipTap body with
 * the format toolbar and @/# autocomplete. Used for both creating and editing.
 */
export default function TodoEditor({
  initialTitle = "",
  initialBody = null,
  submitLabel = "Hinzufügen",
  accentColor,
  onSave,
  onCancel,
}: TodoEditorProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState(initialTitle);

  const { extensions, editorProps } = useTiptapConfig({
    editable: true,
    enableMentionSuggestion: true,
    currentUserId: user?.uid,
    placeholder: "Beschreibung, Checklisten, @Personen, #Tags …",
  });

  const editor = useEditor(
    {
      editable: true,
      content: initialBody || "",
      extensions,
      editorProps,
      immediatelyRender: false,
    },
    []
  );

  useEffect(() => () => editor?.destroy(), [editor]);

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const isEmpty = editor ? editor.getText().trim().length === 0 : true;
    const body = !isEmpty && editor ? (editor.getJSON() as TiptapContent) : null;
    onSave(trimmed, body);
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-2xl bg-bg-card p-3"
      style={{ border: `1.5px solid ${accentColor ?? "var(--border)"}` }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        placeholder="Titel"
        className="bg-transparent text-[17px] font-extrabold outline-none placeholder:text-text-dim"
      />
      <ComposerToolbar editor={editor} />
      <div className="todo-body">
        <EditorContent editor={editor} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full px-3 py-1.5 text-sm text-text-dim">
          Abbrechen
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!title.trim()}
          className="rounded-full px-4 py-1.5 text-sm font-extrabold text-white disabled:opacity-50"
          style={{ background: accentColor ?? "var(--accent)" }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
