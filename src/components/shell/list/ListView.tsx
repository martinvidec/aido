"use client";

import React from "react";
import TagFilterBar from "./TagFilterBar";
import TodoComposer from "./TodoComposer";
import TodoSections from "./TodoSections";

/**
 * Desktop Liste view (issue #45): tag filter + composer + open todos + a
 * collapsible "Erledigt" section.
 */
export default function ListView() {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-dim">Todos</div>
      <TagFilterBar />
      <TodoComposer />
      <TodoSections />
    </div>
  );
}
