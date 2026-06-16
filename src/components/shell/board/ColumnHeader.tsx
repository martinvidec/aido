"use client";

import React from "react";
import Avatar from "../Avatar";
import type { BoardColumn } from "./columns";

/**
 * Board column header (issue #82): optional member avatar + label + count,
 * shared by the desktop and mobile boards. `className` lets the desktop add its
 * column padding (`px-1 pb-1`).
 */
export default function ColumnHeader({
  col,
  nameOf,
  className,
}: {
  col: BoardColumn;
  nameOf: (uid: string) => string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2${className ? ` ${className}` : ""}`}>
      {col.badgeUid && <Avatar uid={col.badgeUid} name={nameOf(col.badgeUid)} size={20} />}
      <span className="text-xs font-extrabold uppercase tracking-wide text-text-dim">{col.label}</span>
      {col.todos.length > 0 && <span className="ml-auto text-xs text-text-dim">{col.todos.length}</span>}
    </div>
  );
}
