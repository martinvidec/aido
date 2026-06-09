import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

// Guards the MCP endpoint with a shared secret (MCP_AUTH_TOKEN).
// Returns null if the request is authorized, otherwise the error response.
// Without a configured token all requests are rejected — no open default.
export function requireMcpAuth(req: NextRequest): NextResponse | null {
    const expected = process.env.MCP_AUTH_TOKEN;
    if (!expected) {
        console.error("MCP_AUTH_TOKEN is not configured; rejecting MCP request.");
        return NextResponse.json({ error: "MCP endpoint is not configured" }, { status: 503 });
    }

    const header = req.headers.get("authorization") ?? "";
    const match = header.match(/^Bearer (.+)$/i);
    if (match) {
        const provided = Buffer.from(match[1]);
        const secret = Buffer.from(expected);
        if (provided.length === secret.length && timingSafeEqual(provided, secret)) {
            return null;
        }
    }

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
