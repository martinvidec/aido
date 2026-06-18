"use client";

import { useState } from "react";
import { useAuth } from "@/lib/hooks/useAuth";

// Consent step for the OAuth authorize flow (issue #153). The server page has
// already validated client_id/redirect_uri/PKCE; here the user signs in with the
// existing Firebase Google login and approves. "Allow" posts the Firebase ID
// token + params to /api/oauth/authorize/confirm, which mints the auth code and
// returns the redirect back to the client.
export default function ConsentForm(props: {
  clientName: string | null;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope: string;
}) {
  const { user, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const appName = props.clientName || "Eine externe Anwendung";

  async function allow() {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/oauth/authorize/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idToken,
          clientId: props.clientId,
          redirectUri: props.redirectUri,
          codeChallenge: props.codeChallenge,
          state: props.state,
          scope: props.scope,
        }),
      });
      const data = await res.json();
      if (res.ok && data.redirectTo) {
        window.location.href = data.redirectTo;
        return;
      }
      setError(data.error_description || "Autorisierung fehlgeschlagen.");
      setBusy(false);
    } catch {
      setError("Autorisierung fehlgeschlagen.");
      setBusy(false);
    }
  }

  function deny() {
    const sep = props.redirectUri.includes("?") ? "&" : "?";
    const stateParam = props.state ? `&state=${encodeURIComponent(props.state)}` : "";
    window.location.href = `${props.redirectUri}${sep}error=access_denied${stateParam}`;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6 shadow-soft">
        <h1 className="text-2xl font-black mb-1">aido verbinden</h1>
        <p className="text-text-dim mb-6">
          <span className="font-semibold text-text">{appName}</span> möchte auf deine aido-Spaces
          zugreifen (Todos lesen &amp; schreiben).
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
            {error && <p className="text-sm text-danger mb-3">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={allow}
                disabled={busy}
                className="flex-1 rounded-full bg-accent px-4 py-2.5 font-extrabold text-white disabled:opacity-50"
              >
                {busy ? "…" : "Erlauben"}
              </button>
              <button
                onClick={deny}
                disabled={busy}
                className="flex-1 rounded-full border border-border px-4 py-2.5 font-semibold text-text-dim hover:text-text"
              >
                Ablehnen
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
