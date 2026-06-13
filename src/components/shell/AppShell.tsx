"use client";

import React from "react";
import { SpacesProvider } from "@/lib/contexts/SpacesContext";
import { TodosProvider } from "@/lib/contexts/TodosContext";
import { DailyProvider } from "@/lib/contexts/DailyContext";
import { ToastProvider } from "@/lib/contexts/ToastContext";
import DesktopShell from "./DesktopShell";
import MobileShell from "./MobileShell";

/**
 * Entry point for the redesigned workspace (issues #42/#43). Provides spaces +
 * toast state and renders both shells; CSS handles the responsive switch
 * (desktop is `md:flex`, mobile is `md:hidden`), avoiding hydration mismatch.
 */
export default function AppShell() {
  return (
    <ToastProvider>
      <SpacesProvider>
        <TodosProvider>
          <DailyProvider>
            <DesktopShell />
            <MobileShell />
          </DailyProvider>
        </TodosProvider>
      </SpacesProvider>
    </ToastProvider>
  );
}
