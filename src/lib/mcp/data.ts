import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { deriveTags, deriveMentions, type MentionMember } from "@/lib/utils/textUtils";

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
export type McpToolErrorCode =
  | "unauthorized"
  | "not_found"
  | "invalid"
  | "unconfigured"
  | "rate_limited";

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

export interface DailyView {
  id: string;
  text: string;
  completed: boolean;
  date: string;
  author: string;
}

// Strict YYYY-MM-DD, matching the daily `date` regex in firestore.rules.
const DAILY_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Today's date as YYYY-MM-DD in UTC. The web client uses the browser's local
// date (firebaseUtils.todayString); server-side there is no user timezone, so
// UTC is the deterministic choice (a daily added near midnight may land on the
// caller's "yesterday/tomorrow" — acceptable for the tool).
function todayUtc(): string {
  const d = new Date();
  const month = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${d.getUTCDate()}`.padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${day}`;
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

function mapTodoView(doc: FirebaseFirestore.DocumentSnapshot): TodoView {
  const d = doc.data() ?? {};
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

// --- Writes (member-gated; mirror firestore.rules since the Admin SDK bypasses them) ---

// Loads space members' public display names so plain-text @mentions in a title
// can be resolved to uids (issue #76 parity), exactly like the web client.
async function loadMentionMembers(db: Firestore, memberUids: string[]): Promise<MentionMember[]> {
  if (memberUids.length === 0) return [];
  const refs = memberUids.map((uid) => db.collection("publicProfiles").doc(uid));
  const snaps = await db.getAll(...refs);
  return snaps.map((s) => ({
    uid: s.id,
    displayName: s.exists ? ((s.data()!.displayName as string | null) ?? null) : null,
  }));
}

// Minimal Tiptap doc wrapping a plain-text body, so an MCP-created todo renders
// in the web editor and its #tags/@mentions are picked up by the derivations.
function bodyFromText(text: string | undefined | null): Record<string, unknown> | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: trimmed }] }],
  };
}

export async function addTodo(
  uid: string,
  spaceId: string,
  input: { title: string; bodyText?: string | null; waitingOn?: string | null }
): Promise<TodoView> {
  const space = await requireMember(uid, spaceId);
  const title = (input.title ?? "").trim();
  if (!title) throw new McpToolError("invalid", "title is required.");

  const waitingOn = input.waitingOn ?? null;
  if (waitingOn !== null && !space.members.includes(waitingOn)) {
    throw new McpToolError("invalid", "waitingOn must be a member of the space.");
  }

  const db = requireDb();
  const todosCol = db.collection("spaces").doc(spaceId).collection("todos");
  const body = bodyFromText(input.bodyText);
  const members = await loadMentionMembers(db, space.members);

  const lastSnap = await todosCol.orderBy("order", "desc").limit(1).get();
  const maxOrder = lastSnap.empty
    ? 0
    : typeof lastSnap.docs[0].data().order === "number"
      ? (lastSnap.docs[0].data().order as number)
      : 0;

  const ref = await todosCol.add({
    spaceId,
    title,
    body,
    completed: false,
    waitingOn,
    tags: deriveTags(title, body),
    mentions: deriveMentions(body, title, members),
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    order: maxOrder + 1,
  });

  return mapTodoView(await ref.get());
}

export async function completeTodo(
  uid: string,
  spaceId: string,
  todoId: string,
  completed: boolean
): Promise<TodoView> {
  await requireMember(uid, spaceId);
  if (!todoId) throw new McpToolError("invalid", "todoId is required.");
  const db = requireDb();
  const ref = db.collection("spaces").doc(spaceId).collection("todos").doc(todoId);
  const snap = await ref.get();
  if (!snap.exists) throw new McpToolError("not_found", `Todo ${todoId} not found.`);
  await ref.update({ completed: !!completed });
  return mapTodoView(await ref.get());
}

export async function setWaitingOn(
  uid: string,
  spaceId: string,
  todoId: string,
  userId: string | null
): Promise<TodoView> {
  const space = await requireMember(uid, spaceId);
  if (!todoId) throw new McpToolError("invalid", "todoId is required.");
  if (userId !== null && !space.members.includes(userId)) {
    throw new McpToolError("invalid", "waitingOn must be a member of the space, or null.");
  }
  const db = requireDb();
  const ref = db.collection("spaces").doc(spaceId).collection("todos").doc(todoId);
  const snap = await ref.get();
  if (!snap.exists) throw new McpToolError("not_found", `Todo ${todoId} not found.`);
  await ref.update({ waitingOn: userId });
  return mapTodoView(await ref.get());
}

export async function deleteTodo(
  uid: string,
  spaceId: string,
  todoId: string
): Promise<{ id: string; deleted: boolean }> {
  await requireMember(uid, spaceId);
  if (!todoId) throw new McpToolError("invalid", "todoId is required.");
  const db = requireDb();
  const ref = db.collection("spaces").doc(spaceId).collection("todos").doc(todoId);
  const snap = await ref.get();
  if (!snap.exists) throw new McpToolError("not_found", `Todo ${todoId} not found.`);
  await ref.delete();
  return { id: todoId, deleted: true };
}

// --- Identity / members (issue #123) ---

export interface MemberView {
  uid: string;
  displayName: string | null;
}

// The key owner's identity: uid + public display name.
export async function whoami(uid: string): Promise<MemberView> {
  if (!uid) throw new McpToolError("invalid", "Missing user.");
  const db = requireDb();
  const snap = await db.collection("publicProfiles").doc(uid).get();
  return { uid, displayName: snap.exists ? ((snap.data()!.displayName as string | null) ?? null) : null };
}

// The members of a space (member-gated), with public display names — so a client
// can resolve uids for set-waiting-on / add-todo waitingOn.
export async function listMembers(uid: string, spaceId: string): Promise<MemberView[]> {
  const space = await requireMember(uid, spaceId);
  return loadMentionMembers(requireDb(), space.members);
}

// --- Daily "Heute" items (issue #121) ---

function mapDailyView(doc: FirebaseFirestore.DocumentSnapshot): DailyView {
  const d = doc.data() ?? {};
  return {
    id: doc.id,
    text: typeof d.text === "string" ? d.text : "",
    completed: d.completed === true,
    date: typeof d.date === "string" ? d.date : "",
    author: typeof d.author === "string" ? d.author : "",
  };
}

// Lists a space's daily items for a date (default: today UTC), oldest-first.
export async function listDaily(uid: string, spaceId: string, date?: string): Promise<DailyView[]> {
  await requireMember(uid, spaceId);
  const day = date ?? todayUtc();
  if (!DAILY_DATE_RE.test(day)) {
    throw new McpToolError("invalid", "date must be YYYY-MM-DD.");
  }
  const db = requireDb();
  const snap = await db
    .collection("spaces")
    .doc(spaceId)
    .collection("daily")
    .where("date", "==", day)
    .get();

  return snap.docs
    .map((d) => ({ createdAt: d.data().createdAt?.toMillis?.() ?? 0, view: mapDailyView(d) }))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => r.view);
}

// Adds a daily "Heute" item dated today (UTC). author=uid; mirrors the rules'
// field shape (text/completed/spaceId/date).
export async function addDaily(uid: string, spaceId: string, text: string): Promise<DailyView> {
  await requireMember(uid, spaceId);
  const trimmed = (text ?? "").trim();
  if (!trimmed) throw new McpToolError("invalid", "text is required.");

  const db = requireDb();
  const ref = await db.collection("spaces").doc(spaceId).collection("daily").add({
    spaceId,
    text: trimmed,
    completed: false,
    date: todayUtc(),
    author: uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return mapDailyView(await ref.get());
}
