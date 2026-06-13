"use client";

import React from "react";
import { personColor } from "@/lib/theme/colors";

/** Up to two uppercase initials from a display name ("Martin Videc" → "MV"). */
export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps {
  uid: string;
  name?: string | null;
  /** Pixel diameter (default 28). */
  size?: number;
  /** Draw a 2px ring in the page background (used for overlapping member stacks). */
  ring?: boolean;
  className?: string;
}

/**
 * Circular avatar: initials on a deterministic person color (handoff: avatars
 * are initials on a person color, not photos).
 */
export default function Avatar({ uid, name, size = 28, ring = false, className = "" }: AvatarProps) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        backgroundColor: personColor(uid),
        ...(ring ? { boxShadow: "0 0 0 2px var(--bg)" } : {}),
      }}
      title={name ?? undefined}
    >
      {initials(name)}
    </div>
  );
}
