// Smoke test for the one-time admin migration (issue #66).
// Runs against the Firestore emulator with the Admin SDK (which bypasses rules,
// exactly as the real script does). Verifies that a sharee regains access via
// space membership and that the migration is idempotent.
//
// Run via:
//   npx -y firebase-tools@13 emulators:exec --only firestore --project demo-migration \
//     "node tests/migration-admin.test.mjs"

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { migrateAllUsers, migrationSpaceId } from "../scripts/migrate-legacy-todos-admin.mjs";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST is not set — run inside emulators:exec.");
  process.exit(1);
}

const ALICE = "alice-uid";
const BOB = "bob-uid";

if (!getApps().length) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-migration" });
}
const db = getFirestore();

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

async function seed() {
  // Alice owns two legacy todos: one private, one shared with Bob.
  await db.collection("users").doc(ALICE).collection("todos").doc("t-private").set({
    text: "Privat A\nmore",
    content: null,
    completed: false,
    sharedWith: [],
    mentionedUsers: [],
    tags: ["home"],
  });
  await db.collection("users").doc(ALICE).collection("todos").doc("t-shared").set({
    text: "Shared with Bob",
    content: null,
    completed: true,
    sharedWith: [BOB],
    mentionedUsers: [],
    tags: [],
  });
}

console.log("Admin migration (issue #66):");
await seed();

const first = await migrateAllUsers(db, {});
check("reports 2 migrated todos", first.migratedTodos === 2);
check("reports 2 spaces created (Privat + Geteilt)", first.spacesCreated === 2);

const privatId = migrationSpaceId(ALICE, null);
const privatSnap = await db.collection("spaces").doc(privatId).get();
check("Privat space exists with creator Alice", privatSnap.exists && privatSnap.data().createdBy === ALICE);
check("Privat space members = [alice]", JSON.stringify(privatSnap.data()?.members) === JSON.stringify([ALICE]));

const sharedKey = [ALICE, BOB].sort().join(",");
const sharedId = migrationSpaceId(ALICE, sharedKey);
const sharedSnap = await db.collection("spaces").doc(sharedId).get();
check("Geteilt space exists", sharedSnap.exists);
check(
  "sharee Bob is a member of the Geteilt space (regains access)",
  Array.isArray(sharedSnap.data()?.members) && sharedSnap.data().members.includes(BOB)
);

const privTodos = await db.collection("spaces").doc(privatId).collection("todos").get();
check("Privat space has 1 todo", privTodos.size === 1);
check("private todo title derived from first line", privTodos.docs[0].data().title === "Privat A");
check("private todo keeps legacy tag", JSON.stringify(privTodos.docs[0].data().tags) === JSON.stringify(["home"]));

const sharedTodos = await db.collection("spaces").doc(sharedId).collection("todos").get();
check("Geteilt space has 1 todo", sharedTodos.size === 1);
check("shared todo keeps completed flag", sharedTodos.docs[0].data().completed === true);

const legacyShared = await db.collection("users").doc(ALICE).collection("todos").doc("t-shared").get();
check("legacy shared todo tagged migratedTo", typeof legacyShared.data().migratedTo === "string");

const aliceDoc = await db.collection("users").doc(ALICE).get();
check("Alice's migration flag is set", !!aliceDoc.data()?.todosMigratedToSpacesAt);

// Idempotency: a second run must not create duplicates.
const second = await migrateAllUsers(db, {});
check("second run migrates nothing (flag set)", second.migratedTodos === 0 && second.spacesCreated === 0);

// Even with --force (re-scan), markers prevent duplicate todos/spaces.
const forced = await migrateAllUsers(db, { force: true });
check("forced re-run creates no duplicate todos", forced.migratedTodos === 0);
const privTodos2 = await db.collection("spaces").doc(privatId).collection("todos").get();
check("Privat space still has exactly 1 todo after re-runs", privTodos2.size === 1);

if (failures) {
  console.error(`\n${failures} migration test(s) failed`);
  process.exit(1);
}
console.log("\nAll admin migration tests passed");
process.exit(0);
