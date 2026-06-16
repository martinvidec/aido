"use client";

import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useMemberProfiles, nameFromProfiles } from "@/lib/hooks/useMemberProfiles";
import {
  extractMentionTokens,
  resolveMentionToken,
  type MentionMember,
} from "@/lib/utils/textUtils";

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

  const nameOf = (uid: string) => nameFromProfiles(profiles, uid);
  const firstName = (uid: string) => nameOf(uid).split(/\s+/)[0];

  // Resolve the first @mention in the text to exactly one member uid. Unicode-
  // aware and exact: an ambiguous or partial token resolves to null rather than
  // silently picking the first matching member (issue #75).
  const matchMention = (text: string): string | null => {
    const tokens = extractMentionTokens(text);
    if (tokens.length === 0) return null;
    const list: MentionMember[] = members.map((uid) => ({
      uid,
      displayName: profiles[uid]?.displayName ?? null,
    }));
    return resolveMentionToken(tokens[0], list);
  };

  return { members, nameOf, firstName, matchMention };
}
