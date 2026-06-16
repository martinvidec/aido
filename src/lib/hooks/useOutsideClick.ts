"use client";

import { RefObject, useEffect, useRef } from "react";

/**
 * Closes a popover/menu on a mousedown outside `ref` while `active` (issue #81).
 * Shared by the shell's outside-click consumers (InvitePopover, SpaceMenu,
 * AccountMenu, list/TodoRow), which previously each inlined this effect.
 *
 * The latest `onOutside` is read through a ref, so the listener is (re)attached
 * only when `active` toggles — not on every render, even if callers pass an
 * inline closure.
 */
export function useOutsideClick<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onOutside: () => void
): void {
  const cb = useRef(onOutside);
  cb.current = onOutside;

  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [active, ref]);
}
