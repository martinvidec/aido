"use client";

import React from "react";
import { useTodos } from "@/lib/contexts/TodosContext";

// Splits on @mentions and #tags while keeping the delimiters.
const TOKEN = /(@[\w]+|#[\w]+)/g;

/**
 * Renders a todo title with @mention and #tag highlighting (issue #45).
 * #tags are clickable and activate the tag filter.
 */
export default function TodoTitle({ title, completed }: { title: string; completed?: boolean }) {
  const { toggleTag } = useTodos();
  const parts = title.split(TOKEN);

  return (
    <span className={`text-[15px] font-bold ${completed ? "line-through opacity-60" : ""}`}>
      {parts.map((part, i) => {
        if (part.startsWith("@")) {
          return (
            <span
              key={i}
              className="rounded px-1"
              style={{ color: "var(--mention)", background: "var(--mention-bg)" }}
            >
              {part}
            </span>
          );
        }
        if (part.startsWith("#")) {
          const tag = part.slice(1);
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleTag(tag);
              }}
              className="font-mono"
              style={{ color: "var(--tag)" }}
            >
              {part}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
