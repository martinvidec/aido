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

interface ToastAction {
  label: string;
  onAction: () => void;
}

interface ToastState {
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

interface ToastContextType {
  /**
   * Show a transient confirmation toast (auto-hides). Pass `action` to render
   * an inline button (e.g. "Rückgängig" for an undo, issue #70).
   */
  showToast: (message: string, action?: ToastAction) => void;
  /** Show a transient error toast (danger style, hides a bit slower). */
  showError: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const AUTO_HIDE_MS: Record<ToastVariant, number> = { info: 2600, error: 4500 };
// An actionable toast stays a bit longer so the action is reachable.
const ACTION_HIDE_MS = 5500;

/**
 * App-wide toast primitive (issue #43). Features call `showToast(...)` for
 * short confirmations (e.g. "In die Liste übernommen."), optionally with an
 * undo action (issue #70), and `showError(...)` for failed mutations (issue
 * #68 — write failures must never be silent). Rendered fixed at the bottom
 * center, above the mobile tab bar.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((message: string, variant: ToastVariant, action?: ToastAction) => {
    setToast({ message, variant, action });
    if (timer.current) clearTimeout(timer.current);
    const ms = action ? ACTION_HIDE_MS : AUTO_HIDE_MS[variant];
    timer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const showToast = useCallback(
    (msg: string, action?: ToastAction) => show(msg, "info", action),
    [show]
  );
  const showError = useCallback((msg: string) => show(msg, "error"), [show]);

  return (
    <ToastContext.Provider value={{ showToast, showError }}>
      {children}
      {toast && (
        <div
          className={`fixed left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-sm font-semibold shadow-soft ${
            toast.variant === "error" ? "text-white" : "bg-bg-pop"
          }`}
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 86px)",
            ...(toast.variant === "error" ? { background: "var(--danger)" } : {}),
          }}
          role={toast.variant === "error" ? "alert" : "status"}
        >
          {toast.message}
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onAction();
                dismiss();
              }}
              className="-mr-1 shrink-0 rounded-full px-2 py-0.5 font-extrabold text-accent-text underline"
            >
              {toast.action.label}
            </button>
          )}
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
