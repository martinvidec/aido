"use client";

import React from "react";

// Splits on @mentions and #tags while keeping the delimiters.
const TOKEN = /(@[\w]+|#[\w]+)/g;

/**
 * Renders text with @mention and #tag highlighting (issue #81), shared by the
 * Liste title (`list/TodoTitle`) and the Board card title (`board/TodoCard`),
 * which previously each carried their own copy of this regex + markup.
 *
 * When `onTagClick` is given, #tags render as buttons that call it (the Liste's
 * tag filter); otherwise they're static spans (board cards).
 */
export default function TokenizedText({
  text,
  onTagClick,
}: {
  text: string;
  onTagClick?: (tag: string) => void;
}) {
  return (
    <>
      {text.split(TOKEN).map((part, i) => {
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
          if (onTagClick) {
            const tag = part.slice(1);
            return (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick(tag);
                }}
                className="font-mono"
                style={{ color: "var(--tag)" }}
              >
                {part}
              </button>
            );
          }
          return (
            <span key={i} className="font-mono" style={{ color: "var(--tag)" }}>
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
