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

await testEnv.cleanup();

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll rules tests passed');
