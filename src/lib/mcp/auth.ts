import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { API_KEYS_COLLECTION, hashApiKey, looksLikeApiKey } from "@/lib/apiKeys";

// Guards the MCP endpoint. Two accepted credentials:
// 1. the shared secret MCP_AUTH_TOKEN (ops/back-compat)
// 2. a personal API key (aido_…, issue #21) — verified by SHA-256 hash
//    lookup in userApiKeys via the Admin SDK
// Returns null if the request is authorized, otherwise the error response.
// With neither mechanism configured all requests are rejected.

function matchesSharedSecret(provided: string): boolean {
    const expected = process.env.MCP_AUTH_TOKEN;
    if (!expected) return false;
    const providedBuf = Buffer.from(provided);
    const secretBuf = Buffer.from(expected);
    return providedBuf.length === secretBuf.length && timingSafeEqual(providedBuf, secretBuf);
}

async function matchesPersonalApiKey(provided: string): Promise<boolean> {
    if (!looksLikeApiKey(provided)) return false;
    const db = getAdminDb();
    if (!db) return false;

    const snapshot = await db
        .collection(API_KEYS_COLLECTION)
        .where("keyHash", "==", hashApiKey(provided))
        .limit(1)
        .get();
    if (snapshot.empty) return false;

    // Best-effort usage timestamp; auth must not fail on a metadata write.
    snapshot.docs[0].ref
        .update({ lastUsedAt: FieldValue.serverTimestamp() })
        .catch(() => {});
    return true;
}

export async function requireMcpAuth(req: NextRequest): Promise<NextResponse | null> {
    if (!process.env.MCP_AUTH_TOKEN && !getAdminDb()) {
        console.error("Neither MCP_AUTH_TOKEN nor Firebase Admin is configured; rejecting MCP request.");
        return NextResponse.json({ error: "MCP endpoint is not configured" }, { status: 503 });
    }

    const header = req.headers.get("authorization") ?? "";
    const match = header.match(/^Bearer (.+)$/i);
    if (match) {
        const provided = match[1];
        if (matchesSharedSecret(provided)) return null;
        if (await matchesPersonalApiKey(provided)) return null;
    }

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
