import type { Timestamp } from "firebase/firestore";

/**
 * Space — the organizing unit of the redesign (issue #40). Replaces the
 * "My Todos / Shared with me" split: membership grants access to everything in
 * the space. Stored top-level at `spaces/{spaceId}`; authority lives in
 * firestore.rules.
 */
export interface Space {
  /** Firestore document id. */
  id: string;
  name: string;
  /** oklch hue angle; see src/lib/theme/colors.ts (data model: color = oklch-Hue). */
  color: number;
  /** userIds with access to the space. */
  members: string[];
  /** userId of the creator (immutable; only the creator may delete the space). */
  createdBy: string;
  /** Server timestamp; null while a serverTimestamp() write is still pending. */
  createdAt: Timestamp | null;
}

/** Tiptap rich-text JSON (ProseMirror document). Loosely typed to avoid pulling
 *  a hard @tiptap dependency into this shared types module. */
export type TiptapContent = Record<string, unknown>;

/**
 * Todo — structured task in a space (issue #41). Lives under
 * `spaces/{spaceId}/todos/{id}` (moved out of users/{uid}/todos so every space
 * member has full access). `tags`/`mentions` are derived from title/body on write.
 */
export interface Todo {
  id: string;
  /** Redundant with the path, kept for convenience/denormalization. */
  spaceId: string;
  title: string;
  /** Rich-text body as Tiptap JSON (the original TipTap use case). */
  body: TiptapContent | null;
  completed: boolean;
  /** userId this todo is waiting on, or null. Drives the board "bei X" columns. */
  waitingOn: string | null;
  tags: string[];
  mentions: string[];
  /** Author; immutable after creation. */
  createdBy: string;
  createdAt: Timestamp | null;
  /** Manual sort order (board drag & drop / list ordering). */
  order: number;
}

/**
 * Daily — short-lived "Heute" item (issue #41). Lives under
 * `spaces/{spaceId}/daily/{id}`, deliberately separate from todos so it never
 * appears in the main list.
 */
export interface Daily {
  id: string;
  spaceId: string;
  text: string;
  completed: boolean;
  /** Local date as YYYY-MM-DD (lexicographically comparable). */
  date: string;
  /** userId of the author; immutable after creation. */
  author: string;
  createdAt: Timestamp | null;
}
