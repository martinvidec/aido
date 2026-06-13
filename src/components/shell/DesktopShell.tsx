"use client";

import React from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import Sidebar from "./Sidebar";
import SpaceHeader from "./SpaceHeader";
import WorkspaceContent from "./WorkspaceContent";

/**
 * Desktop two-column layout (issue #42): fixed sidebar + scrolling main column.
 * The main column width follows the active view (780px list / 1140px board).
 */
export default function DesktopShell() {
  const { activeSpace, loading, view } = useSpaces();

  return (
    <div className="hidden h-screen overflow-hidden bg-bg text-text md:flex">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div
          className="mx-auto flex flex-col gap-[18px]"
          style={{ maxWidth: view === "board" ? 1140 : 780, padding: "30px 36px 90px" }}
        >
          {loading ? (
            <div className="pt-20 text-center text-sm text-text-dim">Lädt …</div>
          ) : activeSpace ? (
            <>
              <SpaceHeader />
              <WorkspaceContent />
            </>
          ) : (
            <div className="pt-20 text-center">
              <p className="text-lg font-extrabold">Noch keine Spaces</p>
              <p className="mt-1 text-sm text-text-dim">
                Leg über „+ Neuer Space“ deinen ersten Space an.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
