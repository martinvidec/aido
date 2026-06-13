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
