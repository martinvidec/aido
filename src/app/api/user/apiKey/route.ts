import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin';
import {
  API_KEYS_COLLECTION,
  apiKeyDisplayPrefix,
  generateApiKey,
  hashApiKey,
  rateLimit,
} from '@/lib/apiKeys';

// Personal API key management (issue #21). Unlike the discarded prototype:
// - the Firebase ID token is verified server-side (signature, not base64)
// - only a SHA-256 hash is stored, in userApiKeys/{uid} (client access is
//   denied by firestore.rules; all access goes through the Admin SDK)
// - the plaintext key is returned exactly once, on creation

const WRITE_RATE_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };

async function getVerifiedUid(req: NextRequest): Promise<string | NextResponse> {
  const adminAuth = getAdminAuth();
  if (!adminAuth) {
    return NextResponse.json(
      { error: 'API key management is not configured on this deployment' },
      { status: 503 }
    );
  }

  const header = req.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    return decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }
}

export async function GET(req: NextRequest) {
  const uidOrError = await getVerifiedUid(req);
  if (uidOrError instanceof NextResponse) return uidOrError;
  const uid = uidOrError;

  const db = getAdminDb()!;
  const snap = await db.collection(API_KEYS_COLLECTION).doc(uid).get();
  if (!snap.exists) {
    return NextResponse.json({ exists: false });
  }
  const data = snap.data()!;
  return NextResponse.json({
    exists: true,
    keyPrefix: data.keyPrefix ?? null,
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    lastUsedAt: data.lastUsedAt?.toDate?.()?.toISOString() ?? null,
  });
}

export async function POST(req: NextRequest) {
  const uidOrError = await getVerifiedUid(req);
  if (uidOrError instanceof NextResponse) return uidOrError;
  const uid = uidOrError;

  if (!rateLimit(`apiKey:write:${uid}`, WRITE_RATE_LIMIT)) {
    return NextResponse.json(
      { error: 'Too many key operations, try again later' },
      { status: 429 }
    );
  }

  const apiKey = generateApiKey();
  const db = getAdminDb()!;
  await db.collection(API_KEYS_COLLECTION).doc(uid).set({
    keyHash: hashApiKey(apiKey),
    keyPrefix: apiKeyDisplayPrefix(apiKey),
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  });

  // The only moment the plaintext key ever leaves the server.
  return NextResponse.json({
    apiKey,
    keyPrefix: apiKeyDisplayPrefix(apiKey),
  });
}

export async function DELETE(req: NextRequest) {
  const uidOrError = await getVerifiedUid(req);
  if (uidOrError instanceof NextResponse) return uidOrError;
  const uid = uidOrError;

  if (!rateLimit(`apiKey:write:${uid}`, WRITE_RATE_LIMIT)) {
    return NextResponse.json(
      { error: 'Too many key operations, try again later' },
      { status: 429 }
    );
  }

  const db = getAdminDb()!;
  await db.collection(API_KEYS_COLLECTION).doc(uid).delete();
  return NextResponse.json({ deleted: true });
}
