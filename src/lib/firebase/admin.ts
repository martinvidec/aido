import 'server-only';
import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

// Server-side Firebase Admin access. Requires FIREBASE_SERVICE_ACCOUNT_KEY
// (the service account JSON as a single-line string) in the environment.
// Without it the helpers return null and callers must answer 503 — the
// feature degrades, it never falls back to something insecure.

const ADMIN_APP_NAME = 'admin';

function getAdminApp(): App | null {
  const existing = getApps().find((a) => a.name === ADMIN_APP_NAME);
  if (existing) return existing;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountJson) return null;

  try {
    const credentials = JSON.parse(serviceAccountJson);
    return initializeApp({ credential: cert(credentials) }, ADMIN_APP_NAME);
  } catch (error) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON:', error);
    return null;
  }
}

export function getAdminAuth(): Auth | null {
  const app = getAdminApp();
  return app ? getAuth(app) : null;
}

export function getAdminDb(): Firestore | null {
  const app = getAdminApp();
  return app ? getFirestore(app) : null;
}
