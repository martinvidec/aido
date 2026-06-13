"use client";

import React, { useEffect, useState } from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { getPublicProfile, type PublicProfile } from "@/lib/firebase/firebaseUtils";
import { spaceColorFromHue } from "@/lib/theme/colors";
import Avatar from "./Avatar";
import SegmentedControl from "./SegmentedControl";

/** Loads public profiles for a list of member uids (for avatar initials). */
function useMemberProfiles(memberUids: string[]): Record<string, PublicProfile> {
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
    // key is the stable dependency derived from memberUids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return profiles;
}

export default function SpaceHeader() {
  const { activeSpace } = useSpaces();
  const members = activeSpace?.members ?? [];
  const profiles = useMemberProfiles(members);

  if (!activeSpace) return null;

  return (
    <div className="flex items-center gap-3">
      <span
        className="shrink-0"
        style={{
          width: 14,
          height: 14,
          borderRadius: 5,
          backgroundColor: spaceColorFromHue(activeSpace.color),
        }}
      />
      <h1 className="text-2xl font-black">{activeSpace.name}</h1>

      {/* Overlapping member avatars */}
      <div className="flex items-center pl-2">
        {members.map((uid, i) => (
          <div key={uid} style={{ marginLeft: i === 0 ? 0 : -8 }}>
            <Avatar uid={uid} name={profiles[uid]?.displayName} size={28} ring />
          </div>
        ))}
      </div>

      {/* "+ einladen" — invite popover lives in the spaces-management issue (#47). */}
      <button
        type="button"
        disabled
        className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-text-dim"
      >
        + einladen
      </button>

      <div className="ml-auto">
        <SegmentedControl />
      </div>
    </div>
  );
}
