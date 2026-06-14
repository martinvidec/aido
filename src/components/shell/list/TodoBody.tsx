"use client";

import React, { useEffect, useRef } from "react";
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

  // Serialised states this component itself produced (checkbox toggles). The
  // sync effect uses it to ignore the delayed echo of our own write, which
  // would otherwise revert a second toggle made before the first write landed
  // (issue #73). Bounded — a single body only churns through a few states.
  const authoredRef = useRef<Set<string>>(new Set());

  const editor = useEditor(
    {
      editable: false,
      content: body || "",
      extensions,
      editorProps,
      immediatelyRender: false,
      onUpdate: ({ editor }) => {
        const json = editor.getJSON() as TiptapContent;
        authoredRef.current.add(JSON.stringify(json));
        if (authoredRef.current.size > 50) authoredRef.current.clear();
        onChange(json);
      },
    },
    []
  );

  // Keep content in sync when the body prop changes externally (e.g. a
  // collaborator's edit). Skip echoes of our own toggles so a slower write
  // round-trip can't clobber a newer local edit (issue #73).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const next = JSON.stringify(body || {});
    if (authoredRef.current.has(next)) {
      authoredRef.current.delete(next); // consume this echo
      return;
    }
    const current = JSON.stringify(editor.getJSON());
    if (current !== next) editor.commands.setContent(body || "", false);
  }, [body, editor]);

  useEffect(() => () => editor?.destroy(), [editor]);

  return (
    <div className="todo-body">
      <EditorContent editor={editor} />
    </div>
  );
}
