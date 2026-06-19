"use client";

import { useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";

// Consent step for the device-login flow (issue #182, epic #186). The user signs
// in with the existing Firebase Google login, confirms the user_code shown on the
// work machine, and approves/denies. "Erlauben" posts the Firebase ID token +
// user_code to /api/auth/device/confirm; the work machine's poller then receives a
// Firebase custom token. No redirect — the work machine drives the rest by polling.

type Outcome = "approved" | "denied";

export default function DeviceConsentForm({ initialUserCode }: { initialUserCode: string }) {
  const { user, signInWithGoogle } = useAuth();
  const [userCode, setUserCode] = useState(initialUserCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function decide(action: "approve" | "deny") {
    if (!user) return;
    const code = userCode.trim();
    if (!code) {
      setError("Bitte gib den Code vom anderen Gerät ein.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/auth/device/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken, userCode: code, action }),
      });
      const data = await res.json();
      if (res.ok && data.status) {
        setOutcome(data.status as Outcome);
        setBusy(false);
        return;
      }
      setError(
        data.error === "invalid_request"
          ? "Code unbekannt, abgelaufen oder bereits verwendet."
          : data.error_description || "Bestätigung fehlgeschlagen."
      );
      setBusy(false);
    } catch {
      setError("Bestätigung fehlgeschlagen.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6 shadow-soft">
        <h1 className="text-2xl font-black mb-1">Gerät anmelden</h1>

        {outcome ? (
          <p className="text-text-dim mt-2">
            {outcome === "approved" ? (
              <>Gerät verbunden ✓ — du kannst dieses Fenster schließen. Das andere Gerät meldet sich gleich an.</>
            ) : (
              <>Anfrage abgelehnt. Du kannst dieses Fenster schließen.</>
            )}
          </p>
        ) : (
          <>
            <p className="text-text-dim mb-6">
              Bestätige den Code, der auf deinem anderen Gerät angezeigt wird, um es bei aido anzumelden.
            </p>

            {!user ? (
              <button
                onClick={signInWithGoogle}
                className="w-full rounded-full bg-accent px-4 py-2.5 font-extrabold text-white"
              >
                Mit Google anmelden
              </button>
            ) : (
              <>
                <p className="text-sm text-text-dim mb-4">
                  Angemeldet als{" "}
                  <span className="font-semibold text-text">{user.displayName || user.email}</span>
                </p>

                <label htmlFor="user-code" className="block text-sm text-text-dim mb-1">
                  Code vom anderen Gerät
                </label>
                <input
                  id="user-code"
                  value={userCode}
                  onChange={(e) => setUserCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="w-full rounded-xl border border-border bg-bg px-4 py-2.5 mb-4 font-mono tracking-widest text-center text-lg uppercase outline-none focus:border-accent"
                />

                {error && <p className="text-sm text-danger mb-3">{error}</p>}

                <div className="flex gap-2">
                  <button
                    onClick={() => decide("approve")}
                    disabled={busy}
                    className="flex-1 rounded-full bg-accent px-4 py-2.5 font-extrabold text-white disabled:opacity-50"
                  >
                    {busy ? "…" : "Erlauben"}
                  </button>
                  <button
                    onClick={() => decide("deny")}
                    disabled={busy}
                    className="flex-1 rounded-full border border-border px-4 py-2.5 font-semibold text-text-dim hover:text-text disabled:opacity-50"
                  >
                    Ablehnen
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
