"use client";

import React from "react";
import { SpacesProvider } from "@/lib/contexts/SpacesContext";
import DesktopShell from "./DesktopShell";

/**
 * Entry point for the redesigned workspace (issue #42). Provides the spaces
 * state and renders the desktop shell. The responsive mobile shell is added in
 * issue #43 (a layout switch will choose desktop vs. mobile here).
 */
export default function AppShell() {
  return (
    <SpacesProvider>
      <DesktopShell />
    </SpacesProvider>
  );
}
