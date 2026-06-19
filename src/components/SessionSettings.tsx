"use client";

import { useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";

// "Sign out everywhere" control (issue #185, epic #186). Revokes all of the
// user's refresh tokens server-side, then signs out locally. This is the escape
// hatch that bounds the device-login residual (a proxy that saw a custom token
// can only ride the session until it's revoked here).

export default function SessionSettings() {
  const { user, signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function revokeAll() {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error("revoke failed");
      // Local sign-out for immediate effect; the protected layout redirects to /login.
      await signOut();
    } catch {
      setError("Konnte die Sitzungen nicht abmelden. Bitte erneut versuchen.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="bg-bg-card p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-2 text-text">Sicherheit</h2>
      <p className="text-sm text-text-dim mb-4">
        Meldet dich auf <span className="font-semibold text-text">allen</span> Geräten ab (widerruft alle
        Sitzungen). Nutze dies, wenn du dich über ein fremdes Gerät angemeldet hast.
      </p>

      {error && <p className="text-sm text-danger mb-3">{error}</p>}

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="px-4 py-2 rounded-lg border border-danger text-danger hover:bg-danger-soft focus:outline-none focus:ring-2 focus:ring-danger"
        >
          Auf allen Geräten abmelden
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-dim">Wirklich überall abmelden?</span>
          <button
            onClick={revokeAll}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-danger text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-danger disabled:opacity-50"
          >
            {busy ? "…" : "Bestätigen"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="text-sm font-semibold text-text-dim hover:text-text disabled:opacity-50"
          >
            Abbrechen
          </button>
        </div>
      )}
    </div>
  );
}
