/**
 * Extracts hashtags (words following a #) from a given text.
 * 
 * @param text The input text string.
 * @returns An array of unique hashtag strings (without the leading #).
 */
export function extractHashtags(text: string): string[] {
  if (!text) {
    return [];
  }
  // Regex to find # followed by word characters (letters, numbers, underscore)
  const regex = /#([a-zA-Z0-9_]+)/g;
  const matches = text.match(regex);

  if (!matches) {
    return [];
  }

  // Extract the word part and remove duplicates
  const tags = matches.map(match => match.substring(1)); // Remove the leading #
  return [...new Set(tags)]; // Return unique tags
}

/**
 * Extracts mention UIDs from a Tiptap JSON node structure.
 * 
 * @param node The Tiptap node (or the editor's JSON content).
 * @returns An array of unique mention UIDs.
 */
export function extractMentionIds(node: any): string[] {
  let ids: string[] = [];
  if (!node) return ids;

  // Check the current node
  if (node.type === 'mention' && node.attrs?.id) {
    ids.push(node.attrs.id);
  }

  // Recursively check content if it exists
  if (node.content && Array.isArray(node.content)) {
    node.content.forEach((childNode: any) => {
      ids = ids.concat(extractMentionIds(childNode));
    });
  }
  // Remove duplicates
  return [...new Set(ids)];
}

/**
 * Recursively collects all `text` content from a Tiptap JSON node into a
 * single string (used to scan a rich-text body for #hashtags).
 */
export function extractPlainText(node: any): string {
  if (!node) return '';
  let text = typeof node.text === 'string' ? node.text : '';
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      text += ' ' + extractPlainText(child);
    }
  }
  return text;
}

/**
 * Derives the unique #tags of a todo from its title and (Tiptap) body.
 * Reuses extractHashtags so the redesign keeps the existing tag semantics.
 */
export function deriveTags(title: string, body?: any): string[] {
  return [
    ...new Set([
      ...extractHashtags(title || ''),
      ...extractHashtags(extractPlainText(body)),
    ]),
  ];
}

/** A space member as needed to resolve a plain-text @mention to a uid. */
export interface MentionMember {
  uid: string;
  displayName: string | null;
}

/**
 * Extracts the @mention tokens (the word after each `@`) from PLAIN text.
 *
 * Unicode-aware (issue #75): the previous `\w`-based regex dropped ü/é/ß etc., so
 * German names like "Müller" or "José" never matched. Unicode property escapes
 * (`\p{L}\p{N}`) with the `u` flag handle them. A leading lookbehind keeps `@`
 * from matching mid-word (e.g. inside an e-mail address `a@b.com`).
 */
export function extractMentionTokens(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/(?<![\p{L}\p{N}_])@([\p{L}\p{N}_]+)/gu);
  if (!matches) return [];
  // Strip the leading "@" (and any character the lookbehind let through).
  return [...new Set(matches.map((m) => m.slice(m.indexOf('@') + 1)))];
}

/**
 * Resolves a single plain-text @token to exactly one member uid, or null.
 *
 * Matches the token case-insensitively against each member's full display name
 * or any one of its whitespace-separated words — so both "@Michi" (the first
 * name the autocomplete inserts) and a hand-typed "@Müller" (last name) resolve.
 * The match is EXACT per word, not a prefix: returns null on no match OR on
 * ambiguity (more than one member), so it never silently picks the first member,
 * which could mislabel a different person (issue #75, privacy-sensitive).
 */
export function resolveMentionToken(token: string, members: MentionMember[]): string | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  const hits = members.filter((m) => {
    const name = (m.displayName ?? '').trim().toLowerCase();
    if (!name) return false;
    return name === t || name.split(/\s+/).includes(t);
  });
  return hits.length === 1 ? hits[0].uid : null;
}

/**
 * Derives the unique @mention UIDs of a todo from its (Tiptap) body and,
 * optionally, plain-text @mentions in its title resolved against space members
 * (issue #76). Without `members`, only structured body mentions are returned —
 * preserving the previous behavior for callers that can't resolve names.
 */
export function deriveMentions(
  body?: any,
  title?: string,
  members?: MentionMember[]
): string[] {
  const fromBody = extractMentionIds(body);
  if (!title || !members || members.length === 0) return fromBody;
  const fromTitle = extractMentionTokens(title)
    .map((token) => resolveMentionToken(token, members))
    .filter((uid): uid is string => uid !== null);
  return [...new Set([...fromBody, ...fromTitle])];
}