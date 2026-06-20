// One-time server-side migration of legacy users/{uid}/todos into the spaces
// model (issue #66, part of #62 / #38).
//
// WHY THIS EXISTS
// The client-lazy migration (migrateLegacyTodos in firebaseUtils.ts) only runs
// on the OWNER's login. If a sharee logs in first — or the owner never logs in
// again — the previously shared todos are invisible to the sharee, because the
// "Geteilt" space (which grants access via membership) is created by the
// owner's run. This admin script migrates EVERY user's legacy todos up front,
// so sharees regain access regardless of who logs in first.
//
// COMPATIBILITY WITH THE CLIENT MIGRATION
// It uses the exact same deterministic space ids, marker fields
// (migratedDefault / migratedShareKey / migratedTo), per-user flag
// (todosMigratedToSpacesAt) and field mapping as the client. Whichever runs
// first wins; the other becomes a no-op. Safe to run repeatedly (idempotent).
//
// TRADE-OFF (documented per issue #66)
// Sharing becomes per-space, not per-todo: a "Geteilt" space is created per
// distinct member set, so a sharee sees ALL todos the owner shared with that
// exact same group. This matches the client migration's behaviour.
//
// USAGE
//   # Production (service account JSON as a single-line env var, same var the
//   # app uses). Run during low traffic.
//   FIREBASE_SERVICE_ACCOUNT_KEY='{"project_id":...}' \
//     node scripts/migrate-legacy-todos-admin.mjs [--dry-run] [--force] [--user <uid>]
//
//   # …or with a key file:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json GCLOUD_PROJECT=<id> \
//     node scripts/migrate-legacy-todos-admin.mjs --dry-run
//
//   # Against the Firestore emulator (used by the smoke test):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-x \
//     node scripts/migrate-legacy-todos-admin.mjs
//
// FLAGS
//   --dry-run   report what would change, write nothing
//   --force     also re-scan users whose migration flag is already set
//   --user <u>  migrate only this owner uid (the rest are skipped)
//
// ROLLBACK: delete the created `mig_*` spaces and clear the per-user flag /
// `migratedTo` markers; the original users/{uid}/todos are never modified
// beyond the additive `migratedTo` tag. Export Firestore before relying on it.

import { FieldValue } from "firebase-admin/firestore";

export const SPACES_COLLECTION = "spaces";
export const TODOS_MIGRATION_FLAG = "todosMigratedToSpacesAt";

// Palette hues for the default/shared spaces — mirrors getSpaceColor(0)/(1)
// from src/lib/theme/colors.ts (Teal / Koralle).
const PRIVAT_HUE = 200;
const GETEILT_HUE = 40;

// --- helpers replicated 1:1 from the client (textUtils.ts / firebaseUtils.ts)

function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#([a-zA-Z0-9_]+)/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.substring(1)))];
}

function extractPlainText(node) {
  if (!node) return "";
  let text = typeof node.text === "string" ? node.text : "";
  if (Array.isArray(node.content)) {
    for (const child of node.content) text += " " + extractPlainText(child);
  }
  return text;
}

function extractMentionIds(node) {
  let ids = [];
  if (!node) return ids;
  if (node.type === "mention" && node.attrs?.id) ids.push(node.attrs.id);
  if (Array.isArray(node.content)) {
    for (const child of node.content) ids = ids.concat(extractMentionIds(child));
  }
  return [...new Set(ids)];
}

function deriveTags(title, body) {
  return [...new Set([...extractHashtags(title || ""), ...extractHashtags(extractPlainText(body))])];
}

function deriveMentions(body) {
  return extractMentionIds(body);
}

function firstLine(text) {
  return (text || "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean) ?? "";
}

// First non-empty block's text of a Tiptap body — title fallback for legacy
// todos created purely via the editor (empty `text`) (issue #69).
function firstBodyLine(body) {
  const blocks = body?.content;
  if (!Array.isArray(blocks)) return "";
  for (const block of blocks) {
    const text = extractPlainText(block).trim();
    if (text) return text;
  }
  return "";
}

function memberSetKey(members) {
  return [...new Set(members)].sort().join(",");
}

// Deterministic id for a migration space (same scheme as the client) so the
// admin run and any client run converge on the same doc.
export function migrationSpaceId(uid, key) {
  return `mig_${uid}_${(key ?? "privat").replace(/[^A-Za-z0-9]+/g, "_")}`;
}

/**
 * Migrate one owner's legacy todos. Returns counts. Idempotent: todos already
 * tagged `migratedTo` are skipped, spaces are created only if absent.
 */
export async function migrateOwner(db, uid, { dryRun = false } = {}) {
  const result = { uid, todos: 0, spacesCreated: 0, skipped: 0 };

  const legacySnap = await db.collection("users").doc(uid).collection("todos").get();
  if (legacySnap.empty) return result;

  // Reuse a space from a previous (possibly old random-id) run, else use the
  // deterministic id.
  const ownSpacesSnap = await db
    .collection(SPACES_COLLECTION)
    .where("members", "array-contains", uid)
    .get();
  const ownSpaces = ownSpacesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const existingDefault = ownSpaces.find(
    (s) => s.migratedDefault === true && s.createdBy === uid
  )?.id;
  const existingShared = new Map();
  for (const s of ownSpaces) {
    if (s.migratedShareKey && s.createdBy === uid) existingShared.set(s.migratedShareKey, s.id);
  }

  const ensuredSpaces = new Set();
  const ensureSpace = async (spaceId, space) => {
    if (ensuredSpaces.has(spaceId)) return;
    ensuredSpaces.add(spaceId);
    if (dryRun) {
      const exists = (await db.collection(SPACES_COLLECTION).doc(spaceId).get()).exists;
      if (!exists) result.spacesCreated++;
      return;
    }
    await db.runTransaction(async (tx) => {
      const ref = db.collection(SPACES_COLLECTION).doc(spaceId);
      if ((await tx.get(ref)).exists) return;
      tx.set(ref, {
        name: space.name,
        color: space.color,
        members: space.members,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
        ...space.marker,
      });
      result.spacesCreated++;
    });
  };

  let order = 0;
  for (const d of legacySnap.docs) {
    const data = d.data();
    if (data.migratedTo) {
      result.skipped++;
      continue;
    }

    const sharedWith = Array.isArray(data.sharedWith)
      ? data.sharedWith.filter((x) => typeof x === "string" && x && x !== uid)
      : [];

    let targetSpaceId;
    if (sharedWith.length === 0) {
      targetSpaceId = existingDefault ?? migrationSpaceId(uid, null);
      await ensureSpace(targetSpaceId, {
        name: "Privat",
        color: PRIVAT_HUE,
        members: [uid],
        marker: { migratedDefault: true },
      });
    } else {
      const members = [uid, ...sharedWith];
      const key = memberSetKey(members);
      targetSpaceId = existingShared.get(key) ?? migrationSpaceId(uid, key);
      await ensureSpace(targetSpaceId, {
        name: "Geteilt",
        color: GETEILT_HUE,
        members,
        marker: { migratedShareKey: key },
      });
    }

    const plain = typeof data.text === "string" ? data.text : "";
    const body = data.content && typeof data.content === "object" ? data.content : null;
    const title = firstLine(plain) || firstBodyLine(body) || "(ohne Titel)";
    const tags = Array.isArray(data.tags) && data.tags.length ? data.tags : deriveTags(title, body);
    const mentions = Array.isArray(data.mentionedUsers) ? data.mentionedUsers : deriveMentions(body);

    if (dryRun) {
      result.todos++;
      order++;
      continue;
    }

    const newTodoRef = db.collection(SPACES_COLLECTION).doc(targetSpaceId).collection("todos").doc();
    const created = await db.runTransaction(async (tx) => {
      const legacyRef = db.collection("users").doc(uid).collection("todos").doc(d.id);
      const fresh = await tx.get(legacyRef);
      if (!fresh.exists || fresh.data().migratedTo) return false;
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
        createdAt: FieldValue.serverTimestamp(),
        order,
      });
      tx.update(legacyRef, {
        migratedTo: `${SPACES_COLLECTION}/${targetSpaceId}/todos/${newTodoRef.id}`,
      });
      return true;
    });
    if (created) {
      order++;
      result.todos++;
    } else {
      result.skipped++;
    }
  }

  if (!dryRun) {
    await db
      .collection("users")
      .doc(uid)
      .set({ [TODOS_MIGRATION_FLAG]: FieldValue.serverTimestamp() }, { merge: true });
  }
  return result;
}

/**
 * Migrate every user (or just `onlyUser`). Users whose migration flag is set
 * are skipped unless `force` is true.
 */
export async function migrateAllUsers(db, { dryRun = false, force = false, onlyUser = null } = {}) {
  const userRefs = onlyUser
    ? [db.collection("users").doc(onlyUser)]
    : await db.collection("users").listDocuments();

  const summary = { users: 0, migratedTodos: 0, spacesCreated: 0, skippedUsers: 0 };
  for (const ref of userRefs) {
    if (!force) {
      const snap = await ref.get();
      if (snap.exists && snap.data()?.[TODOS_MIGRATION_FLAG]) {
        summary.skippedUsers++;
        continue;
      }
    }
    const r = await migrateOwner(db, ref.id, { dryRun });
    if (r.todos > 0 || r.spacesCreated > 0) {
      summary.users++;
      summary.migratedTodos += r.todos;
      summary.spacesCreated += r.spacesCreated;
      console.log(
        `[migration] ${dryRun ? "would migrate" : "migrated"} user=${ref.id} ` +
          `todos=${r.todos} spaces=${r.spacesCreated} skipped=${r.skipped}`
      );
    }
  }
  return summary;
}

// --- CLI entry -------------------------------------------------------------

function parseArgs(argv) {
  const opts = { dryRun: false, force: false, onlyUser: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--user") opts.onlyUser = argv[++i] ?? null;
    else if (a.startsWith("--user=")) opts.onlyUser = a.slice("--user=".length);
  }
  return opts;
}

async function initAdminDb() {
  const { getApps, initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (getApps().length) return getFirestore();

  // Talking to the emulator: no real credentials needed.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-migration" });
    return getFirestore();
  }

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (json) {
    initializeApp({ credential: cert(JSON.parse(json)) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const { applicationDefault } = await import("firebase-admin/app");
    initializeApp({ credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT });
  } else {
    throw new Error(
      "No credentials. Set FIREBASE_SERVICE_ACCOUNT_KEY (single-line JSON) or " +
        "GOOGLE_APPLICATION_CREDENTIALS (+ GCLOUD_PROJECT), or FIRESTORE_EMULATOR_HOST."
    );
  }
  return getFirestore();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `[migration] starting ${opts.dryRun ? "(dry-run) " : ""}` +
      `${opts.onlyUser ? `user=${opts.onlyUser} ` : "all users "}` +
      `${opts.force ? "(force) " : ""}`
  );
  const db = await initAdminDb();
  const summary = await migrateAllUsers(db, opts);
  console.log(
    `[migration] done: users=${summary.users} todos=${summary.migratedTodos} ` +
      `spaces=${summary.spacesCreated} skippedUsers=${summary.skippedUsers}`
  );
  process.exit(0);
}
