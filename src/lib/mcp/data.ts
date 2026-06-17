import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

// Firestore-backed data access for the MCP tools (issue #118, epic #124).
//
// IMPORTANT: the Admin SDK bypasses firestore.rules entirely, so every helper in
// this module must enforce the rules' constraints itself — membership of the
// space, immutable createdBy/author, waitingOn ∈ members, and the field shapes
// (issue #71). firestore.rules is the source of truth; keep this in parity.
//
// This is the foundation: McpToolError, the Admin DB accessor, and requireMember
// (the gate every per-user tool must pass). The read/write tool helpers
// (list-spaces, list-todos, add-todo, …) build on top of it in #119+.

// Error codes a tool helper can raise; the MCP tools/call dispatch maps these to
// JSON-RPC errors / MCP error content.
export type McpToolErrorCode = "unauthorized" | "not_found" | "invalid" | "unconfigured";

export class McpToolError extends Error {
  constructor(
    public readonly code: McpToolErrorCode,
    message: string
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

export interface SpaceData {
  id: string;
  name: string;
  color: number;
  members: string[];
  createdBy: string;
}

// Admin Firestore handle, or a clear error when the service account is missing.
// The feature degrades to a configuration error — never to something insecure.
export function requireDb(): Firestore {
  const db = getAdminDb();
  if (!db) {
    throw new McpToolError(
      "unconfigured",
      "MCP data access is not configured (FIREBASE_SERVICE_ACCOUNT_KEY missing)."
    );
  }
  return db;
}

// Loads a space and asserts the uid is a member — the gate every per-user tool
// must pass before reading or writing anything in the space. Mirrors the
// membership check in firestore.rules (which the Admin SDK does not enforce).
//
// Distinguishes a missing space (not_found) from a non-member (unauthorized) per
// the spec; the spaceId is an unguessable Firestore id, so this is not an
// enumeration risk.
export async function requireMember(uid: string, spaceId: string): Promise<SpaceData> {
  if (!uid) throw new McpToolError("invalid", "Missing user.");
  if (!spaceId) throw new McpToolError("invalid", "spaceId is required.");

  const db = requireDb();
  const snap = await db.collection("spaces").doc(spaceId).get();
  if (!snap.exists) {
    throw new McpToolError("not_found", `Space ${spaceId} not found.`);
  }

  const data = snap.data()!;
  const members: string[] = Array.isArray(data.members) ? data.members : [];
  if (!members.includes(uid)) {
    throw new McpToolError("unauthorized", "You are not a member of this space.");
  }

  return {
    id: snap.id,
    name: typeof data.name === "string" ? data.name : "",
    color: typeof data.color === "number" ? data.color : 0,
    members,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
  };
}
