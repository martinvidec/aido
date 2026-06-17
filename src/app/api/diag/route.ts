import { NextResponse } from "next/server";

// TEMPORARY diagnostic (issue #132): reports the runtime Node version and whether
// firebase-admin's firestore/auth modules load — to pinpoint the prod 500 on the
// MCP/api-key routes. Loads via dynamic import + try/catch so it never 500s and
// surfaces the actual error. Returns no secret values (only presence booleans).
// Remove once the 500 is resolved.

export const dynamic = "force-dynamic";

export async function GET() {
  const out: Record<string, unknown> = {
    node: process.version,
    nextRuntime: process.env.NEXT_RUNTIME ?? null,
    hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
    hasMcpToken: !!process.env.MCP_AUTH_TOKEN,
  };
  try {
    await import("firebase-admin/firestore");
    out.firestore = "ok";
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    out.firestore = `${err.code ?? ""} ${err.message ?? String(e)}`.slice(0, 400);
  }
  try {
    await import("firebase-admin/auth");
    out.auth = "ok";
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    out.auth = `${err.code ?? ""} ${err.message ?? String(e)}`.slice(0, 400);
  }
  return NextResponse.json(out);
}
