"use client";

import React from "react";
import type { Editor } from "@tiptap/react";

function Btn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Keep editor selection on click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded px-2 py-1 text-sm"
      style={active ? { background: "var(--row-hover)", color: "var(--text)" } : { color: "var(--text-dim)" }}
    >
      {children}
    </button>
  );
}

/** Minimal TipTap format toolbar (issue #45): B / I / U / checklist / quote / code. */
export default function ComposerToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  return (
    <div className="flex items-center gap-1 border-b border-border pb-2">
      <Btn label="Fett" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn label="Kursiv" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <i>I</i>
      </Btn>
      <Btn label="Unterstrichen" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <u>U</u>
      </Btn>
      <Btn label="Checkliste" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        ≔
      </Btn>
      <Btn label="Zitat" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        ❝
      </Btn>
      <Btn label="Code" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        {"</>"}
      </Btn>
    </div>
  );
}
