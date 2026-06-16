"use client";

import React from "react";
import { useTodos } from "@/lib/contexts/TodosContext";
import TokenizedText from "../TokenizedText";

/**
 * Renders a todo title with @mention and #tag highlighting (issue #45).
 * #tags are clickable and activate the tag filter.
 */
export default function TodoTitle({ title, completed }: { title: string; completed?: boolean }) {
  const { toggleTag } = useTodos();

  return (
    <span className={`text-[15px] font-bold ${completed ? "line-through opacity-60" : ""}`}>
      <TokenizedText text={title} onTagClick={toggleTag} />
    </span>
  );
}
