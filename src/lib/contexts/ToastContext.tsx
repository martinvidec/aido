"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";

type ToastVariant = "info" | "error";

interface ToastContextType {
  /** Show a transient confirmation toast (auto-hides). */
  showToast: (message: string) => void;
  /** Show a transient error toast (danger style, hides a bit slower). */
  showError: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const AUTO_HIDE_MS: Record<ToastVariant, number> = { info: 2600, error: 4500 };

/**
 * App-wide toast primitive (issue #43). Features call `showToast(...)` for
 * short confirmations (e.g. "In die Liste übernommen.") and `showError(...)`
 * for failed mutations (issue #68 — write failures must never be silent).
 * Rendered fixed at the bottom center, above the mobile tab bar.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, variant: ToastVariant) => {
    setToast({ message, variant });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), AUTO_HIDE_MS[variant]);
  }, []);

  const showToast = useCallback((msg: string) => show(msg, "info"), [show]);
  const showError = useCallback((msg: string) => show(msg, "error"), [show]);

  return (
    <ToastContext.Provider value={{ showToast, showError }}>
      {children}
      {toast && (
        <div
          className={`fixed left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold shadow-soft ${
            toast.variant === "error" ? "text-white" : "bg-bg-pop"
          }`}
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 86px)",
            ...(toast.variant === "error" ? { background: "var(--danger)" } : {}),
          }}
          role={toast.variant === "error" ? "alert" : "status"}
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};
