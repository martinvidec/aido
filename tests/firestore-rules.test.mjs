// Security-rules tests for todos (issue #12).
// Run via: npm run test:rules  (wraps firebase emulators:exec)
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  collectionGroup,
  query,
  where,
  getDocs,
} from 'firebase/firestore';

const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const MALLORY = 'mallory-uid';
const VICTIM = 'victim-uid';

const TODO_PATH = `users/${ALICE}/todos/todo-1`;

const seedTodo = {
  text: 'original text',
  content: { type: 'doc', content: [] },
  completed: false,
  sharedWith: [BOB],
  mentionedUsers: [],
  tags: [],
};

let failures = 0;
async function check(name, promise) {
  try {
    await promise;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

async function resetTodo() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), TODO_PATH), seedTodo);
  });
}

const db = (uid) => testEnv.authenticatedContext(uid).firestore();

await resetTodo();

console.log('Sharee permissions:');
await check('sharee may toggle completed', assertSucceeds(
  updateDoc(doc(db(BOB), TODO_PATH), { completed: true })));
await check('sharee may not write non-bool completed', assertFails(
  updateDoc(doc(db(BOB), TODO_PATH), { completed: 'yes' })));
await check('sharee may not change text/content', assertFails(
  updateDoc(doc(db(BOB), TODO_PATH), { text: 'defaced', content: {} })));
await check('sharee may not change completed together with other fields', assertFails(
  updateDoc(doc(db(BOB), TODO_PATH), { completed: true, text: 'defaced' })));
await check('sharee may not extend sharedWith (takeover)', assertFails(
  updateDoc(doc(db(BOB), TODO_PATH), { sharedWith: [BOB, MALLORY] })));
await check('sharee may not inject mentionedUsers (feed spam)', assertFails(
  updateDoc(doc(db(BOB), TODO_PATH), { mentionedUsers: [VICTIM] })));
await check('sharee may not delete the todo', assertFails(
  deleteDoc(doc(db(BOB), TODO_PATH))));
await check('sharee may read the todo', assertSucceeds(
  getDoc(doc(db(BOB), TODO_PATH))));

console.log('Non-shared user:');
await check('outsider may not read the todo', assertFails(
  getDoc(doc(db(MALLORY), TODO_PATH))));
await check('outsider may not update the todo', assertFails(
  updateDoc(doc(db(MALLORY), TODO_PATH), { completed: true })));

console.log('Owner permissions:');
await resetTodo();
await check('owner may edit content/text/mentions/tags', assertSucceeds(
  updateDoc(doc(db(ALICE), TODO_PATH), {
    text: 'new', content: { type: 'doc' }, mentionedUsers: [VICTIM], tags: ['x'],
  })));
await check('owner may share via sharedWith list', assertSucceeds(
  updateDoc(doc(db(ALICE), TODO_PATH), { sharedWith: [BOB, MALLORY] })));
await check('owner may not set sharedWith to a non-list', assertFails(
  updateDoc(doc(db(ALICE), TODO_PATH), { sharedWith: 'everyone' })));
await check('owner may not set mentionedUsers to a non-list', assertFails(
  updateDoc(doc(db(ALICE), TODO_PATH), { mentionedUsers: 'everyone' })));
await check('owner may create a todo', assertSucceeds(
  setDoc(doc(db(ALICE), `users/${ALICE}/todos/todo-2`), seedTodo)));
await check('owner may not create with non-list sharedWith', assertFails(
  setDoc(doc(db(ALICE), `users/${ALICE}/todos/todo-3`), { ...seedTodo, sharedWith: 'all' })));
await check('non-owner may not create in foreign collection', assertFails(
  setDoc(doc(db(BOB), `users/${ALICE}/todos/todo-4`), seedTodo)));
await check('owner may delete a todo', assertSucceeds(
  deleteDoc(doc(db(ALICE), `users/${ALICE}/todos/todo-2`))));

console.log('User docs (PII) and public profiles:');
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `users/${ALICE}`), {
    email: 'alice@example.com', displayName: 'Alice', theme: 'system',
  });
});
await check('owner may read own user doc', assertSucceeds(
  getDoc(doc(db(ALICE), `users/${ALICE}`))));
await check('other users may not read a foreign user doc (PII)', assertFails(
  getDoc(doc(db(BOB), `users/${ALICE}`))));
await check('users collection may not be enumerated', assertFails(
  getDocs(query(collection(db(BOB), 'users'),
    where('email', '>=', 'a'), where('email', '<=', 'a')))));
await check('owner may write own public profile', assertSucceeds(
  setDoc(doc(db(ALICE), `publicProfiles/${ALICE}`), {
    displayName: 'Alice', displayNameLower: 'alice', photoURL: null, emailHash: 'abc123',
  })));
await check('public profile may not contain extra fields (e.g. email)', assertFails(
  setDoc(doc(db(ALICE), `publicProfiles/${ALICE}`), {
    displayName: 'Alice', email: 'alice@example.com',
  })));
await check('user may not write a foreign public profile', assertFails(
  setDoc(doc(db(BOB), `publicProfiles/${ALICE}`), { displayName: 'Mallory' })));
await check('authenticated users may read public profiles', assertSucceeds(
  getDoc(doc(db(BOB), `publicProfiles/${ALICE}`))));
await check('authenticated users may query profiles by displayNameLower', assertSucceeds(
  getDocs(query(collection(db(BOB), 'publicProfiles'),
    where('displayNameLower', '>=', 'ali'), where('displayNameLower', '<=', 'ali')))));
await check('authenticated users may query profiles by emailHash', assertSucceeds(
  getDocs(query(collection(db(BOB), 'publicProfiles'),
    where('emailHash', '==', 'abc123')))));
await check('unauthenticated user may not read public profiles', assertFails(
  getDoc(doc(testEnv.unauthenticatedContext().firestore(), `publicProfiles/${ALICE}`))));

console.log('API key hashes (admin-only collection):');
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `userApiKeys/${ALICE}`), {
    keyHash: 'deadbeef', keyPrefix: 'aido_xxxx',
  });
});
await check('not even the owner may read their API key doc', assertFails(
  getDoc(doc(db(ALICE), `userApiKeys/${ALICE}`))));
await check('clients may not write API key docs', assertFails(
  setDoc(doc(db(ALICE), `userApiKeys/${ALICE}`), { keyHash: 'forged' })));
await check('clients may not query the API key collection', assertFails(
  getDocs(query(collection(db(ALICE), 'userApiKeys'),
    where('keyHash', '==', 'deadbeef')))));

console.log('Reads (single authoritative collection group rule):');
await resetTodo();
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `users/${ALICE}/todos/todo-mention`), {
    ...seedTodo, sharedWith: [], mentionedUsers: [VICTIM],
  });
});
await check('owner may read own todo directly', assertSucceeds(
  getDoc(doc(db(ALICE), TODO_PATH))));
await check('mentioned user may read the todo directly', assertSucceeds(
  getDoc(doc(db(VICTIM), `users/${ALICE}/todos/todo-mention`))));
await check('mentioned user may run collection group query', assertSucceeds(
  getDocs(query(collectionGroup(db(VICTIM), 'todos'),
    where('mentionedUsers', 'array-contains', VICTIM)))));
await check('sharee may run collection group query', assertSucceeds(
  getDocs(query(collectionGroup(db(BOB), 'todos'),
    where('sharedWith', 'array-contains', BOB)))));
await check('unauthenticated user may not read', assertFails(
  getDoc(doc(testEnv.unauthenticatedContext().firestore(), TODO_PATH))));

console.log('Spaces (issue #40):');
const SPACE_PATH = `spaces/space-1`;
const seedSpace = {
  name: 'Family', color: 40, members: [ALICE, BOB], createdBy: ALICE, createdAt: 1700000000000,
};
async function resetSpace() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), SPACE_PATH), seedSpace);
  });
}
await resetSpace();

console.log('  reads:');
await check('member may read a space', assertSucceeds(
  getDoc(doc(db(ALICE), SPACE_PATH))));
await check('second member may read a space', assertSucceeds(
  getDoc(doc(db(BOB), SPACE_PATH))));
await check('non-member may not read a space', assertFails(
  getDoc(doc(db(MALLORY), SPACE_PATH))));
await check('member may query own spaces by membership', assertSucceeds(
  getDocs(query(collection(db(BOB), 'spaces'),
    where('members', 'array-contains', BOB)))));
await check('non-member may not list all spaces', assertFails(
  getDocs(query(collection(db(MALLORY), 'spaces'),
    where('members', 'array-contains', ALICE)))));

console.log('  create:');
await check('user may create a space with self as creator+member', assertSucceeds(
  setDoc(doc(db(ALICE), 'spaces/space-new'), {
    name: 'New', color: 200, members: [ALICE], createdBy: ALICE, createdAt: 1 })));
await check('user may not create a space owned by someone else', assertFails(
  setDoc(doc(db(MALLORY), 'spaces/space-forge'), {
    name: 'X', color: 0, members: [MALLORY], createdBy: ALICE, createdAt: 1 })));
await check('user may not create a space without being a member', assertFails(
  setDoc(doc(db(MALLORY), 'spaces/space-nomember'), {
    name: 'X', color: 0, members: [ALICE], createdBy: MALLORY, createdAt: 1 })));
await check('user may not create a space with non-list members', assertFails(
  setDoc(doc(db(ALICE), 'spaces/space-badmembers'), {
    name: 'X', color: 0, members: 'everyone', createdBy: ALICE, createdAt: 1 })));

console.log('  update / invite:');
await resetSpace();
await check('member may rename the space', assertSucceeds(
  updateDoc(doc(db(ALICE), SPACE_PATH), { name: 'Renamed' })));
// MALLORY is not in members ([ALICE, BOB]) — check this before the invite test
// below adds them, otherwise it would no longer be testing a non-member.
await check('non-member may not update the space', assertFails(
  updateDoc(doc(db(MALLORY), SPACE_PATH), { name: 'hijacked' })));
await check('member may not change createdBy (takeover)', assertFails(
  updateDoc(doc(db(BOB), SPACE_PATH), { createdBy: BOB })));
await check('member may not rewrite createdAt', assertFails(
  updateDoc(doc(db(ALICE), SPACE_PATH), { createdAt: 1 })));
await check('member may not set members to a non-list', assertFails(
  updateDoc(doc(db(ALICE), SPACE_PATH), { members: 'everyone' })));
// Mutates members, so keep it last in this section.
await check('member may invite another member', assertSucceeds(
  updateDoc(doc(db(BOB), SPACE_PATH), { members: [ALICE, BOB, MALLORY] })));

// Creator may never be removed from members (issue #64) — otherwise the space
// is orphaned and undeletable. These run after a reset to a clean [ALICE, BOB].
await resetSpace();
await check('member may not remove the creator (orphan)', assertFails(
  updateDoc(doc(db(BOB), SPACE_PATH), { members: [BOB] })));
await check('creator may not remove themselves', assertFails(
  updateDoc(doc(db(ALICE), SPACE_PATH), { members: [BOB] })));
await check('member may remove a non-creator member', assertSucceeds(
  updateDoc(doc(db(ALICE), SPACE_PATH), { members: [ALICE] })));

console.log('  delete:');
await resetSpace();
await check('non-creator member may not delete the space', assertFails(
  deleteDoc(doc(db(BOB), SPACE_PATH))));
await check('non-member may not delete the space', assertFails(
  deleteDoc(doc(db(MALLORY), SPACE_PATH))));
await check('creator may delete the space', assertSucceeds(
  deleteDoc(doc(db(ALICE), SPACE_PATH))));

console.log('Space todos & daily (issue #41):');
const TS = 'space-todos';
const TODO2_PATH = `spaces/${TS}/todos/t1`;
const DAILY_PATH = `spaces/${TS}/daily/d1`;
async function resetSpaceTodos() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `spaces/${TS}`), {
      name: 'S', color: 40, members: [ALICE, BOB], createdBy: ALICE, createdAt: 1 });
    await setDoc(doc(ctx.firestore(), TODO2_PATH), {
      spaceId: TS, title: 't', body: null, completed: false, waitingOn: null,
      tags: [], mentions: [], createdBy: ALICE, createdAt: 1, order: 0 });
    await setDoc(doc(ctx.firestore(), DAILY_PATH), {
      spaceId: TS, text: 'milk', completed: false, date: '2020-01-01', author: ALICE, createdAt: 1 });
  });
}
await resetSpaceTodos();

console.log('  todo reads:');
await check('space member may read a space todo', assertSucceeds(
  getDoc(doc(db(BOB), TODO2_PATH))));
await check('non-member may not read a space todo', assertFails(
  getDoc(doc(db(MALLORY), TODO2_PATH))));
await check('member may list space todos', assertSucceeds(
  getDocs(collection(db(BOB), `spaces/${TS}/todos`))));
await check('non-member may not list space todos', assertFails(
  getDocs(collection(db(MALLORY), `spaces/${TS}/todos`))));

console.log('  todo writes (full collaboration):');
await check('member (non-creator) may create a todo', assertSucceeds(
  setDoc(doc(db(BOB), `spaces/${TS}/todos/t2`), {
    spaceId: TS, title: 'b', body: null, completed: false, waitingOn: null,
    tags: [], mentions: [], createdBy: BOB, createdAt: 1, order: 1 })));
await check('member may not create a todo authored by someone else', assertFails(
  setDoc(doc(db(BOB), `spaces/${TS}/todos/t3`), {
    spaceId: TS, title: 'x', completed: false, waitingOn: null,
    tags: [], mentions: [], createdBy: ALICE, createdAt: 1, order: 1 })));
await check('non-member may not create a todo', assertFails(
  setDoc(doc(db(MALLORY), `spaces/${TS}/todos/t4`), {
    spaceId: TS, title: 'x', completed: false, waitingOn: null,
    tags: [], mentions: [], createdBy: MALLORY, createdAt: 1, order: 1 })));
await check('member may not create a todo with non-list tags', assertFails(
  setDoc(doc(db(ALICE), `spaces/${TS}/todos/t5`), {
    spaceId: TS, title: 'x', completed: false, waitingOn: null,
    tags: 'a', mentions: [], createdBy: ALICE, createdAt: 1, order: 1 })));
await check('member (non-creator) may edit a todo (content + completed)', assertSucceeds(
  updateDoc(doc(db(BOB), TODO2_PATH), { title: 'edited', completed: true })));
await check('member may not change a todo createdBy (takeover)', assertFails(
  updateDoc(doc(db(BOB), TODO2_PATH), { createdBy: BOB })));
await check('non-member may not update a todo', assertFails(
  updateDoc(doc(db(MALLORY), TODO2_PATH), { completed: true })));

console.log('  waitingOn validation:');
await check('member may set waitingOn to a space member', assertSucceeds(
  updateDoc(doc(db(ALICE), TODO2_PATH), { waitingOn: BOB })));
await check('member may clear waitingOn (null)', assertSucceeds(
  updateDoc(doc(db(ALICE), TODO2_PATH), { waitingOn: null })));
await check('member may not set waitingOn to a non-member', assertFails(
  updateDoc(doc(db(ALICE), TODO2_PATH), { waitingOn: MALLORY })));

console.log('  todo delete:');
await check('non-member may not delete a todo', assertFails(
  deleteDoc(doc(db(MALLORY), TODO2_PATH))));
await check('member may delete a todo', assertSucceeds(
  deleteDoc(doc(db(BOB), TODO2_PATH))));

console.log('  daily:');
await check('member may read a daily item', assertSucceeds(
  getDoc(doc(db(BOB), DAILY_PATH))));
await check('non-member may not read a daily item', assertFails(
  getDoc(doc(db(MALLORY), DAILY_PATH))));
await check('member may create own daily item', assertSucceeds(
  setDoc(doc(db(BOB), `spaces/${TS}/daily/d2`), {
    spaceId: TS, text: 'x', completed: false, date: '2020-01-02', author: BOB, createdAt: 1 })));
await check('member may not create a daily item authored by someone else', assertFails(
  setDoc(doc(db(BOB), `spaces/${TS}/daily/d3`), {
    spaceId: TS, text: 'x', completed: false, date: '2020-01-02', author: ALICE, createdAt: 1 })));
await check('non-member may not create a daily item', assertFails(
  setDoc(doc(db(MALLORY), `spaces/${TS}/daily/d4`), {
    spaceId: TS, text: 'x', completed: false, date: '2020-01-02', author: MALLORY, createdAt: 1 })));
await check('member (non-author) may toggle daily completed', assertSucceeds(
  updateDoc(doc(db(BOB), DAILY_PATH), { completed: true })));
await check('member may not change a daily author', assertFails(
  updateDoc(doc(db(BOB), DAILY_PATH), { author: BOB })));
await check('non-member may not delete a daily item', assertFails(
  deleteDoc(doc(db(MALLORY), `spaces/${TS}/daily/d2`))));
await check('member may delete a daily item', assertSucceeds(
  deleteDoc(doc(db(ALICE), DAILY_PATH))));

console.log('Legacy todo migration writes (issue #48):');
await check('owner may create a space with migration marker fields', assertSucceeds(
  setDoc(doc(db(ALICE), 'spaces/space-mig'), {
    name: 'Privat', color: 40, members: [ALICE], createdBy: ALICE, createdAt: 1,
    migratedDefault: true })));
await check('owner may create a shared migration space (owner + sharee)', assertSucceeds(
  setDoc(doc(db(ALICE), 'spaces/space-mig-shared'), {
    name: 'Geteilt', color: 200, members: [ALICE, BOB], createdBy: ALICE, createdAt: 1,
    migratedShareKey: `${ALICE},${BOB}` })));
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `users/${ALICE}/todos/legacy-1`), {
    text: 'old todo', content: { type: 'doc', content: [] }, completed: false,
    sharedWith: [BOB], mentionedUsers: [], tags: [] });
});
await check('owner may tag a legacy todo with migratedTo', assertSucceeds(
  updateDoc(doc(db(ALICE), `users/${ALICE}/todos/legacy-1`), {
    migratedTo: 'spaces/space-mig/todos/new-1' })));
await check('owner may set the migration flag on their user doc', assertSucceeds(
  setDoc(doc(db(ALICE), `users/${ALICE}`), { todosMigratedToSpacesAt: 1 }, { merge: true })));

await testEnv.cleanup();

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll rules tests passed');
