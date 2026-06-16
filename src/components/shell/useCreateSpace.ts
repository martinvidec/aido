"use client";

import { useState } from "react";
import { useSpaces } from "@/lib/contexts/SpacesContext";

/**
 * Shared "create a space" form state (issue #82) for the desktop sidebar
 * (`NewSpaceButton`) and the mobile bottom-sheet form (`MobileShell`). Holds the
 * name + busy state and a `submit()` that keeps the input on failure (#68) and
 * only runs `onSuccess` after a successful create.
 */
export function useCreateSpace() {
  const { createSpace } = useSpaces();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (onSuccess?: () => void): Promise<boolean> => {
    const value = name.trim();
    if (!value) return false;
    setBusy(true);
    try {
      const id = await createSpace(value);
      // Keep the input with the typed name on failure so it can be retried
      // (createSpace shows an error toast); only clear/close on success (#68).
      if (id) {
        setName("");
        onSuccess?.();
        return true;
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { name, setName, busy, submit };
}
