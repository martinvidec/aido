"use client";

import React from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

/**
 * Mobile bottom sheet primitive (issue #43): rounded top (22px), drag grabber,
 * dimmed overlay. Rendered absolutely inside the mobile shell root. Touch
 * targets inside should stay ≥44px.
 */
export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <div
        className="absolute inset-0"
        style={{ background: "oklch(0 0 0 / 0.45)" }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="relative bg-bg-pop text-text shadow-soft"
        style={{
          borderRadius: "22px 22px 0 0",
          padding: "10px 18px calc(env(safe-area-inset-bottom, 0px) + 22px)",
        }}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="mx-auto mb-3 rounded-full"
          style={{ width: 38, height: 4, background: "var(--border)" }}
        />
        {title && <h2 className="mb-3 text-lg font-extrabold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
