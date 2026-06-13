"use client";

import { useEffect, useState } from "react";
import { getPublicProfile, type PublicProfile } from "@/lib/firebase/firebaseUtils";
import { useSpaces } from "@/lib/contexts/SpacesContext";

/**
 * Loads public profiles for a list of member uids (for avatar initials / names).
 * Shared by the desktop space header and the mobile header (issues #42/#43).
 */
export function useMemberProfiles(memberUids: string[]): Record<string, PublicProfile> {
  const [profiles, setProfiles] = useState<Record<string, PublicProfile>>({});
  const key = memberUids.join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        memberUids.map(async (uid) => {
          try {
            return [uid, await getPublicProfile(uid)] as const;
          } catch {
            return [uid, null] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, PublicProfile> = {};
      for (const [uid, profile] of entries) {
        if (profile) next[uid] = profile;
      }
      setProfiles(next);
    })();
    return () => {
      cancelled = true;
    };
    // `key` is the stable dependency derived from memberUids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return profiles;
}

/**
 * Returns a `nameOf(uid)` resolver for the active space's members (issue #45):
 * member display name, or "jemand" as a fallback.
 */
export function useSpaceMemberNames(): (uid: string) => string {
  const { activeSpace } = useSpaces();
  const profiles = useMemberProfiles(activeSpace?.members ?? []);
  return (uid: string) => profiles[uid]?.displayName ?? "jemand";
}
