"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { getContacts, type Contact } from "@/lib/firebase/firebaseUtils";
import Avatar from "./Avatar";

/**
 * Member management for the active space (issue #47): lists the current user's
 * contacts with a ✓ toggle for space membership. Shared by the desktop invite
 * popover and the mobile members sheet. Touch targets are ≥44px.
 */
export default function MemberManager() {
  const { user } = useAuth();
  const { activeSpace, addMember, removeMember } = useSpaces();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getContacts(user.uid);
        if (!cancelled) setContacts(loaded);
      } catch {
        if (!cancelled) setContacts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!activeSpace) return null;
  const members = activeSpace.members;

  const toggle = async (uid: string) => {
    if (pending) return;
    setPending(uid);
    try {
      if (members.includes(uid)) await removeMember(activeSpace.id, uid);
      else await addMember(activeSpace.id, uid);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 pb-1 text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-dim">
        Mitglieder
      </div>
      {contacts === null ? (
        <p className="px-1 py-2 text-sm text-text-dim">Lädt …</p>
      ) : contacts.length === 0 ? (
        <p className="px-1 py-2 text-sm text-text-dim">
          Keine Kontakte zum Einladen. Füge zuerst Kontakte unter „Contacts“ hinzu.
        </p>
      ) : (
        contacts.map((contact) => {
          const isMember = members.includes(contact.uid);
          return (
            <button
              key={contact.uid}
              type="button"
              onClick={() => toggle(contact.uid)}
              disabled={pending === contact.uid}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-row-hover disabled:opacity-60"
              style={{ minHeight: 44 }}
            >
              <Avatar uid={contact.uid} name={contact.displayName} size={26} />
              <span className="flex-1 truncate text-sm font-semibold">
                {contact.displayName ?? contact.email ?? "Unbekannt"}
              </span>
              <span
                className="text-accent"
                style={{ visibility: isMember ? "visible" : "hidden" }}
                aria-hidden
              >
                ✓
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
