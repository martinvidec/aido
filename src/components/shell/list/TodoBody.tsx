"use client";

import React, { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { useTiptapConfig } from "@/lib/hooks/useTiptapConfig";
import type { TiptapContent } from "@/lib/types";

/**
 * Read-only renderer for a todo's rich body (issue #45). XSS-safe ProseMirror
 * path (never dangerouslySetInnerHTML). Checklist checkboxes stay interactive
 * via onReadOnlyChecked; toggling persists the new body through onChange.
 */
export default function TodoBody({
  body,
  onChange,
}: {
  body: TiptapContent | null;
  onChange: (next: TiptapContent) => void;
}) {
  const { extensions, editorProps } = useTiptapConfig({
    editable: false,
    enableMentionSuggestion: false,
    onReadOnlyChecked: () => true,
  });

  const editor = useEditor(
    {
      editable: false,
      content: body || "",
      extensions,
      editorProps,
      immediatelyRender: false,
      onUpdate: ({ editor }) => onChange(editor.getJSON() as TiptapContent),
    },
    []
  );

  // Keep content in sync when the body prop changes externally (e.g. after save).
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      const current = JSON.stringify(editor.getJSON());
      const next = JSON.stringify(body || {});
      if (current !== next) editor.commands.setContent(body || "", false);
    }
  }, [body, editor]);

  useEffect(() => () => editor?.destroy(), [editor]);

  return (
    <div className="todo-body">
      <EditorContent editor={editor} />
    </div>
  );
}
