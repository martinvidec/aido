import { createHash, randomBytes } from 'node:crypto';

// Personal API keys (issue #21): only the SHA-256 hash is ever persisted;
// the plaintext exists exactly once, in the POST response that created it.

export const API_KEY_PREFIX = 'aido_';
export const API_KEYS_COLLECTION = 'userApiKeys';

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

// Display prefix stored alongside the hash so the UI can show which key is
// active ("aido_AbCd…") without ever seeing the key again.
export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + 4);
}

// Minimal fixed-window rate limiter, keyed per uid+operation. State is
// per serverless instance — a basic brake against scripted key churn, not
// a distributed quota.
const buckets = new Map<string, { windowStart: number; count: number }>();

export function rateLimit(
  key: string,
  { max, windowMs }: { max: number; windowMs: number }
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count++;
  return true;
}
