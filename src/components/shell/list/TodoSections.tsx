"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { useTodos } from "@/lib/contexts/TodosContext";
import { useSpaceMemberNames } from "@/lib/hooks/useMemberProfiles";
import TodoRow from "./TodoRow";
import type { Todo } from "@/lib/types";

// Joins ids into a comparable signature; "/" can't appear in a Firestore doc id.
const SEP = "/";

/** Six-dot drag grip. */
function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="5.5" cy="4" r="1.3" />
      <circle cx="10.5" cy="4" r="1.3" />
      <circle cx="5.5" cy="8" r="1.3" />
      <circle cx="10.5" cy="8" r="1.3" />
      <circle cx="5.5" cy="12" r="1.3" />
      <circle cx="10.5" cy="12" r="1.3" />
    </svg>
  );
}

/**
 * One draggable open todo (issue #236). The grip handle is the ONLY drag
 * initiator (`dragListener={false}` + `useDragControls`), so the checkbox, body
 * toggle, inline edit and list scrolling never start a drag. `touch-action: none`
 * on the handle lets it drag on touch instead of scrolling the page.
 */
function ReorderableRow({
  id,
  todo,
  nameOf,
  variant,
  onOpenActions,
  onReorderEnd,
}: {
  id: string;
  todo: Todo;
  nameOf: (uid: string) => string;
  variant: "desktop" | "mobile";
  onOpenActions?: (todo: Todo) => void;
  onReorderEnd: (movedId: string) => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      as="div"
      value={id}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.01 }}
      onDragEnd={() => onReorderEnd(id)}
    >
      <TodoRow
        todo={todo}
        nameOf={nameOf}
        variant={variant}
        onOpenActions={onOpenActions}
        dragHandle={
          <button
            type="button"
            aria-label="Zum Umsortieren ziehen"
            onPointerDown={(e) => controls.start(e)}
            className="mt-0.5 shrink-0 cursor-grab px-0.5 py-1 text-text-dim hover:text-text active:cursor-grabbing"
            style={{ touchAction: "none" }}
          >
            <GripIcon />
          </button>
        }
      />
    </Reorder.Item>
  );
}

/**
 * Shared open + collapsible "Erledigt" todo sections (issue #82) for the desktop
 * Liste (`ListView`) and the mobile Todos tab (`MobileTodos`). The open section
 * is drag-reorderable (issue #236); the two views differ only in row chrome:
 * desktop rows use an inline actions popover; mobile rows open a bottom sheet via
 * `onOpenActions` (handled by the caller).
 */
export default function TodoSections({
  variant = "desktop",
  onOpenActions,
}: {
  variant?: "desktop" | "mobile";
  onOpenActions?: (todo: Todo) => void;
}) {
  const { filtered, loading, reorder } = useTodos();
  const nameOf = useSpaceMemberNames();
  const [showDone, setShowDone] = useState(false);

  const open = useMemo(() => filtered.filter((t) => !t.completed), [filtered]);
  const done = useMemo(() => filtered.filter((t) => t.completed), [filtered]);
  const byId = useMemo(() => new Map(open.map((t) => [t.id, t])), [open]);

  // Local, optimistic copy of the open order so a drag stays put until the
  // Firestore echo arrives (FA-10). Values are ids (stable identity → framer
  // matches reliably and the list doesn't flash when a fresh snapshot maps new
  // Todo objects). Re-synced whenever the server order or the tag filter changes.
  const [orderIds, setOrderIds] = useState<string[]>(() => open.map((t) => t.id));
  const orderIdsRef = useRef(orderIds);
  orderIdsRef.current = orderIds;
  const syncedRef = useRef("");
  useEffect(() => {
    const ids = open.map((t) => t.id);
    setOrderIds(ids);
    syncedRef.current = ids.join(SEP);
  }, [open]);

  const onReorderEnd = useCallback(
    (movedId: string) => {
      const ids = orderIdsRef.current;
      // No write when the drag ended back in the original slot.
      if (ids.join(SEP) === syncedRef.current) return;
      reorder(movedId, ids);
    },
    [reorder]
  );

  const gap = variant === "mobile" ? "gap-2" : "gap-1";

  if (loading) return <p className="py-2 text-sm text-text-dim">Lädt …</p>;

  return (
    <>
      {orderIds.length === 0 ? (
        <p className="py-2 text-sm text-text-dim">Keine offenen Todos.</p>
      ) : (
        <Reorder.Group
          as="div"
          axis="y"
          values={orderIds}
          onReorder={setOrderIds}
          className={`flex flex-col ${gap}`}
        >
          {orderIds.map((id) => {
            const t = byId.get(id);
            if (!t) return null;
            return (
              <ReorderableRow
                key={id}
                id={id}
                todo={t}
                nameOf={nameOf}
                variant={variant}
                onOpenActions={onOpenActions}
                onReorderEnd={onReorderEnd}
              />
            );
          })}
        </Reorder.Group>
      )}

      {done.length > 0 && (
        <div className={`flex flex-col ${gap}`}>
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            className="self-start text-sm font-semibold text-text-dim hover:text-text"
          >
            Erledigt ({done.length}) {showDone ? "▲" : "▼"}
          </button>
          {showDone &&
            done.map((t) => (
              <TodoRow key={t.id} todo={t} nameOf={nameOf} variant={variant} onOpenActions={onOpenActions} dimmed />
            ))}
        </div>
      )}
    </>
  );
}
