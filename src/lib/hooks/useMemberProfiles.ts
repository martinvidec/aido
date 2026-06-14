"use client";

import { useEffect, useState } from "react";
import { getPublicProfile, type PublicProfile } from "@/lib/firebase/firebaseUtils";
import { useSpaces } from "@/lib/contexts/SpacesContext";

// Module-level profile cache shared by EVERY consumer (issue #77). The desktop
// and mobile shells are both mounted, and 6+ components resolve member profiles
// (headers, member manager, mention resolver, board names, …), so without this
// each uid was fetched once per consumer per mount. `inFlight` collapses
// concurrent fetches of the same uid into a single request. Public profiles are
// effectively static within a session (display name / photo), so a plain cache
// with no TTL is fine; it's repopulated fresh on the next page load.
const profileCache = new Map<string, PublicProfile>();
const inFlight = new Map<string, Promise<PublicProfile | null>>();

function loadProfile(uid: string): Promise<PublicProfile | null> {
  const cached = profileCache.get(uid);
  if (cached) return Promise.resolve(cached);
  const existing = inFlight.get(uid);
  if (existing) return existing;
  const p = getPublicProfile(uid)
    .then((profile) => {
      if (profile) profileCache.set(uid, profile);
      return profile;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(uid));
  inFlight.set(uid, p);
  return p;
}

function seedFromCache(uids: string[]): Record<string, PublicProfile> {
  const out: Record<string, PublicProfile> = {};
  for (const uid of uids) {
    const cached = profileCache.get(uid);
    if (cached) out[uid] = cached;
  }
  return out;
}

/**
 * Loads public profiles for a list of member uids (for avatar initials / names).
 * Shared by the desktop space header and the mobile header (issues #42/#43) and
 * backed by a module-level cache so repeat consumers don't refetch (issue #77).
 */
export function useMemberProfiles(memberUids: string[]): Record<string, PublicProfile> {
  const key = memberUids.join(",");
  // Render any already-cached profiles synchronously (no flash on revisit).
  const [profiles, setProfiles] = useState<Record<string, PublicProfile>>(() =>
    seedFromCache(key ? key.split(",") : [])
  );

  useEffect(() => {
    let cancelled = false;
    const uids = key ? key.split(",") : [];
    // Reset to the cached subset for the current member set, then fill in the
    // rest from the cache / a single shared fetch per missing uid.
    setProfiles(seedFromCache(uids));
    Promise.all(uids.map(async (uid) => [uid, await loadProfile(uid)] as const)).then((entries) => {
      if (cancelled) return;
      setProfiles((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [uid, profile] of entries) {
          if (profile && next[uid] !== profile) {
            next[uid] = profile;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
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
