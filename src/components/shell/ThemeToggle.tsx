"use client";

import React from "react";
import { useTheme } from "@/lib/contexts/ThemeContext";

interface ThemeToggleProps {
  /** Pill width (default 38, the desktop size; mobile uses 42 — issue #43). */
  width?: number;
  height?: number;
}

/**
 * Light/Dark pill toggle (issue #39/#42). The knob slides (margin-left 0.2s per
 * the handoff). Sets an explicit 'light'/'dark' preference via ThemeContext.
 */
export default function ThemeToggle({ width = 38, height = 21 }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const knob = height - 4;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Theme umschalten"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative shrink-0 rounded-full"
      style={{ width, height, backgroundColor: "var(--accent)" }}
    >
      <span
        className="absolute top-1/2 block rounded-full bg-white"
        style={{
          width: knob,
          height: knob,
          marginLeft: isDark ? width - knob - 2 : 2,
          transform: "translateY(-50%)",
          transition: "margin-left 0.2s",
        }}
      />
    </button>
  );
}
