"use client";

import React from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";
import ListView from "./list/ListView";
import Heute from "./heute/Heute";
import BoardView from "./board/BoardView";

/**
 * Main-column content for the desktop shell: Heute (#44) above the active view.
 * Board (#46) is still a placeholder.
 */
export default function WorkspaceContent() {
  const { view } = useSpaces();

  return (
    <>
      <Heute />

      {view === "board" ? <BoardView /> : <ListView />}
    </>
  );
}
