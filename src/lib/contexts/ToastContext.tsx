"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";

interface ToastContextType {
  /** Show a transient confirmation toast (auto-hides after 2600ms). */
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const AUTO_HIDE_MS = 2600;

/**
 * App-wide toast primitive (issue #43). Features call `showToast(...)` for
 * short confirmations (e.g. "In die Liste übernommen."). Rendered fixed at the
 * bottom center, above the mobile tab bar.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setMessage(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), AUTO_HIDE_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <div
          className="fixed left-1/2 z-[60] -translate-x-1/2 rounded-full bg-bg-pop px-4 py-2 text-sm font-semibold shadow-soft"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 86px)" }}
          role="status"
        >
          {message}
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
