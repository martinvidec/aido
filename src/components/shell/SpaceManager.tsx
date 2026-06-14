"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useSpaces } from "@/lib/contexts/SpacesContext";

/**
 * Space management for the active space (issue #78): rename (any member) and
 * delete (creator only — also enforced by firestore.rules). Shared by the
 * desktop space menu and the mobile space sheet; touch targets stay ≥40px.
 * Calls onDone() after a successful delete so the host popover/sheet closes.
 */
export default function SpaceManager({ onDone }: { onDone?: () => void }) {
  const { user } = useAuth();
  const { activeSpace, renameSpace, deleteSpace } = useSpaces();
  const [name, setName] = useState(activeSpace?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!activeSpace) return null;
  const isCreator = user?.uid === activeSpace.createdBy;
  const trimmed = name.trim();
  const canRename = trimmed.length > 0 && trimmed !== activeSpace.name && !busy;

  const save = async () => {
    if (!canRename) return;
    setBusy(true);
    try {
      await renameSpace(activeSpace.id, name);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await deleteSpace(activeSpace.id);
      if (ok) onDone?.();
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-dim">
        Space
      </div>

      <div className="flex items-center gap-2">
        <input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          placeholder="Space-Name"
          aria-label="Space-Name"
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg-card px-3 text-sm outline-none"
          style={{ minHeight: 40 }}
        />
        <button
          type="button"
          onClick={save}
          disabled={!canRename}
          className="shrink-0 rounded-full px-3 text-sm font-extrabold text-white disabled:opacity-50"
          style={{ background: "var(--accent)", minHeight: 40 }}
        >
          Umbenennen
        </button>
      </div>

      {!isCreator ? (
        <p className="px-1 text-xs text-text-dim">Nur der Ersteller kann diesen Space löschen.</p>
      ) : confirmDelete ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm text-text-dim">Space „{activeSpace.name}“ wirklich löschen?</span>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            disabled={busy}
            className="shrink-0 rounded-full px-3 text-sm text-text-dim"
            style={{ minHeight: 40 }}
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="shrink-0 rounded-full px-3 text-sm font-extrabold text-white disabled:opacity-50"
            style={{ background: "var(--danger)", minHeight: 40 }}
          >
            Löschen
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="self-start px-1 text-sm font-semibold text-danger hover:underline"
        >
          Space löschen
        </button>
      )}
    </div>
  );
}
