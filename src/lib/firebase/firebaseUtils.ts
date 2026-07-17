import { auth, db } from "./firebase";
import {
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
  query,
  where,
  serverTimestamp,
  writeBatch,
  runTransaction,
  limit,
  orderBy,
  arrayUnion,
  arrayRemove,
  getCountFromServer,
  onSnapshot,
  type Unsubscribe,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { getSpaceColor } from "../theme/colors";
import { deriveTags, deriveMentions, extractPlainText, type MentionMember } from "../utils/textUtils";
import { ORDER_STEP } from "../utils/order";
import type { Space, Todo, Daily, ThreadMessage, TiptapContent, AgentSession, AgentToolName } from "../types";
// Auth functions
export const logoutUser = () => signOut(auth);

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

// --- Spaces (issue #40) ---
// Top-level `spaces/{spaceId}`; membership grants full access. Rights model
// (see firestore.rules): any member may read/update (rename, recolor, add/remove
// members — the "+ einladen" flow); createdBy/createdAt are immutable; only the
// creator may delete the space.

const SPACES_COLLECTION = "spaces";

// Create a space with the creator as the first member. The caller picks the
// palette hue (see SpacesContext.createSpace) — passing an explicit color avoids
// the race where deriving it from a stale space count gave two quickly-created
// spaces the same color (issue #78). Falls back to the first palette hue.
export const createSpace = async (
  uid: string,
  name: string,
  colorHue: number = getSpaceColor(0).hue
): Promise<string> => {
  if (!uid) throw new Error("User not authenticated.");
  const ref = await addDoc(collection(db, SPACES_COLLECTION), {
    name: name.trim(),
    color: colorHue,
    members: [uid],
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

const mapSpace = (d: QueryDocumentSnapshot<DocumentData>): Space => {
  const data = d.data();
  return {
    id: d.id,
    name: typeof data.name === "string" ? data.name : "",
    color: typeof data.color === "number" ? data.color : getSpaceColor(0).hue,
    members: Array.isArray(data.members) ? data.members : [],
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: data.createdAt ?? null,
  } as Space;
};

// array-contains + orderBy would require a composite index, so sort client-side.
const sortSpaces = (spaces: Space[]): Space[] =>
  spaces.sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));

const spacesForUserQuery = (uid: string) =>
  query(collection(db, SPACES_COLLECTION), where("members", "array-contains", uid));

// Load every space the user is a member of (oldest first, for stable ordering).
export const getSpacesForUser = async (uid: string): Promise<Space[]> => {
  if (!uid) return [];
  const snapshot = await getDocs(spacesForUserQuery(uid));
  return sortSpaces(snapshot.docs.map(mapSpace));
};

// Live subscription to the user's spaces (issue #72): returns an unsubscribe
// function. Fires immediately with the current set, then on every change.
export const subscribeSpacesForUser = (
  uid: string,
  onChange: (spaces: Space[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    spacesForUserQuery(uid),
    (snap) => onChange(sortSpaces(snap.docs.map(mapSpace))),
    onError
  );

export const renameSpace = (spaceId: string, name: string) =>
  updateDoc(doc(db, SPACES_COLLECTION, spaceId), { name: name.trim() });

export const addSpaceMember = (spaceId: string, uid: string) =>
  updateDoc(doc(db, SPACES_COLLECTION, spaceId), { members: arrayUnion(uid) });

// Removing a member also clears any todos in the space that were waiting on
// them. Otherwise such a todo keeps a `waitingOn` pointing at a non-member, and
// firestore.rules' hasValidWaitingOn() then rejects EVERY subsequent update —
// the todo can no longer be completed or edited, only deleted (issue #63). Done
// as one atomic batch so there is never a window where the member is gone but
// the dangling references remain.
export const removeSpaceMember = async (
  spaceId: string,
  uid: string,
  actorUid: string
) => {
  const stranded = await getDocs(
    query(todosCol(spaceId), where("waitingOn", "==", uid))
  );
  const batch = writeBatch(db);
  batch.update(doc(db, SPACES_COLLECTION, spaceId), { members: arrayRemove(uid) });
  // Clearing the dangling waitingOn is a todo update, so it must carry the actor
  // as modifiedBy to satisfy the rules' `modifiedBy == auth.uid` check (#198).
  stranded.forEach((d) => batch.update(d.ref, { waitingOn: null, modifiedBy: actorUid }));
  await batch.commit();
};

// Only the creator may delete (enforced by firestore.rules).
export const deleteSpace = (spaceId: string) =>
  deleteDoc(doc(db, SPACES_COLLECTION, spaceId));

// --- Todos (space-scoped, issue #41) ---
// Decision: todos live under spaces/{spaceId}/todos (moved out of
// users/{uid}/todos) so every space member has full read/write access — see
// firestore.rules. tags/mentions are derived from title/body on every write.

const todosCol = (spaceId: string) =>
  collection(db, SPACES_COLLECTION, spaceId, "todos");
const todoRef = (spaceId: string, todoId: string) =>
  doc(db, SPACES_COLLECTION, spaceId, "todos", todoId);

const mapTodo = (d: QueryDocumentSnapshot<DocumentData>): Todo => {
  const data = d.data();
  return {
    id: d.id,
    spaceId: typeof data.spaceId === "string" ? data.spaceId : "",
    title: typeof data.title === "string" ? data.title : "",
    body: (data.body as TiptapContent | null) ?? null,
    completed: data.completed === true,
    waitingOn: typeof data.waitingOn === "string" ? data.waitingOn : null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    mentions: Array.isArray(data.mentions) ? data.mentions : [],
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    // Legacy todos (pre-#198) carry no modifiedBy; fall back to createdBy so the
    // field is always populated for the UI and the rules' merge-update checks.
    modifiedBy:
      typeof data.modifiedBy === "string"
        ? data.modifiedBy
        : typeof data.createdBy === "string"
          ? data.createdBy
          : "",
    createdAt: data.createdAt ?? null,
    order: typeof data.order === "number" ? data.order : 0,
    // Agent-Sessions (epic #212): absent on todos that were never bound.
    attachedSession:
      typeof data.attachedSession === "string" ? data.attachedSession : null,
    aidoTurn:
      data.aidoTurn === "aido" || data.aidoTurn === "user" ? data.aidoTurn : null,
    claimedBy: typeof data.claimedBy === "string" ? data.claimedBy : null,
    claimedAt: data.claimedAt ?? null,
    lastAidoEditAt: data.lastAidoEditAt ?? null,
  };
};

export const createTodo = async (
  spaceId: string,
  uid: string,
  input: {
    title: string;
    body?: TiptapContent | null;
    waitingOn?: string | null;
    order?: number;
    // Space members for resolving plain-text @mentions in the title (issue #76).
    mentionMembers?: MentionMember[];
  }
): Promise<string> => {
  if (!spaceId || !uid) throw new Error("Missing space or user.");
  const body = input.body ?? null;
  const ref = await addDoc(todosCol(spaceId), {
    spaceId,
    title: input.title.trim(),
    body,
    completed: false,
    waitingOn: input.waitingOn ?? null,
    tags: deriveTags(input.title, body),
    mentions: deriveMentions(body, input.title, input.mentionMembers),
    createdBy: uid,
    modifiedBy: uid,
    createdAt: serverTimestamp(),
    order: input.order ?? 0,
  });
  return ref.id;
};

export const getTodosForSpace = async (spaceId: string): Promise<Todo[]> => {
  if (!spaceId) return [];
  const snapshot = await getDocs(query(todosCol(spaceId), orderBy("order", "asc")));
  return snapshot.docs.map(mapTodo);
};

// Live subscription to a space's todos (issue #72): returns an unsubscribe
// function and fires on every change so collaborators see edits in real time.
export const subscribeTodosForSpace = (
  spaceId: string,
  onChange: (todos: Todo[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(todosCol(spaceId), orderBy("order", "asc")),
    (snap) => onChange(snap.docs.map(mapTodo)),
    onError
  );

// Server-side count of open (not completed) todos — drives the sidebar/pill
// "open" badge per space without fetching every todo.
export const getOpenTodoCount = async (spaceId: string): Promise<number> => {
  if (!spaceId) return 0;
  const snapshot = await getCountFromServer(
    query(todosCol(spaceId), where("completed", "==", false))
  );
  return snapshot.data().count;
};

// Edit title/body together and re-derive tags/mentions from the new content.
// `mentionMembers` lets plain-text @mentions in the title resolve too (issue #76).
export const editTodoContent = (
  spaceId: string,
  todoId: string,
  title: string,
  body: TiptapContent | null,
  uid: string,
  mentionMembers?: MentionMember[]
) =>
  updateDoc(todoRef(spaceId, todoId), {
    title: title.trim(),
    body,
    tags: deriveTags(title, body),
    mentions: deriveMentions(body, title, mentionMembers),
    modifiedBy: uid,
  });

// Completing a todo also releases any agent-session binding (epic #212): a done
// todo is no longer "assigned" to a session, so it stops showing a status badge.
const releaseBinding = { attachedSession: null, aidoTurn: null, claimedBy: null, claimedAt: null };

export const setTodoCompleted = (
  spaceId: string,
  todoId: string,
  completed: boolean,
  uid: string
) =>
  updateDoc(
    todoRef(spaceId, todoId),
    completed ? { completed, ...releaseBinding, modifiedBy: uid } : { completed, modifiedBy: uid }
  );

export const setTodoWaitingOn = (
  spaceId: string,
  todoId: string,
  waitingOn: string | null,
  uid: string
) => updateDoc(todoRef(spaceId, todoId), { waitingOn, modifiedBy: uid });

// Atomic status transition for the board status drops (issue #79): writes
// `completed` and `waitingOn` together in one updateDoc, so a card never flashes
// a half-applied intermediate state and completing one can't leave a stale
// `waitingOn` behind (which would keep showing "bei X" and re-surface it in the
// person column when reopened).
export const setTodoStatus = (
  spaceId: string,
  todoId: string,
  status: { completed: boolean; waitingOn: string | null },
  uid: string
) =>
  updateDoc(
    todoRef(spaceId, todoId),
    status.completed ? { ...status, ...releaseBinding, modifiedBy: uid } : { ...status, modifiedBy: uid }
  );

// Manual reordering (issue #235, epic #234): set one todo's `order` to a
// caller-computed value (the midpoint of its new neighbours — see utils/order).
// One doc write; modifiedBy must be stamped for the rules (#198).
export const setTodoOrder = (
  spaceId: string,
  todoId: string,
  order: number,
  uid: string
) => updateDoc(todoRef(spaceId, todoId), { order, modifiedBy: uid });

// Renumber a list of todos with clean, evenly spaced integers in one batch
// (issue #235). Used when the neighbour gap got too small to subdivide, or to
// heal legacy `order` ties (several todos sharing order 0). `orderedIds` is the
// desired final order; every write stamps modifiedBy for the rules.
export const normalizeTodoOrders = (
  spaceId: string,
  orderedIds: string[],
  uid: string
) => {
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) =>
    batch.update(todoRef(spaceId, id), { order: (i + 1) * ORDER_STEP, modifiedBy: uid })
  );
  return batch.commit();
};

export const deleteTodo = (spaceId: string, todoId: string) =>
  deleteDoc(todoRef(spaceId, todoId));

// Move a todo to another space (issue #200). Because spaceId is part of the
// Firestore path this can't be an updateDoc: it's a create in the target plus a
// delete in the source, committed as one writeBatch so a move can never leave a
// duplicate or lose the todo. All fields carry over; createdBy/createdAt are
// preserved (firestore.rules keys the writer check on modifiedBy, #199, and
// requires createdBy to be a member of the target — the caller must check that
// before calling). order is recomputed to land at the end of the target list;
// waitingOn is cleared when the target space doesn't have that member, since the
// rules reject a waitingOn pointing at a non-member. Returns the new todo id.
export const moveTodoToSpace = async (
  todo: Todo,
  targetSpaceId: string,
  uid: string,
  opts?: { clearWaitingOn?: boolean }
): Promise<string> => {
  if (!todo.spaceId || !todo.id || !targetSpaceId || !uid) {
    throw new Error("Missing todo, target space or user.");
  }
  if (targetSpaceId === todo.spaceId) throw new Error("Todo is already in this space.");

  const last = await getDocs(
    query(todosCol(targetSpaceId), orderBy("order", "desc"), limit(1))
  );
  const maxOrder = last.empty ? 0 : (last.docs[0].data().order ?? 0);

  const targetRef = doc(todosCol(targetSpaceId));
  const batch = writeBatch(db);
  batch.set(targetRef, {
    spaceId: targetSpaceId,
    title: todo.title,
    body: todo.body ?? null,
    completed: todo.completed,
    waitingOn: opts?.clearWaitingOn ? null : todo.waitingOn,
    tags: todo.tags,
    mentions: todo.mentions,
    createdBy: todo.createdBy,
    modifiedBy: uid,
    createdAt: todo.createdAt ?? serverTimestamp(),
    order: maxOrder + 1,
  });
  batch.delete(todoRef(todo.spaceId, todo.id));
  await batch.commit();
  return targetRef.id;
};

// --- Agent-Sessions (epic #212, issue #217) ---
// Binding a todo to a Claude-Code session is a normal member update on the todo
// doc; managing the session docs is owner-only under users/{uid}/sessions.

// Attach a todo to a session (sets it to "bei aido"). Clears any stale claim.
export const attachTodoToSession = (
  spaceId: string,
  todoId: string,
  sessionId: string,
  uid: string
) =>
  updateDoc(todoRef(spaceId, todoId), {
    attachedSession: sessionId,
    aidoTurn: "aido",
    claimedBy: null,
    claimedAt: null,
    modifiedBy: uid,
  });

// Remove the binding entirely.
export const detachTodoSession = (spaceId: string, todoId: string, uid: string) =>
  updateDoc(todoRef(spaceId, todoId), {
    attachedSession: null,
    aidoTurn: null,
    claimedBy: null,
    claimedAt: null,
    modifiedBy: uid,
  });

const sessionsCol = (uid: string) => collection(db, "users", uid, "sessions");
const sessionRef = (uid: string, sessionId: string) => doc(db, "users", uid, "sessions", sessionId);

const mapAgentSession = (d: QueryDocumentSnapshot<DocumentData>): AgentSession => {
  const data = d.data();
  return {
    id: d.id,
    spaceId: typeof data.spaceId === "string" ? data.spaceId : "",
    hostname: typeof data.hostname === "string" ? data.hostname : "",
    workingFolder: typeof data.workingFolder === "string" ? data.workingFolder : "",
    label: typeof data.label === "string" ? data.label : null,
    allowedTools: Array.isArray(data.allowedTools) ? (data.allowedTools as AgentToolName[]) : [],
    leaseTtlSeconds: typeof data.leaseTtlSeconds === "number" ? data.leaseTtlSeconds : 600,
    createdAt: data.createdAt ?? null,
    lastSeenAt: data.lastSeenAt ?? null,
  };
};

// Live list of the user's agent sessions for one space (for the attach picker /
// settings panel). Single-field `where` — no composite index needed.
export const subscribeAgentSessionsForSpace = (
  uid: string,
  spaceId: string,
  onChange: (sessions: AgentSession[]) => void,
  onError?: (e: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(sessionsCol(uid), where("spaceId", "==", spaceId)),
    (snap) => onChange(snap.docs.map(mapAgentSession)),
    (err) => onError?.(err)
  );

export const renameAgentSession = (uid: string, sessionId: string, label: string) =>
  updateDoc(sessionRef(uid, sessionId), { label: label.trim() || null });

export const deleteAgentSession = (uid: string, sessionId: string) =>
  deleteDoc(sessionRef(uid, sessionId));

export const setAgentSessionConfig = (
  uid: string,
  sessionId: string,
  config: { allowedTools?: AgentToolName[]; leaseTtlSeconds?: number }
) => updateDoc(sessionRef(uid, sessionId), { ...config });

// All of the user's agent sessions (for the settings panel, #219).
export const subscribeAllAgentSessions = (
  uid: string,
  onChange: (sessions: AgentSession[]) => void,
  onError?: (e: Error) => void
): Unsubscribe =>
  onSnapshot(
    sessionsCol(uid),
    (snap) => onChange(snap.docs.map(mapAgentSession)),
    (err) => onError?.(err)
  );

// Default lease (seconds) applied to newly registered sessions (#219, #215).
export const setUserAgentDefaults = (uid: string, defaults: { leaseTtlSeconds: number }) =>
  updateDoc(doc(db, "users", uid), { agentSessionDefaults: defaults });

// --- Daily "Heute" items (space-scoped, issue #41) ---
// Short-lived items, deliberately separate from todos (never appear in the list).

const dailyCol = (spaceId: string) =>
  collection(db, SPACES_COLLECTION, spaceId, "daily");
const dailyRef = (spaceId: string, dailyId: string) =>
  doc(db, SPACES_COLLECTION, spaceId, "daily", dailyId);

// Local date as YYYY-MM-DD (lexicographically comparable for "older than today").
export const todayString = (): string => {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

const mapDaily = (d: QueryDocumentSnapshot<DocumentData>): Daily => {
  const data = d.data();
  return {
    id: d.id,
    spaceId: typeof data.spaceId === "string" ? data.spaceId : "",
    text: typeof data.text === "string" ? data.text : "",
    completed: data.completed === true,
    date: typeof data.date === "string" ? data.date : "",
    author: typeof data.author === "string" ? data.author : "",
    createdAt: data.createdAt ?? null,
  };
};

export const createDaily = async (
  spaceId: string,
  uid: string,
  text: string,
  date: string = todayString()
): Promise<string> => {
  if (!spaceId || !uid) throw new Error("Missing space or user.");
  const ref = await addDoc(dailyCol(spaceId), {
    spaceId,
    text: text.trim(),
    completed: false,
    date,
    author: uid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

// Open (not completed) daily items. Single-field filter → no composite index;
// callers split into today's vs. "liegengeblieben" (date < today) client-side.
const sortDaily = (items: Daily[]): Daily[] =>
  items.sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));

export const getOpenDailyForSpace = async (spaceId: string): Promise<Daily[]> => {
  if (!spaceId) return [];
  const snapshot = await getDocs(
    query(dailyCol(spaceId), where("completed", "==", false))
  );
  return sortDaily(snapshot.docs.map(mapDaily));
};

// Live subscription to a space's open daily items (issue #72): returns an
// unsubscribe function and fires on every change.
export const subscribeOpenDailyForSpace = (
  spaceId: string,
  onChange: (items: Daily[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(dailyCol(spaceId), where("completed", "==", false)),
    (snap) => onChange(sortDaily(snap.docs.map(mapDaily))),
    onError
  );

// "Liegengeblieben": an open daily item from before today.
export const isStaleDaily = (d: Daily, today: string = todayString()): boolean =>
  !d.completed && !!d.date && d.date < today;

export const setDailyCompleted = (spaceId: string, dailyId: string, completed: boolean) =>
  updateDoc(dailyRef(spaceId, dailyId), { completed });

export const deleteDaily = (spaceId: string, dailyId: string) =>
  deleteDoc(dailyRef(spaceId, dailyId));

// --- Thread messages per todo (epic #247) ---
// A discussion thread lives under spaces/{spaceId}/todos/{todoId}/messages,
// deliberately separate from the todo body so the member<->aido back-and-forth
// (questions, rework) stays out of the task itself. tags/mentions are derived
// from the Tiptap body exactly like todos; the author is immutable and only the
// author may delete their own message (see firestore.rules). Clients write only
// source:'user' — 'aido' messages come from the MCP server via the Admin SDK.

const messagesCol = (spaceId: string, todoId: string) =>
  collection(db, SPACES_COLLECTION, spaceId, "todos", todoId, "messages");
const messageRef = (spaceId: string, todoId: string, messageId: string) =>
  doc(db, SPACES_COLLECTION, spaceId, "todos", todoId, "messages", messageId);

const mapMessage = (d: QueryDocumentSnapshot<DocumentData>): ThreadMessage => {
  const data = d.data();
  return {
    id: d.id,
    body: (data.body as TiptapContent | null) ?? null,
    text: typeof data.text === "string" ? data.text : "",
    tags: Array.isArray(data.tags) ? data.tags : [],
    mentions: Array.isArray(data.mentions) ? data.mentions : [],
    author: typeof data.author === "string" ? data.author : "",
    source: data.source === "aido" ? "aido" : "user",
    sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
    createdAt: data.createdAt ?? null,
  };
};

// One-shot load of a todo's thread, oldest first. Kept as a fallback; live
// updates flow through subscribeThread.
export const getThreadForTodo = async (
  spaceId: string,
  todoId: string
): Promise<ThreadMessage[]> => {
  if (!spaceId || !todoId) return [];
  const snapshot = await getDocs(
    query(messagesCol(spaceId, todoId), orderBy("createdAt", "asc"))
  );
  return snapshot.docs.map(mapMessage);
};

// Live subscription to a todo's thread (oldest first). Returns an unsubscribe
// function; a component subscribes only while the todo's thread is open, so many
// rows don't each hold a listener.
export const subscribeThread = (
  spaceId: string,
  todoId: string,
  onChange: (messages: ThreadMessage[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(messagesCol(spaceId, todoId), orderBy("createdAt", "asc")),
    (snap) => onChange(snap.docs.map(mapMessage)),
    onError
  );

// Post a space member's message into a todo's thread. text/tags/mentions are
// derived from the Tiptap body (same helpers as todos); source is always 'user'.
export const postThreadMessage = async (
  spaceId: string,
  todoId: string,
  uid: string,
  body: TiptapContent | null
): Promise<string> => {
  if (!spaceId || !todoId || !uid) throw new Error("Missing space, todo or user.");
  const ref = await addDoc(messagesCol(spaceId, todoId), {
    body: body ?? null,
    text: extractPlainText(body).trim(),
    tags: deriveTags("", body),
    mentions: deriveMentions(body),
    author: uid,
    source: "user",
    sessionId: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
};

// Delete a thread message. The rules permit this only for the author.
export const deleteThreadMessage = (spaceId: string, todoId: string, messageId: string) =>
  deleteDoc(messageRef(spaceId, todoId, messageId));

// Helper function to generate a SHA-256 hash string from an email
export const generateIdFromEmail = async (email: string): Promise<string> => {
  const lowerCaseEmail = email.toLowerCase(); // Normalize to lowercase first
  const encoder = new TextEncoder();
  const data = encoder.encode(lowerCaseEmail);
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    // Convert ArrayBuffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  } catch (error) {
    console.error("Error generating SHA-256 hash:", error);
    // Fallback or re-throw, depending on how critical this is. 
    // For now, re-throwing as it's crucial for ID generation.
    throw new Error('Could not generate a unique ID for the email.');
  }
};

// --- Public Profile Functions ---
// users/{uid} is owner-readable only (PII like email lives there).
// publicProfiles/{uid} is the cross-user source: displayName, photoURL and a
// SHA-256 emailHash for exact-match lookup — never the email itself.

export interface PublicProfile {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
}

export const upsertPublicProfile = async (user: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}) => {
  const profileRef = doc(db, 'publicProfiles', user.uid);
  await setDoc(profileRef, {
    displayName: user.displayName ?? null,
    displayNameLower: user.displayName ? user.displayName.toLowerCase() : null,
    photoURL: user.photoURL ?? null,
    emailHash: user.email ? await generateIdFromEmail(user.email) : null,
  }, { merge: true });
};

export const getPublicProfile = async (userId: string): Promise<PublicProfile | null> => {
  const docSnap = await getDoc(doc(db, 'publicProfiles', userId));
  if (!docSnap.exists()) return null;
  const data = docSnap.data();
  return {
    uid: docSnap.id,
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
  };
};

// Exact-match lookup by email hash: callers must already know the address,
// so the user base cannot be enumerated via prefix scans.
export const findUserByEmail = async (email: string): Promise<PublicProfile | null> => {
  const emailHash = await generateIdFromEmail(email.trim());
  const q = query(collection(db, 'publicProfiles'), where('emailHash', '==', emailHash), limit(1));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  const data = docSnap.data();
  return {
    uid: docSnap.id,
    displayName: data.displayName ?? null,
    photoURL: data.photoURL ?? null,
  };
};

export const searchUsersByDisplayName = async (prefix: string, max = 5): Promise<PublicProfile[]> => {
  const prefixLower = prefix.toLowerCase();
  const q = query(
    collection(db, 'publicProfiles'),
    where('displayNameLower', '>=', prefixLower),
    where('displayNameLower', '<=', prefixLower + '\uf8ff'),
    limit(max)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      uid: docSnap.id,
      displayName: data.displayName ?? null,
      photoURL: data.photoURL ?? null,
    };
  });
};

// --- Contact Management Functions --- 

export const sendContactRequest = async (targetEmailInput: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("User not authenticated.");

  const targetEmail = targetEmailInput.trim().toLowerCase();
  if (currentUser.email?.toLowerCase() === targetEmail) throw new Error("You cannot send a contact request to yourself.");

  const targetProfile = await findUserByEmail(targetEmail);

  const currentUid = currentUser.uid;

  if (!targetProfile) {
    // --- User does not exist: Initiate an Invite --- 
    console.log(`User with email ${targetEmail} not found. Initiating an invite.`);
    
    const hashedEmailId = await generateIdFromEmail(targetEmail);
    const outgoingInviteRef = doc(db, 'users', currentUid, 'outgoingContactRequests', hashedEmailId);

    const existingInviteSnap = await getDoc(outgoingInviteRef);
    if (existingInviteSnap.exists()) {
      // Check if it's a resent invite or truly pending
      const existingData = existingInviteSnap.data();
      if (existingData?.status === 'invited') {
        throw new Error(`An invitation for ${targetEmail} has already been sent and is pending.`);
      } else {
        // If status is something else (e.g. old, resolved), allow re-inviting by overwriting
        console.log(`Found previous non-pending invite for ${targetEmail}, proceeding to re-invite.`);
      }
    }

    await setDoc(outgoingInviteRef, {
      targetEmail: targetEmail, // Store the original (lowercase) email
      status: 'invited',
      requestedAt: serverTimestamp(),
      // No targetUid or targetUser details as the user doesn't exist yet
    });
    return { status: 'invited', message: `User ${targetEmail} not found. An invitation has been initiated.` };

  } else {
    // --- User exists: Proceed with normal contact request ---
    const targetUid = targetProfile.uid;
    const targetUserData = targetProfile;

    const contactRef = doc(db, 'users', currentUid, 'contacts', targetUid);
    const outgoingRequestRef = doc(db, 'users', currentUid, 'outgoingContactRequests', targetUid);
    const targetIncomingRequestRef = doc(db, 'users', targetUid, 'incomingContactRequests', currentUid);
    const requestFromTargetToCurrentUserRef = doc(db, 'users', currentUid, 'incomingContactRequests', targetUid);
    
    const contactSnap = await getDoc(contactRef);
    if (contactSnap.exists()) throw new Error(`You are already contacts with ${targetUserData.displayName || targetEmail}.`);

    const outgoingRequestSnap = await getDoc(outgoingRequestRef);
    if (outgoingRequestSnap.exists()) throw new Error(`Contact request to ${targetUserData.displayName || targetEmail} already sent.`);

    const requestFromTargetToCurrentUserSnap = await getDoc(requestFromTargetToCurrentUserRef);
    if (requestFromTargetToCurrentUserSnap.exists()) {
      const batch = writeBatch(db);
      batch.set(contactRef, {
        uid: targetUid,
        email: targetEmail,
        displayName: targetUserData.displayName || null,
        photoURL: targetUserData.photoURL || null,
        addedAt: serverTimestamp(),
      });
      const targetContactRef = doc(db, 'users', targetUid, 'contacts', currentUid);
      batch.set(targetContactRef, {
        uid: currentUid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        photoURL: currentUser.photoURL,
        addedAt: serverTimestamp(),
      });
      batch.delete(requestFromTargetToCurrentUserRef); 
      const correspondingOutgoingRequestFromTargetRef = doc(db, 'users', targetUid, 'outgoingContactRequests', currentUid);
      batch.delete(correspondingOutgoingRequestFromTargetRef);
      await batch.commit();
      return { status: 'contact_added', message: `Successfully added ${targetUserData.displayName || targetEmail} as a contact (accepted their prior request).` };
    }

    const batch = writeBatch(db);
    const requestData = { requestedAt: serverTimestamp(), status: 'pending' };
    const incomingData = {
      ...requestData,
      requesterEmail: currentUser.email,
      requesterDisplayName: currentUser.displayName,
      requesterPhotoURL: currentUser.photoURL,
    };
    // targetEmail lives in the sender's own subcollection so the outgoing
    // list can show it without reading the target's (now private) user doc.
    batch.set(outgoingRequestRef, { ...requestData, targetEmail });
    batch.set(targetIncomingRequestRef, incomingData);
    await batch.commit();
    return { status: 'request_sent', message: `Contact request successfully sent to ${targetUserData.displayName || targetEmail}.` };
  }
};

// --- Interface for Outgoing Request Data (Updated for Invites) --- 
export interface OutgoingRequest {
  id: string; // Can be targetUserId OR hashedEmailId for invites
  status: 'pending' | 'invited' | 'accepted' | 'rejected'; // Added 'invited'
  requestedAt: Date;
  targetUser?: { 
    displayName?: string | null;
    email?: string | null;
    photoURL?: string | null;
  } | null; 
  targetEmail?: string; // Email of the invited user, present if status is 'invited'
}

// --- Function to get outgoing contact requests (Updated for Invites) --- 
export const getOutgoingContactRequests = async (userId: string): Promise<OutgoingRequest[]> => {
  if (!userId) return [];
  try {
    const requestsColRef = collection(db, 'users', userId, 'outgoingContactRequests');
    const q = query(requestsColRef, orderBy('requestedAt', 'desc')); 
    const snapshot = await getDocs(q);
    if (snapshot.empty) return [];

    const requestsPromises = snapshot.docs.map(async (reqDoc) => {
      const reqData = reqDoc.data();
      const docId = reqDoc.id; // This is either a UID or a hashedEmailId

      let targetUserProfile: OutgoingRequest['targetUser'] = null;
      let resolvedTargetEmail: string | undefined = reqData.targetEmail; // Get from doc if present for invites

      if (reqData.status !== 'invited') {
        // For non-invite statuses, docId should be a targetUserId
        try {
          const userProfile = await getPublicProfile(docId); // docId is targetUserId here
          if (userProfile) {
            targetUserProfile = {
              displayName: userProfile.displayName,
              email: resolvedTargetEmail ?? null,
              photoURL: userProfile.photoURL,
            };
          }
        } catch (profileError) {
          console.error(`Error fetching profile for target user ${docId}:`, profileError);
        }
      } else if (!resolvedTargetEmail) {
        // This case is problematic for an 'invited' status if targetEmail is missing.
        // It implies data inconsistency if an invite was created without storing targetEmail.
        console.warn(`Outgoing request with ID ${docId} has status 'invited' but no targetEmail field was found in the document. This invite may not be actionable.`);
      }
      
      return {
        id: docId, 
        status: reqData.status || 'pending', 
        requestedAt: reqData.requestedAt?.toDate ? reqData.requestedAt.toDate() : new Date(), 
        targetUser: targetUserProfile,
        targetEmail: resolvedTargetEmail, // This will be undefined if not available
      } as OutgoingRequest;
    });
    return Promise.all(requestsPromises);
  } catch (error) {
    console.error("Error fetching outgoing contact requests:", error);
    throw error;
  }
};

// --- Interface for Incoming Request Data --- 
export interface IncomingRequest {
  id: string; // requesterId
  status: string;
  requestedAt: Date;
  requesterDisplayName?: string | null;
  requesterEmail?: string | null;
  requesterPhotoURL?: string | null;
}

// --- Function to get incoming contact requests --- 
export const getIncomingContactRequests = async (userId: string): Promise<IncomingRequest[]> => {
  if (!userId) return [];
  try {
    const requestsColRef = collection(db, 'users', userId, 'incomingContactRequests');
    const q = query(requestsColRef, orderBy('requestedAt', 'desc'));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return [];

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id, // requesterId
        status: data.status || 'pending',
        requestedAt: data.requestedAt?.toDate ? data.requestedAt.toDate() : new Date(),
        requesterDisplayName: data.requesterDisplayName || null,
        requesterEmail: data.requesterEmail || null,
        requesterPhotoURL: data.requesterPhotoURL || null,
      } as IncomingRequest;
    });
  } catch (error) {
    console.error("Error fetching incoming contact requests:", error);
    throw error;
  }
};

// --- Function to accept a contact request ---
export const acceptContactRequest = async (
  currentUserId: string, 
  requesterId: string, 
  // Pass requester's data to store in current user's contact list
  requesterData: { email?: string | null; displayName?: string | null; photoURL?: string | null } = {}
) => {
  if (!currentUserId || !requesterId) throw new Error("Missing user IDs.");

  const currentUser = auth.currentUser; // For current user's details
  if (!currentUser || currentUser.uid !== currentUserId) {
    throw new Error("User mismatch or not authenticated for accepting request.");
  }

  const batch = writeBatch(db);

  // 1. Add requester to current user's contacts
  const currentUserContactRef = doc(db, 'users', currentUserId, 'contacts', requesterId);
  batch.set(currentUserContactRef, {
    uid: requesterId,
    email: requesterData.email || null,
    displayName: requesterData.displayName || null,
    photoURL: requesterData.photoURL || null,
    addedAt: serverTimestamp(),
  });

  // 2. Add current user to requester's contacts
  // (Fetch current user's profile data for this)
  let currentUserProfileData = { 
      email: currentUser.email, 
      displayName: currentUser.displayName, 
      photoURL: currentUser.photoURL 
  };
  // Optionally, re-fetch profile to ensure it's up-to-date, or rely on auth object
  // const profile = await getUserProfile(currentUserId);
  // if (profile) currentUserProfileData = { email: profile.email, displayName: profile.displayName, photoURL: profile.photoURL };

  const requesterContactRef = doc(db, 'users', requesterId, 'contacts', currentUserId);
  batch.set(requesterContactRef, {
    uid: currentUserId,
    email: currentUserProfileData.email,
    displayName: currentUserProfileData.displayName,
    photoURL: currentUserProfileData.photoURL,
    addedAt: serverTimestamp(),
  });

  // 3. Delete incoming request for current user
  const incomingRequestRef = doc(db, 'users', currentUserId, 'incomingContactRequests', requesterId);
  batch.delete(incomingRequestRef);

  // 4. Delete outgoing request for the requester
  const outgoingRequestRef = doc(db, 'users', requesterId, 'outgoingContactRequests', currentUserId);
  batch.delete(outgoingRequestRef);

  await batch.commit();
  console.log(`Contact request from ${requesterId} accepted by ${currentUserId}.`);
};

// --- Function to reject a contact request ---
export const rejectContactRequest = async (currentUserId: string, requesterId: string) => {
  if (!currentUserId || !requesterId) throw new Error("Missing user IDs for rejection.");

  const batch = writeBatch(db);

  // 1. Delete incoming request for current user
  const incomingRequestRef = doc(db, 'users', currentUserId, 'incomingContactRequests', requesterId);
  batch.delete(incomingRequestRef);

  // 2. Optional: Update status of or delete outgoing request for the requester
  // For simplicity, we can just delete it. Or update its status to 'rejected'.
  const outgoingRequestRef = doc(db, 'users', requesterId, 'outgoingContactRequests', currentUserId);
  // Option A: Delete it
  batch.delete(outgoingRequestRef);
  // Option B: Update status (if you want the sender to see it was rejected)
  // batch.update(outgoingRequestRef, { status: 'rejected', updatedAt: serverTimestamp() });

  await batch.commit();
  console.log(`Contact request from ${requesterId} rejected by ${currentUserId}.`);
};

// --- Interface for Contact Data --- 
export interface Contact {
  uid: string; // UID of the contact
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  addedAt: Date; // When the contact was added
}

// --- Function to get user's contacts --- 
export const getContacts = async (userId: string): Promise<Contact[]> => {
  if (!userId) return [];
  try {
    const contactsColRef = collection(db, 'users', userId, 'contacts');
    // Order by displayName for a sorted list, or by addedAt
    const q = query(contactsColRef, orderBy('displayName', 'asc')); 
    // const q = query(contactsColRef, orderBy('addedAt', 'desc')); 
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return [];
    }

    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        uid: doc.id, // The document ID is the contact's UID
        email: data.email || null,
        displayName: data.displayName || null,
        photoURL: data.photoURL || null,
        addedAt: data.addedAt?.toDate ? data.addedAt.toDate() : new Date(),
      } as Contact;
    });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    throw error;
  }
};

// --- Function to cancel an outgoing contact request or invite --- 
export const cancelOutgoingRequest = async (
  currentUserId: string,
  targetIdentifier: string, // This is targetUserId for normal requests, or hashedEmailId for invites
  isInvite: boolean
): Promise<{ message: string }> => {
  if (!currentUserId || !targetIdentifier) {
    throw new Error("Current user ID and target identifier are required.");
  }

  const batch = writeBatch(db);

  // 1. Delete the outgoing request/invite from the current user's subcollection
  const outgoingRequestRef = doc(db, 'users', currentUserId, 'outgoingContactRequests', targetIdentifier);
  batch.delete(outgoingRequestRef);

  // 2. If it was a normal request (not an invite), also delete the corresponding incoming request from the target user's subcollection
  if (!isInvite) {
    const targetUserId = targetIdentifier; // For non-invites, targetIdentifier is the UID of the target
    const incomingRequestAtTargetRef = doc(db, 'users', targetUserId, 'incomingContactRequests', currentUserId);
    batch.delete(incomingRequestAtTargetRef);
    console.log(`Also deleting incoming request at users/${targetUserId}/incomingContactRequests/${currentUserId}`);
  }

  try {
    await batch.commit();
    if (isInvite) {
      return { message: "Invitation successfully canceled." };
    } else {
      return { message: "Contact request successfully canceled." };
    }
  } catch (error) {
    console.error("Error canceling outgoing request/invite:", error);
    throw new Error("Failed to cancel the request/invite. Please try again.");
  }
};

// --- Legacy todo migration (issue #48) ---
// Lazily migrates a user's old users/{uid}/todos into the new spaces model on
// login (see AuthContext). Strategy:
//  - own (non-shared) todos → a default "Privat" space (marker: migratedDefault).
//  - shared todos (sharedWith) → a "Geteilt" space per distinct member set
//    (owner + sharees; marker: migratedShareKey), so former sharees regain
//    access via space membership. Trade-off: a sharee now sees ALL todos the
//    owner shared with that exact same group (per-space, not per-todo, sharing).
// Non-destructive: legacy docs are kept and tagged `migratedTo`. Idempotent via
// the per-user flag, per-todo marker, and per-space markers — safe to re-run
// (e.g. after a partial failure). Rollback: delete the created spaces and clear
// the user flag / `migratedTo` markers; the original todos are untouched. Export
// Firestore before relying on the result.
//
// Concurrency (issue #65): two tabs/devices logging in at the same time both
// pass the flag check, so the run must be safe to execute twice in parallel.
// Two guarantees make it so: (1) migration spaces use DETERMINISTIC ids and are
// created via an ensure-if-absent transaction, so concurrent runs converge on
// the same space instead of each forging its own; (2) each legacy todo is
// migrated inside its OWN transaction that re-reads the `migratedTo` marker
// before writing, so the loser of a race skips instead of creating a duplicate.

const TODOS_MIGRATION_FLAG = "todosMigratedToSpacesAt";
// Guards against concurrent runs within a session (the user-doc snapshot can
// fire repeatedly before the persisted flag is set).
const migrationInFlight = new Set<string>();

const firstLine = (text: string): string =>
  (text || "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean) ?? "";

// First non-empty block's text of a Tiptap body — used as a title fallback for
// legacy todos created purely via the editor (empty `text`), so they don't all
// collapse to "(ohne Titel)" (issue #69).
const firstBodyLine = (body: TiptapContent | null): string => {
  const blocks = (body as { content?: unknown[] } | null)?.content;
  if (!Array.isArray(blocks)) return "";
  for (const block of blocks) {
    const text = extractPlainText(block).trim();
    if (text) return text;
  }
  return "";
};

const memberSetKey = (members: string[]): string =>
  [...new Set(members)].sort().join(",");

// Deterministic id for a migration space, so concurrent runs target the SAME
// doc. `key` is null for the default "Privat" space and the member-set key for a
// "Geteilt" space; non-alphanumerics are collapsed since uids may be joined by
// commas and doc ids must not contain "/".
const migrationSpaceId = (uid: string, key: string | null): string =>
  `mig_${uid}_${(key ?? "privat").replace(/[^A-Za-z0-9]+/g, "_")}`;

export const migrateLegacyTodos = async (uid: string): Promise<void> => {
  if (!uid || migrationInFlight.has(uid)) return;
  migrationInFlight.add(uid);
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists() && userSnap.data()?.[TODOS_MIGRATION_FLAG]) return;

    const legacySnap = await getDocs(collection(db, "users", uid, "todos"));
    if (legacySnap.empty) {
      await setDoc(userRef, { [TODOS_MIGRATION_FLAG]: serverTimestamp() }, { merge: true });
      return;
    }

    // Prefer a space already created by a previous (possibly old-style, random-
    // id) migration run; otherwise fall back to the deterministic id.
    const spacesSnap = await getDocs(
      query(collection(db, SPACES_COLLECTION), where("members", "array-contains", uid))
    );
    const ownSpaces = spacesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<
      DocumentData & { id: string }
    >;
    const existingDefault = ownSpaces.find(
      (s) => s.migratedDefault === true && s.createdBy === uid
    )?.id;
    const existingShared = new Map<string, string>();
    for (const s of ownSpaces) {
      if (s.migratedShareKey && s.createdBy === uid) existingShared.set(s.migratedShareKey, s.id);
    }

    // Create a migration space only if it doesn't exist yet, atomically: two
    // concurrent runs both run this transaction on the same deterministic id, so
    // exactly one wins the create and the other becomes a no-op (issue #65).
    const ensuredSpaces = new Set<string>();
    const ensureSpace = async (
      spaceId: string,
      space: { name: string; color: number; members: string[]; marker: Record<string, unknown> }
    ): Promise<void> => {
      if (ensuredSpaces.has(spaceId)) return;
      await runTransaction(db, async (tx) => {
        const ref = doc(db, SPACES_COLLECTION, spaceId);
        if ((await tx.get(ref)).exists()) return;
        tx.set(ref, {
          name: space.name,
          color: space.color,
          members: space.members,
          createdBy: uid,
          createdAt: serverTimestamp(),
          ...space.marker,
        });
      });
      ensuredSpaces.add(spaceId);
    };

    let migrated = 0;
    let order = 0;
    for (const d of legacySnap.docs) {
      const data = d.data();
      if (data.migratedTo) continue; // already migrated this todo

      const sharedWith: string[] = Array.isArray(data.sharedWith)
        ? data.sharedWith.filter((x: unknown) => typeof x === "string" && x && x !== uid)
        : [];

      let targetSpaceId: string;
      if (sharedWith.length === 0) {
        targetSpaceId = existingDefault ?? migrationSpaceId(uid, null);
        await ensureSpace(targetSpaceId, {
          name: "Privat",
          color: getSpaceColor(0).hue,
          members: [uid],
          marker: { migratedDefault: true },
        });
      } else {
        const members = [uid, ...sharedWith];
        const key = memberSetKey(members);
        targetSpaceId = existingShared.get(key) ?? migrationSpaceId(uid, key);
        await ensureSpace(targetSpaceId, {
          name: "Geteilt",
          color: getSpaceColor(1).hue,
          members,
          marker: { migratedShareKey: key },
        });
      }

      const plain = typeof data.text === "string" ? data.text : "";
      const body =
        data.content && typeof data.content === "object" ? (data.content as TiptapContent) : null;
      const title = firstLine(plain) || firstBodyLine(body) || "(ohne Titel)";
      const tags =
        Array.isArray(data.tags) && data.tags.length ? data.tags : deriveTags(title, body);
      const mentions = Array.isArray(data.mentionedUsers)
        ? data.mentionedUsers
        : deriveMentions(body);

      // One transaction per legacy todo: re-read the marker and, only if still
      // unmigrated, create the new todo and tag the legacy doc in the same
      // atomic step. A concurrent run racing on the same todo loses the
      // transaction, re-reads `migratedTo`, and skips — so no duplicate todo is
      // ever created (issue #65). The new todo's id is generated client-side so
      // it can be referenced inside the transaction.
      const newTodoRef = doc(collection(db, SPACES_COLLECTION, targetSpaceId, "todos"));
      const created = await runTransaction(db, async (tx) => {
        const legacyRef = doc(db, "users", uid, "todos", d.id);
        const fresh = await tx.get(legacyRef);
        if (!fresh.exists() || fresh.data()?.migratedTo) return false;
        tx.set(newTodoRef, {
          spaceId: targetSpaceId,
          title,
          body,
          completed: data.completed === true,
          waitingOn: null,
          tags,
          mentions,
          createdBy: uid,
          modifiedBy: uid,
          createdAt: serverTimestamp(),
          order,
        });
        tx.update(legacyRef, {
          migratedTo: `${SPACES_COLLECTION}/${targetSpaceId}/todos/${newTodoRef.id}`,
        });
        return true;
      });
      if (created) {
        order++;
        migrated++;
      }
    }

    await setDoc(userRef, { [TODOS_MIGRATION_FLAG]: serverTimestamp() }, { merge: true });
    console.log(`[migration] Migrated ${migrated} legacy todo(s) into spaces for user ${uid}.`);
  } finally {
    migrationInFlight.delete(uid);
  }
};

// --- Add other potential functions like getIncomingContactRequests, getContacts etc. later ---
