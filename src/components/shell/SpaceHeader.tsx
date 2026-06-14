"use client";

import React from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import { useMemberProfiles } from "@/lib/hooks/useMemberProfiles";
import { spaceColorFromHue } from "@/lib/theme/colors";
import Avatar from "./Avatar";
import SegmentedControl from "./SegmentedControl";
import InvitePopover from "./InvitePopover";
import SpaceMenu from "./SpaceMenu";

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

      <InvitePopover />
      <SpaceMenu />

      <div className="ml-auto">
        <SegmentedControl />
      </div>
    </div>
  );
}
