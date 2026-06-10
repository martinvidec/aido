// Shared URL validation for Tiptap link handling (issue #17).
// Only http(s) and mailto are allowed — javascript:, data:, vbscript: etc.
// must never end up in a stored link mark.

export const ALLOWED_LINK_PROTOCOLS = ['http', 'https', 'mailto'];

export function isSafeLinkUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/^\s*javascript:/i.test(trimmed)) return false;
  const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!match) {
    // Scheme-less inputs ("example.com", "/path") are fine — they resolve
    // relative to the current origin or get a scheme prepended by callers.
    return !trimmed.startsWith('//');
  }
  return ALLOWED_LINK_PROTOCOLS.includes(match[1].toLowerCase());
}

// Normalizes toolbar input: prepends https:// to scheme-less values like
// "example.com" and returns null for anything that fails the allowlist.
export function normalizeLinkUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!isSafeLinkUrl(trimmed)) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !trimmed.startsWith('/')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}
