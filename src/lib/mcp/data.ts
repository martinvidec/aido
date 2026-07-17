import "server-only";
import { createHash } from "node:crypto";
import { FieldValue, type Timestamp, type Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { deriveTags, deriveMentions, extractPlainText, type MentionMember } from "@/lib/utils/textUtils";
import { markdownToTiptap, tiptapToMarkdown, appendAnswer } from "@/lib/tiptap/markdown";
import type { AgentToolName } from "@/lib/types";

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
    modifiedBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    order: maxOrder + 1,
  });

  return mapTodoView(await ref.get());
}

// When `sessionId` is given (the agent loop completing its claimed todo, issue
// #215), completion is additionally scoped to that session's claim + allowlist
// and clears the claim. Without it, behaviour is unchanged (member-gated).
export async function completeTodo(
  uid: string,
  spaceId: string,
  todoId: string,
  completed: boolean,
  sessionId?: string
): Promise<TodoView> {
  await requireMember(uid, spaceId);
  if (!todoId) throw new McpToolError("invalid", "todoId is required.");
  const db = requireDb();
  const ref = db.collection("spaces").doc(spaceId).collection("todos").doc(todoId);
  const snap = await ref.get();
  if (!snap.exists) throw new McpToolError("not_found", `Todo ${todoId} not found.`);

  const update: Record<string, unknown> = { completed: !!completed, modifiedBy: uid };
  if (sessionId) {
    const session = await requireSession(uid, sessionId);
    if (session.spaceId !== spaceId) throw new McpToolError("invalid", "spaceId does not match the session.");
    assertToolAllowed(session, "complete-todo");
    requireClaim(snap.data()!, sessionId, session.leaseTtlSeconds);
  }
  if (completed) {
    // A completed todo is no longer assigned to any session — release the binding
    // so it doesn't keep showing as "in Arbeit"/"bei aido" in the UI.
    update.attachedSession = null;
    update.aidoTurn = null;
    update.claimedBy = null;
    update.claimedAt = null;
  }
  await ref.update(update);
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
  await ref.update({ waitingOn: userId, modifiedBy: uid });
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

// --- Agent-Sessions (epic #212, issue #215) ---
//
// A session is bound to ONE space and stored owner-only at
// users/{uid}/sessions/{sessionId}. The id is derived deterministically from
// (spaceId, hostname, workingFolder) so any later MCP call can re-derive it from
// the environment — the server stays stateless. The agent loop: register-session
// → next-todo (claim, lease) → update-todo / handoff / complete-todo. Wirkung is
// bounded by (1) scope to the claimed todo and (2) the per-session allowlist.

const DEFAULT_ALLOWED_TOOLS: AgentToolName[] = ["update-todo", "handoff", "post-message"];
const ALL_AGENT_TOOLS: AgentToolName[] = ["update-todo", "handoff", "complete-todo", "post-message"];
const DEFAULT_LEASE_TTL_SECONDS = 600;

export interface SessionData {
  id: string;
  spaceId: string;
  hostname: string;
  workingFolder: string;
  label: string | null;
  allowedTools: AgentToolName[];
  leaseTtlSeconds: number;
}

export interface SessionSummary {
  sessionId: string;
  spaceId: string;
  allowedTools: AgentToolName[];
  leaseTtlSeconds: number;
}

export interface ClaimedTodo {
  spaceId: string;
  todoId: string;
  title: string;
  bodyMarkdown: string;
  body: Record<string, unknown> | null;
  tags: string[];
  createdBy: string;
  aidoTurn: "aido" | "user" | null;
  /** The todo's discussion thread as Markdown (epic #247); "" when empty. */
  thread: string;
}

export interface SessionTodoView extends TodoView {
  attachedSession: string | null;
  aidoTurn: "aido" | "user" | null;
}

function sessionIdFor(spaceId: string, hostname: string, workingFolder: string): string {
  return createHash("sha256").update(`${spaceId}\n${hostname}\n${workingFolder}`).digest("hex");
}

function sanitizeTools(tools: unknown): AgentToolName[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  return ALL_AGENT_TOOLS.filter((t) => tools.includes(t));
}

async function getUserLeaseDefault(db: Firestore, uid: string): Promise<number> {
  const snap = await db.collection("users").doc(uid).get();
  const v = snap.exists ? (snap.data()?.agentSessionDefaults?.leaseTtlSeconds as unknown) : undefined;
  return typeof v === "number" && v > 0 ? v : DEFAULT_LEASE_TTL_SECONDS;
}

function mapSession(doc: FirebaseFirestore.DocumentSnapshot): SessionData {
  const d = doc.data() ?? {};
  return {
    id: doc.id,
    spaceId: typeof d.spaceId === "string" ? d.spaceId : "",
    hostname: typeof d.hostname === "string" ? d.hostname : "",
    workingFolder: typeof d.workingFolder === "string" ? d.workingFolder : "",
    label: typeof d.label === "string" ? d.label : null,
    allowedTools: sanitizeTools(d.allowedTools) ?? DEFAULT_ALLOWED_TOOLS,
    leaseTtlSeconds: typeof d.leaseTtlSeconds === "number" ? d.leaseTtlSeconds : DEFAULT_LEASE_TTL_SECONDS,
  };
}

// Loads the session (member of its space already implied at registration; the
// per-call requireMember in the tools re-checks live membership).
async function requireSession(uid: string, sessionId: string): Promise<SessionData> {
  if (!sessionId) throw new McpToolError("invalid", "sessionId is required.");
  const db = requireDb();
  const snap = await db.collection("users").doc(uid).collection("sessions").doc(sessionId).get();
  if (!snap.exists) throw new McpToolError("not_found", "Unknown session; call register-session first.");
  return mapSession(snap);
}

function assertToolAllowed(session: SessionData, tool: AgentToolName): void {
  if (!session.allowedTools.includes(tool)) {
    throw new McpToolError("unauthorized", `Tool '${tool}' is not allowed for this session.`);
  }
}

function leaseValid(claimedAt: unknown, leaseTtlSeconds: number, nowMs: number): boolean {
  const ms = (claimedAt as Timestamp | null)?.toMillis?.();
  return typeof ms === "number" && ms + leaseTtlSeconds * 1000 > nowMs;
}

// Scope gate for the mutating session tools: the todo must be attached to AND
// currently claimed (valid lease) by the calling session — so a malicious todo
// body cannot make the loop touch any OTHER todo (issue #215, FA-17).
function requireClaim(d: FirebaseFirestore.DocumentData, sessionId: string, leaseTtlSeconds: number): void {
  if (d.attachedSession !== sessionId) {
    throw new McpToolError("unauthorized", "This todo is not attached to your session.");
  }
  if (d.claimedBy !== sessionId || !leaseValid(d.claimedAt, leaseTtlSeconds, Date.now())) {
    throw new McpToolError("unauthorized", "This todo is not claimed by your session (claim expired?). Call next-todo first.");
  }
}

function mapSessionTodoView(doc: FirebaseFirestore.DocumentSnapshot): SessionTodoView {
  const base = mapTodoView(doc);
  const d = doc.data() ?? {};
  return {
    ...base,
    attachedSession: typeof d.attachedSession === "string" ? d.attachedSession : null,
    aidoTurn: d.aidoTurn === "aido" || d.aidoTurn === "user" ? d.aidoTurn : null,
  };
}

// Serializes a todo's discussion thread to Markdown for the agent (epic #247):
// one block per message, prefixed with the author (display name; "aido" for
// session-authored messages). Empty string when there are no messages.
async function loadThreadMarkdown(
  db: Firestore,
  spaceId: string,
  todoId: string,
  memberUids: string[]
): Promise<string> {
  const snap = await db
    .collection("spaces").doc(spaceId).collection("todos").doc(todoId)
    .collection("messages").orderBy("createdAt", "asc").get();
  if (snap.empty) return "";
  const members = await loadMentionMembers(db, memberUids);
  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.displayName ?? uid;
  return snap.docs
    .map((doc) => {
      const d = doc.data();
      const body = (d.body ?? null) as Record<string, unknown> | null;
      const who = d.source === "aido" ? "aido" : nameOf(typeof d.author === "string" ? d.author : "");
      const md = tiptapToMarkdown(body) || (typeof d.text === "string" ? d.text : "");
      return `**${who}:** ${md}`;
    })
    .join("\n\n");
}

// Builds the ClaimedTodo returned by next-todo, including the discussion thread
// (epic #247) so the agent has the conversation context on pickup.
async function buildClaimedTodo(
  db: Firestore,
  spaceId: string,
  todoId: string,
  d: FirebaseFirestore.DocumentData,
  memberUids: string[]
): Promise<ClaimedTodo> {
  const body = (d.body ?? null) as Record<string, unknown> | null;
  return {
    spaceId,
    todoId,
    title: typeof d.title === "string" ? d.title : "",
    bodyMarkdown: tiptapToMarkdown(body),
    body,
    tags: Array.isArray(d.tags) ? d.tags : [],
    createdBy: typeof d.createdBy === "string" ? d.createdBy : "",
    aidoTurn: d.aidoTurn === "aido" || d.aidoTurn === "user" ? d.aidoTurn : null,
    thread: await loadThreadMarkdown(db, spaceId, todoId, memberUids),
  };
}

// Upsert a space-bound session. First registration sets defaults; later calls
// refresh lastSeenAt and may update label/allowedTools.
export async function registerSession(
  uid: string,
  input: { spaceId: string; hostname: string; workingFolder: string; label?: string | null; allowedTools?: string[] }
): Promise<SessionSummary> {
  const hostname = (input.hostname ?? "").trim();
  const workingFolder = (input.workingFolder ?? "").trim();
  if (!hostname) throw new McpToolError("invalid", "hostname is required.");
  if (!workingFolder) throw new McpToolError("invalid", "workingFolder is required.");
  await requireMember(uid, input.spaceId);

  const db = requireDb();
  const sessionId = sessionIdFor(input.spaceId, hostname, workingFolder);
  const ref = db.collection("users").doc(uid).collection("sessions").doc(sessionId);
  const snap = await ref.get();

  if (!snap.exists) {
    const allowedTools = sanitizeTools(input.allowedTools) ?? DEFAULT_ALLOWED_TOOLS;
    const leaseTtlSeconds = await getUserLeaseDefault(db, uid);
    await ref.set({
      spaceId: input.spaceId,
      hostname,
      workingFolder,
      label: input.label ?? null,
      allowedTools,
      leaseTtlSeconds,
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    });
    return { sessionId, spaceId: input.spaceId, allowedTools, leaseTtlSeconds };
  }

  const update: Record<string, unknown> = { lastSeenAt: FieldValue.serverTimestamp() };
  if (input.label !== undefined) update.label = input.label;
  const tools = sanitizeTools(input.allowedTools);
  if (tools !== undefined) update.allowedTools = tools;
  await ref.set(update, { merge: true });

  const merged = mapSession(await ref.get());
  return {
    sessionId,
    spaceId: merged.spaceId,
    allowedTools: merged.allowedTools,
    leaseTtlSeconds: merged.leaseTtlSeconds,
  };
}

// Claims and returns the next open todo bound to the caller's session, or null.
// "Next" follows the manual list order (`order` asc, createdAt as tiebreak,
// issue #243) so the agent works todos in the sequence the user arranged in the
// web UI — matching list-todos. Per-space query (no collection-group); the claim
// is taken in a transaction so two concurrent calls can't grab the same todo.
export async function nextTodo(
  uid: string,
  input: { spaceId: string; hostname: string; workingFolder: string }
): Promise<ClaimedTodo | null> {
  const space = await requireMember(uid, input.spaceId);
  const sessionId = sessionIdFor(input.spaceId, (input.hostname ?? "").trim(), (input.workingFolder ?? "").trim());
  const session = await requireSession(uid, sessionId);

  const db = requireDb();
  // Heartbeat — best-effort, must not fail the call.
  db.collection("users").doc(uid).collection("sessions").doc(sessionId)
    .update({ lastSeenAt: FieldValue.serverTimestamp() })
    .catch(() => {});

  const todosCol = db.collection("spaces").doc(input.spaceId).collection("todos");
  const snap = await todosCol.where("attachedSession", "==", sessionId).get();
  const nowMs = Date.now();
  const leaseTtl = session.leaseTtlSeconds;

  const open = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        order: typeof data.order === "number" ? data.order : 0,
        createdAt: data.createdAt?.toMillis?.() ?? 0,
        d: data,
      };
    })
    .filter((r) => r.d.completed !== true && r.d.aidoTurn === "aido");

  // Manual list order (issue #243): lowest `order` first, createdAt as tiebreak.
  const byOrder = (a: { order: number; createdAt: number }, b: { order: number; createdAt: number }) =>
    a.order - b.order || a.createdAt - b.createdAt;

  // Already claimed by this session → return it (idempotent within a lease).
  const selfClaimed = open
    .filter((r) => r.d.claimedBy === sessionId && leaseValid(r.d.claimedAt, leaseTtl, nowMs))
    .sort(byOrder);
  if (selfClaimed.length) {
    return buildClaimedTodo(db, input.spaceId, selfClaimed[0].id, selfClaimed[0].d, space.members);
  }

  const free = open
    .filter((r) => !r.d.claimedBy || !leaseValid(r.d.claimedAt, leaseTtl, nowMs))
    .sort(byOrder);

  for (const row of free) {
    const ref = todosCol.doc(row.id);
    let claimed = false;
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists) return;
        const d = fresh.data()!;
        if (d.completed === true || d.aidoTurn !== "aido" || d.attachedSession !== sessionId) return;
        if (d.claimedBy && d.claimedBy !== sessionId && leaseValid(d.claimedAt, leaseTtl, nowMs)) return;
        tx.update(ref, { claimedBy: sessionId, claimedAt: FieldValue.serverTimestamp(), modifiedBy: uid });
        claimed = true;
      });
    } catch {
      claimed = false;
    }
    if (claimed) {
      return buildClaimedTodo(db, input.spaceId, row.id, (await ref.get()).data()!, space.members);
    }
  }
  return null;
}

// Writes the RESULT into the todo body from Markdown (replace default / append).
// The member<->aido conversation (questions, rework) belongs in the discussion
// thread (post-message), NOT the body (epic #247) — so 'replace' is the default:
// the body holds the current result, not an ever-growing Q&A. Scoped to the
// claimed todo + allowlist; re-derives tags/mentions; never auto-hands-off.
export async function updateTodo(
  uid: string,
  input: { sessionId: string; spaceId: string; todoId: string; bodyMarkdown: string; mode?: "append" | "replace" }
): Promise<SessionTodoView> {
  const session = await requireSession(uid, input.sessionId);
  if (session.spaceId !== input.spaceId) throw new McpToolError("invalid", "spaceId does not match the session.");
  assertToolAllowed(session, "update-todo");
  const space = await requireMember(uid, input.spaceId);
  if (!input.todoId) throw new McpToolError("invalid", "todoId is required.");

  const db = requireDb();
  const ref = db.collection("spaces").doc(input.spaceId).collection("todos").doc(input.todoId);
  const snap = await ref.get();
  if (!snap.exists) throw new McpToolError("not_found", `Todo ${input.todoId} not found.`);
  requireClaim(snap.data()!, input.sessionId, session.leaseTtlSeconds);

  const existingBody = (snap.data()!.body ?? null) as Record<string, unknown> | null;
  const mode = input.mode ?? "replace";
  const newBody =
    mode === "replace"
      ? markdownToTiptap(input.bodyMarkdown)
      : appendAnswer(existingBody, input.bodyMarkdown, { at: new Date() });

  const title = typeof snap.data()!.title === "string" ? (snap.data()!.title as string) : "";
  const members = await loadMentionMembers(db, space.members);
  await ref.update({
    body: newBody,
    tags: deriveTags(title, newBody),
    mentions: deriveMentions(newBody, title, members),
    modifiedBy: uid,
    lastAidoEditAt: FieldValue.serverTimestamp(),
  });
  return mapSessionTodoView(await ref.get());
}

// Hands the todo back to the human: leaves it OPEN but releases the session
// binding (no longer assigned). To have the agent work it again, re-attach it.
export async function handoffTodo(
  uid: string,
  input: { sessionId: string; spaceId: string; todoId: string }
): Promise<SessionTodoView> {
  const session = await requireSession(uid, input.sessionId);
  if (session.spaceId !== input.spaceId) throw new McpToolError("invalid", "spaceId does not match the session.");
  assertToolAllowed(session, "handoff");
  await requireMember(uid, input.spaceId);
  if (!input.todoId) throw new McpToolError("invalid", "todoId is required.");

  const db = requireDb();
  const ref = db.collection("spaces").doc(input.spaceId).collection("todos").doc(input.todoId);
  const snap = await ref.get();
  if (!snap.exists) throw new McpToolError("not_found", `Todo ${input.todoId} not found.`);
  requireClaim(snap.data()!, input.sessionId, session.leaseTtlSeconds);

  await ref.update({ attachedSession: null, aidoTurn: null, claimedBy: null, claimedAt: null, modifiedBy: uid });
  return mapSessionTodoView(await ref.get());
}

// --- Thread messages per todo (epic #247) ---
//
// A discussion thread lives under spaces/{spaceId}/todos/{todoId}/messages,
// separate from the todo body so the member<->aido back-and-forth (questions,
// rework) stays out of the task itself. Members read/post via the client SDK
// (firestore.rules); an agent session posts through post-message below, scoped to
// its claimed todo (like update-todo) and gated by the 'post-message' allowlist.

export interface ThreadMessageView {
  id: string;
  author: string;
  authorName: string | null;
  source: "user" | "aido";
  markdown: string;
  /** ISO 8601, or null while a serverTimestamp() write is still pending. */
  createdAt: string | null;
}

function mapThreadMessageView(
  doc: FirebaseFirestore.DocumentSnapshot,
  nameOf: (uid: string) => string | null
): ThreadMessageView {
  const d = doc.data() ?? {};
  const body = (d.body ?? null) as Record<string, unknown> | null;
  const author = typeof d.author === "string" ? d.author : "";
  return {
    id: doc.id,
    author,
    authorName: nameOf(author),
    source: d.source === "aido" ? "aido" : "user",
    markdown: tiptapToMarkdown(body) || (typeof d.text === "string" ? d.text : ""),
    createdAt: (d.createdAt as Timestamp | null)?.toDate?.().toISOString?.() ?? null,
  };
}

// Lists a todo's discussion thread (member-gated), oldest-first, each message as
// Markdown with its author's display name.
export async function listMessages(
  uid: string,
  spaceId: string,
  todoId: string
): Promise<ThreadMessageView[]> {
  const space = await requireMember(uid, spaceId);
  if (!todoId) throw new McpToolError("invalid", "todoId is required.");
  const db = requireDb();
  const snap = await db
    .collection("spaces").doc(spaceId).collection("todos").doc(todoId)
    .collection("messages").orderBy("createdAt", "asc").get();
  const members = await loadMentionMembers(db, space.members);
  const nameOf = (u: string) => members.find((m) => m.uid === u)?.displayName ?? null;
  return snap.docs.map((doc) => mapThreadMessageView(doc, nameOf));
}

// Posts an aido message into a todo's discussion thread (epic #247). Scoped to
// the session's claimed todo (like update-todo) and gated by the 'post-message'
// allowlist entry; source='aido'. Keeps the conversation OUT of the todo body.
export async function postMessage(
  uid: string,
  input: { sessionId: string; spaceId: string; todoId: string; bodyMarkdown: string }
): Promise<ThreadMessageView> {
  const session = await requireSession(uid, input.sessionId);
  if (session.spaceId !== input.spaceId) throw new McpToolError("invalid", "spaceId does not match the session.");
  assertToolAllowed(session, "post-message");
  const space = await requireMember(uid, input.spaceId);
  if (!input.todoId) throw new McpToolError("invalid", "todoId is required.");
  if (!(input.bodyMarkdown ?? "").trim()) throw new McpToolError("invalid", "bodyMarkdown is required.");

  const db = requireDb();
  const todoRef = db.collection("spaces").doc(input.spaceId).collection("todos").doc(input.todoId);
  const todoSnap = await todoRef.get();
  if (!todoSnap.exists) throw new McpToolError("not_found", `Todo ${input.todoId} not found.`);
  requireClaim(todoSnap.data()!, input.sessionId, session.leaseTtlSeconds);

  const body = markdownToTiptap(input.bodyMarkdown);
  const ref = await todoRef.collection("messages").add({
    body,
    text: extractPlainText(body).trim(),
    tags: deriveTags("", body),
    mentions: deriveMentions(body),
    author: uid,
    source: "aido",
    sessionId: input.sessionId,
    createdAt: FieldValue.serverTimestamp(),
  });

  const members = await loadMentionMembers(db, space.members);
  const nameOf = (u: string) => members.find((m) => m.uid === u)?.displayName ?? null;
  return mapThreadMessageView(await ref.get(), nameOf);
}
