"use client";

import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useMemberProfiles } from "@/lib/hooks/useMemberProfiles";

export interface MemberResolver {
  members: string[];
  nameOf: (uid: string) => string;
  firstName: (uid: string) => string;
  /** First @mention in the text resolved to a member uid, or null. */
  matchMention: (text: string) => string | null;
}

/**
 * Resolves space members for the Heute view (issue #44): display names and the
 * first @mention in a daily text → member uid (drives the direction label and
 * the input autocomplete).
 */
export function useMemberResolver(): MemberResolver {
  const { activeSpace } = useSpaces();
  const members = activeSpace?.members ?? [];
  const profiles = useMemberProfiles(members);

  const nameOf = (uid: string) => profiles[uid]?.displayName ?? "jemand";
  const firstName = (uid: string) => nameOf(uid).split(/\s+/)[0];

  const matchMention = (text: string): string | null => {
    const match = text.match(/@(\w+)/);
    if (!match) return null;
    const word = match[1].toLowerCase();
    return (
      members.find((uid) =>
        (profiles[uid]?.displayName ?? "")
          .toLowerCase()
          .split(/\s+/)
          .some((part) => part.startsWith(word))
      ) ?? null
    );
  };

  return { members, nameOf, firstName, matchMention };
}
