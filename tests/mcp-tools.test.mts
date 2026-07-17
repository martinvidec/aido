// Integration tests for the Firestore-backed MCP tools (epic #124, issue #122).
//
// Exercises the REAL tool code (src/lib/mcp/data.ts + tool-logic.ts) against the
// Firestore emulator with the Admin SDK — the same path the live endpoint takes.
// Since the Admin SDK bypasses firestore.rules, these tests guard the membership
// isolation and field invariants the tools must enforce themselves.
//
// Run via (needs a JDK + the firestore emulator):
//   npx -y firebase-tools@13 emulators:exec --only firestore --project demo-mcp \
//     "node --conditions=react-server --import tsx tests/mcp-tools.test.mts"
//
// The `react-server` condition makes the `server-only` guard resolve to an empty
// module; tsx transpiles the TS + resolves the @/* path alias from tsconfig.

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST is not set — run inside emulators:exec.");
  process.exit(1);
}

// Pre-initialize the app under the name admin.ts expects, BEFORE the tools touch
// Firestore. admin.ts's getAdminApp() then reuses this emulator-bound app and
// never goes through cert()/FIREBASE_SERVICE_ACCOUNT_KEY.
const projectId = process.env.GCLOUD_PROJECT || "demo-mcp";
const adminApp = initializeApp({ projectId }, "admin");
const db = getFirestore(adminApp);

// Import the real tool code AFTER the app exists (functions only touch Firestore
// when called, so import order vs. init is safe, but keep it explicit).
const { requireMember, listSpacesForUid, listTodos, addTodo, completeTodo, setWaitingOn, listDaily, addDaily, deleteTodo, whoami, listMembers, registerSession, nextTodo, updateTodo, handoffTodo, postMessage, listMessages, McpToolError } =
  await import("../src/lib/mcp/data.ts");
const { handleListSpaces } = await import("../src/lib/mcp/tool-logic.ts");
const { runWithPrincipal } = await import("../src/lib/mcp/context.ts");

const ALICE = "alice-uid";
const BOB = "bob-uid";
const CAROL = "carol-uid";
const S1 = "space-1"; // alice + bob
const S2 = "space-2"; // carol only

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}
async function expectError(name: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    failures++;
    console.error(`  ✗ ${name} (expected ${code}, but it resolved)`);
  } catch (e) {
    const actual = e instanceof McpToolError ? e.code : `${(e as Error).name}`;
    check(`${name} → ${code}`, actual === code);
  }
}

async function seed() {
  await db.collection("publicProfiles").doc(ALICE).set({ displayName: "Alice" });
  await db.collection("publicProfiles").doc(BOB).set({ displayName: "Bob" });
  await db.collection("publicProfiles").doc(CAROL).set({ displayName: "Carol" });

  await db.collection("spaces").doc(S1).set({
    name: "Team", color: 40, members: [ALICE, BOB], createdBy: ALICE, createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("spaces").doc(S2).set({
    name: "Carol", color: 200, members: [CAROL], createdBy: CAROL, createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection("spaces").doc(S1).collection("todos").doc("t1").set({
    spaceId: S1, title: "Existing", body: null, completed: false, waitingOn: null,
    tags: [], mentions: [], createdBy: ALICE, createdAt: FieldValue.serverTimestamp(), order: 1,
  });
}

async function run() {
  await seed();

  // --- requireMember / isolation ---
  await expectError("non-member is rejected on a space", "unauthorized", () => requireMember(CAROL, S1));
  await expectError("unknown space is not_found", "not_found", () => requireMember(ALICE, "nope"));
  const space = await requireMember(ALICE, S1);
  check("member resolves the space", space.id === S1 && space.members.includes(ALICE));

  // --- list-spaces ---
  const spaces = await listSpacesForUid(ALICE);
  check("list-spaces returns only my spaces", spaces.length === 1 && spaces[0].id === S1);
  check("list-spaces reports open-todo count", spaces[0].openTodoCount === 1);

  // --- list-todos isolation ---
  const todos = await listTodos(ALICE, S1, {});
  check("list-todos returns the space's todos", todos.length === 1 && todos[0].title === "Existing");
  await expectError("list-todos rejects non-members", "unauthorized", () => listTodos(CAROL, S1, {}));

  // --- add-todo invariants ---
  const created = await addTodo(ALICE, S1, { title: "Buy #milk @Bob", waitingOn: BOB });
  const createdSnap = await db.collection("spaces").doc(S1).collection("todos").doc(created.id).get();
  const cd = createdSnap.data()!;
  check("add-todo sets createdBy to the caller", cd.createdBy === ALICE);
  check("add-todo sets order = max+1", cd.order === 2);
  check("add-todo derives #tags", Array.isArray(cd.tags) && cd.tags.includes("milk"));
  check("add-todo resolves @mention to uid", Array.isArray(cd.mentions) && cd.mentions.includes(BOB));
  check("add-todo keeps a member waitingOn", cd.waitingOn === BOB);
  await expectError("add-todo rejects a non-member waitingOn", "invalid",
    () => addTodo(ALICE, S1, { title: "x", waitingOn: CAROL }));

  // --- complete-todo / set-waiting-on ---
  const done = await completeTodo(ALICE, S1, created.id, true);
  check("complete-todo sets completed", done.completed === true);
  const cleared = await setWaitingOn(ALICE, S1, created.id, null);
  check("set-waiting-on clears to null", cleared.waitingOn === null);
  await expectError("set-waiting-on rejects a non-member", "invalid",
    () => setWaitingOn(ALICE, S1, created.id, CAROL));

  // --- daily ("Heute") tools ---
  const daily = await addDaily(ALICE, S1, "Quick note");
  const dailySnap = await db.collection("spaces").doc(S1).collection("daily").doc(daily.id).get();
  const dd = dailySnap.data()!;
  check("add-daily sets author to the caller", dd.author === ALICE);
  check("add-daily dates today (YYYY-MM-DD)", /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dd.date));
  check("add-daily starts not completed", dd.completed === false);
  const listed = await listDaily(ALICE, S1, dd.date);
  check("list-daily returns the day's items", listed.some((x) => x.id === daily.id));
  await expectError("list-daily rejects a bad date", "invalid", () => listDaily(ALICE, S1, "2026-13-40"));
  await expectError("add-daily rejects non-members", "unauthorized", () => addDaily(CAROL, S1, "x"));

  // --- comfort tools: delete-todo, whoami, list-members ---
  const toDelete = await addTodo(ALICE, S1, { title: "Delete me" });
  await expectError("delete-todo rejects non-members", "unauthorized", () => deleteTodo(CAROL, S1, toDelete.id));
  const del = await deleteTodo(ALICE, S1, toDelete.id);
  check("delete-todo reports deleted", del.deleted === true && del.id === toDelete.id);
  const goneSnap = await db.collection("spaces").doc(S1).collection("todos").doc(toDelete.id).get();
  check("delete-todo actually removes the doc", !goneSnap.exists);
  await expectError("delete-todo on a missing todo → not_found", "not_found", () => deleteTodo(ALICE, S1, "nope"));

  const me = await whoami(ALICE);
  check("whoami returns uid + display name", me.uid === ALICE && me.displayName === "Alice");

  const members = await listMembers(ALICE, S1);
  check("list-members returns the space members with names",
    members.length === 2 && members.some((m) => m.uid === BOB && m.displayName === "Bob"));
  await expectError("list-members rejects non-members", "unauthorized", () => listMembers(CAROL, S1));

  // --- Agent-Sessions (epic #212): register → next-todo (claim/lease) → update/handoff/complete ---
  const HOST = "macbook";
  const CWD = "/home/alice/proj";
  const todoRef = (id: string) => db.collection("spaces").doc(S1).collection("todos").doc(id);

  const sess = await registerSession(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD });
  check("register-session returns a 64-char sessionId", typeof sess.sessionId === "string" && sess.sessionId.length === 64);
  check("register-session default allowlist is update-todo+handoff (no complete-todo)",
    sess.allowedTools.includes("update-todo") && sess.allowedTools.includes("handoff") && !sess.allowedTools.includes("complete-todo"));
  const sess2 = await registerSession(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD });
  check("register-session is deterministic (same id on re-register)", sess2.sessionId === sess.sessionId);
  await expectError("register-session rejects non-members", "unauthorized",
    () => registerSession(CAROL, { spaceId: S1, hostname: HOST, workingFolder: CWD }));
  await expectError("next-todo without a registered session → not_found", "not_found",
    () => nextTodo(ALICE, { spaceId: S1, hostname: "elsewhere", workingFolder: "/x" }));

  // Two attached todos. createdAt is deliberately INVERTED vs. order (a1 is the
  // NEWER doc but has the LOWER order) so the test proves next-todo follows the
  // manual order, not createdAt (issue #243).
  const attached = (createdAtMs: number) => ({
    spaceId: S1, body: null, completed: false, waitingOn: null, tags: [], mentions: [],
    createdBy: BOB, modifiedBy: BOB, createdAt: Timestamp.fromMillis(createdAtMs), order: 10,
    attachedSession: sess.sessionId, aidoTurn: "aido", claimedBy: null, claimedAt: null,
  });
  await todoRef("a1").set({ ...attached(2000), title: "First question", order: 10 });
  await todoRef("a2").set({ ...attached(1000), title: "Second question", order: 11 });

  const first = await nextTodo(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD });
  check("next-todo returns the lowest-order attached todo (not the oldest)", first?.todoId === "a1" && first?.title === "First question");
  const again = await nextTodo(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD });
  check("next-todo self-claim is idempotent (same todo)", again?.todoId === "a1");

  const upd = await updateTodo(ALICE, { sessionId: sess.sessionId, spaceId: S1, todoId: "a1", bodyMarkdown: "Antwort: `42`", mode: "append" });
  check("update-todo keeps it open (not completed)", upd.completed === false);
  const a1d = (await todoRef("a1").get()).data()!;
  check("update-todo writes a Tiptap doc body", (a1d.body as { type?: string })?.type === "doc");
  check("update-todo append keeps the claim", a1d.claimedBy === sess.sessionId);
  check("update-todo stamps lastAidoEditAt", !!a1d.lastAidoEditAt);
  await expectError("update-todo on an unclaimed todo → unauthorized", "unauthorized",
    () => updateTodo(ALICE, { sessionId: sess.sessionId, spaceId: S1, todoId: "a2", bodyMarkdown: "x" }));

  const ho = await handoffTodo(ALICE, { sessionId: sess.sessionId, spaceId: S1, todoId: "a1" });
  check("handoff releases the binding, leaving the todo open",
    ho.attachedSession === null && ho.aidoTurn === null && ho.completed === false);
  check("handoff clears the claim", (await todoRef("a1").get()).data()!.claimedBy === null);

  const second = await nextTodo(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD });
  check("next-todo advances to the next todo (by order) after handoff", second?.todoId === "a2");

  await expectError("complete-todo via session blocked by default allowlist", "unauthorized",
    () => completeTodo(ALICE, S1, "a2", true, sess.sessionId));
  await registerSession(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD, allowedTools: ["update-todo", "handoff", "complete-todo"] });
  const comp = await completeTodo(ALICE, S1, "a2", true, sess.sessionId);
  check("complete-todo via session works once allowed", comp.completed === true);
  const a2done = (await todoRef("a2").get()).data()!;
  check("complete-todo via session clears the claim", a2done.claimedBy === null);
  check("complete-todo releases the binding (no longer assigned)", a2done.attachedSession === null);

  // Lease: a stale claim by a DIFFERENT session is reclaimable.
  await todoRef("a3").set({ ...attached(3000), title: "Stale", order: 12, claimedBy: "other-session", claimedAt: Timestamp.fromMillis(1) });
  const reclaimed = await nextTodo(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD });
  check("next-todo reclaims a todo whose lease expired", reclaimed?.todoId === "a3");
  await handoffTodo(ALICE, { sessionId: sess.sessionId, spaceId: S1, todoId: "a3" });
  const none = await nextTodo(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD });
  check("next-todo returns null when nothing is queued", none === null);

  // --- Thread messages (epic #247): post-message / list-messages / next-todo thread ---
  await todoRef("m1").set({ ...attached(4000), title: "Thread todo", order: 20 });
  const claimedM = await nextTodo(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD });
  check("next-todo claims the thread todo", claimedM?.todoId === "m1");
  check("next-todo returns an empty thread for a fresh todo", claimedM?.thread === "");

  // The current session (re-registered above) allows complete-todo but NOT
  // post-message, so posting is blocked until it's granted.
  await expectError("post-message blocked without the allowlist entry", "unauthorized",
    () => postMessage(ALICE, { sessionId: sess.sessionId, spaceId: S1, todoId: "m1", bodyMarkdown: "Frage?" }));
  await registerSession(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD, allowedTools: ["update-todo", "handoff", "post-message"] });

  const posted = await postMessage(ALICE, { sessionId: sess.sessionId, spaceId: S1, todoId: "m1", bodyMarkdown: "Kurze **Frage** zum Vorgehen?" });
  check("post-message returns an aido message", posted.source === "aido" && posted.markdown.includes("Frage"));
  const m1msgs = await db.collection("spaces").doc(S1).collection("todos").doc("m1").collection("messages").get();
  check("post-message writes exactly one thread message", m1msgs.size === 1);
  const pmd = m1msgs.docs[0].data();
  check("post-message sets source=aido, author=caller, sessionId", pmd.source === "aido" && pmd.author === ALICE && pmd.sessionId === sess.sessionId);
  check("post-message writes a Tiptap doc body", (pmd.body as { type?: string })?.type === "doc");

  const listedMsgs = await listMessages(ALICE, S1, "m1");
  check("list-messages returns the thread", listedMsgs.length === 1 && listedMsgs[0].source === "aido");
  check("list-messages resolves the author name", listedMsgs[0].authorName === "Alice");
  await expectError("list-messages rejects non-members", "unauthorized", () => listMessages(CAROL, S1, "m1"));

  const withThread = await nextTodo(ALICE, { spaceId: S1, hostname: HOST, workingFolder: CWD });
  check("next-todo surfaces the thread as markdown on the claimed todo",
    withThread?.todoId === "m1" && !!withThread?.thread && withThread.thread.includes("aido"));

  // post-message is claim-scoped: cannot post to a todo this session hasn't claimed.
  await todoRef("m2").set({ ...attached(5000), title: "Not mine", order: 21, attachedSession: null, aidoTurn: null });
  await expectError("post-message on an unclaimed todo → unauthorized", "unauthorized",
    () => postMessage(ALICE, { sessionId: sess.sessionId, spaceId: S1, todoId: "m2", bodyMarkdown: "x" }));

  // --- principal gate (tool-logic): data tools require a user principal ---
  await expectError("no principal → unauthorized", "unauthorized", () => handleListSpaces());
  await expectError("shared principal → unauthorized", "unauthorized",
    () => runWithPrincipal({ kind: "shared" }, () => handleListSpaces()));
  const ok = await runWithPrincipal({ kind: "user", uid: ALICE }, () => handleListSpaces());
  check("user principal → tool runs", !ok.isError && Array.isArray(ok.content));
}

run()
  .then(() => {
    console.log(failures === 0 ? "\nAll MCP tool tests passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("\nTest run crashed:", e);
    process.exit(1);
  });
