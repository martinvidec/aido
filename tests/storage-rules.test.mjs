// Security-rules tests for Firebase Storage (issue #13).
// Run via: npm run test:rules  (wraps firebase emulators:exec)
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const ALICE = 'alice-uid';
const BOB = 'bob-uid';

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const image = { contentType: 'image/png' };

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
  storage: { rules: readFileSync('storage.rules', 'utf8') },
});

const bucket = (uid) => testEnv.authenticatedContext(uid).storage();

console.log('Writes:');
await check('owner may upload an image into own prefix', assertSucceeds(
  uploadBytes(ref(bucket(ALICE), `users/${ALICE}/uploads/a.png`), pngBytes, image)));
await check('user may not upload into a foreign prefix', assertFails(
  uploadBytes(ref(bucket(BOB), `users/${ALICE}/uploads/b.png`), pngBytes, image)));
await check('user may not upload outside users/ (path freely chosen)', assertFails(
  uploadBytes(ref(bucket(ALICE), 'public/evil.html'), pngBytes, image)));
await check('non-image content type is rejected (stored XSS vector)', assertFails(
  uploadBytes(ref(bucket(ALICE), `users/${ALICE}/uploads/x.html`),
    new TextEncoder().encode('<script>alert(1)</script>'),
    { contentType: 'text/html' })));
await check('files over 5 MB are rejected', assertFails(
  uploadBytes(ref(bucket(ALICE), `users/${ALICE}/uploads/big.png`),
    new Uint8Array(5 * 1024 * 1024 + 1), image)));
await check('unauthenticated user may not upload', assertFails(
  uploadBytes(ref(testEnv.unauthenticatedContext().storage(), `users/${ALICE}/uploads/c.png`),
    pngBytes, image)));

console.log('Reads:');
await check('authenticated user may read uploads', assertSucceeds(
  getBytes(ref(bucket(BOB), `users/${ALICE}/uploads/a.png`))));
await check('unauthenticated user may not read', assertFails(
  getBytes(ref(testEnv.unauthenticatedContext().storage(), `users/${ALICE}/uploads/a.png`))));

console.log('Deletes:');
await check('non-owner may not delete', assertFails(
  deleteObject(ref(bucket(BOB), `users/${ALICE}/uploads/a.png`))));
await check('owner may delete own file', assertSucceeds(
  deleteObject(ref(bucket(ALICE), `users/${ALICE}/uploads/a.png`))));

await testEnv.cleanup();

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll storage rules tests passed');
