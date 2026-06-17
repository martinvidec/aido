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

export interface SpaceSummary {
  id: string;
  name: string;
  color: number;
  memberCount: number;
  openTodoCount: number;
}

export interface TodoView {
  id: string;
  title: string;
  completed: boolean;
  waitingOn: string | null;
  tags: string[];
  order: number;
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

// Lists the spaces the uid is a member of, with member and open-todo counts.
// array-contains + orderBy would need a composite index, so (like the client's
// getSpacesForUser) it sorts oldest-first in memory. Open counts use Firestore
// aggregate count() — no full todo scan.
export async function listSpacesForUid(uid: string): Promise<SpaceSummary[]> {
  if (!uid) throw new McpToolError("invalid", "Missing user.");
  const db = requireDb();
  const snap = await db.collection("spaces").where("members", "array-contains", uid).get();

  const rows = await Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data();
      const members: string[] = Array.isArray(data.members) ? data.members : [];
      const countSnap = await doc.ref.collection("todos").where("completed", "==", false).count().get();
      return {
        createdAt: data.createdAt?.toMillis?.() ?? 0,
        summary: {
          id: doc.id,
          name: typeof data.name === "string" ? data.name : "",
          color: typeof data.color === "number" ? data.color : 0,
          memberCount: members.length,
          openTodoCount: countSnap.data().count,
        } as SpaceSummary,
      };
    })
  );

  return rows.sort((a, b) => a.createdAt - b.createdAt).map((r) => r.summary);
}

function mapTodoView(doc: FirebaseFirestore.QueryDocumentSnapshot): TodoView {
  const d = doc.data();
  return {
    id: doc.id,
    title: typeof d.title === "string" ? d.title : "",
    completed: d.completed === true,
    waitingOn: typeof d.waitingOn === "string" ? d.waitingOn : null,
    tags: Array.isArray(d.tags) ? d.tags : [],
    order: typeof d.order === "number" ? d.order : 0,
  };
}

// Lists a space's todos (member-gated), sorted by `order` like the web list.
// `includeCompleted` defaults to true; `tag` filters case-insensitively (with or
// without a leading '#').
export async function listTodos(
  uid: string,
  spaceId: string,
  opts: { includeCompleted?: boolean; tag?: string } = {}
): Promise<TodoView[]> {
  await requireMember(uid, spaceId);
  const db = requireDb();
  const snap = await db
    .collection("spaces")
    .doc(spaceId)
    .collection("todos")
    .orderBy("order", "asc")
    .get();

  let todos = snap.docs.map(mapTodoView);
  if (opts.includeCompleted === false) {
    todos = todos.filter((t) => !t.completed);
  }
  if (opts.tag) {
    const tag = opts.tag.replace(/^#/, "").toLowerCase();
    todos = todos.filter((t) => t.tags.some((x) => x.toLowerCase() === tag));
  }
  return todos;
}
