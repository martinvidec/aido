import { getClient } from "@/lib/oauth/store";
import { OAUTH } from "@/lib/oauth/config";
import ConsentForm from "./ConsentForm";

// OAuth authorization endpoint (issue #153) — a server-validated consent page.
// Validates the request (client, redirect_uri, response_type, PKCE) server-side
// before rendering, then hands the safe params to the client consent component.

export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function AuthorizeError({ message }: { message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold mb-2">aido — Verbindung nicht möglich</h1>
        <p className="text-text-dim">{message}</p>
      </div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const clientId = first(sp.client_id);
  const redirectUri = first(sp.redirect_uri);
  const responseType = first(sp.response_type);
  const codeChallenge = first(sp.code_challenge);
  const codeChallengeMethod = first(sp.code_challenge_method);
  const state = first(sp.state);
  const scope = first(sp.scope) || OAUTH.scope;

  if (responseType !== "code") {
    return <AuthorizeError message="Nicht unterstützter response_type (erwartet: code)." />;
  }
  if (codeChallengeMethod !== "S256" || !codeChallenge) {
    return <AuthorizeError message="PKCE mit S256 ist erforderlich." />;
  }

  const client = await getClient(clientId).catch(() => null);
  if (!client) {
    return <AuthorizeError message="Unbekannter oder ungültiger Client." />;
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return <AuthorizeError message="Die redirect_uri ist für diesen Client nicht registriert." />;
  }

  return (
    <ConsentForm
      clientName={client.clientName}
      clientId={clientId}
      redirectUri={redirectUri}
      codeChallenge={codeChallenge}
      state={state}
      scope={scope}
    />
  );
}
