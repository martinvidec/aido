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
  /**
   * userId of the last writer. The rules enforce `modifiedBy == auth.uid` on
   * every create/update, so the "who wrote this" check no longer rides on
   * `createdBy` — that lets `createdBy` survive a move to another space while
   * staying unforgeable (issue #198).
   */
  modifiedBy: string;
  createdAt: Timestamp | null;
  /**
   * Sort key for the stable `orderBy("order","asc")` list/board sort. Set to
   * `maxOrder + 1` at creation (new todos land at the end) and rewritten on
   * manual reordering (issue #235, epic #234): a moved todo gets the midpoint of
   * its new neighbours, so values may be fractional. `normalizeTodoOrders`
   * renumbers to clean integers when a gap gets too small or ties appear.
   */
  order: number;
  /**
   * Agent-Sessions (epic #212): the Claude-Code session this todo is bound to
   * (a sessionId under `users/{uid}/sessions`), or null. Set/cleared only via
   * the web UI; the MCP session tools never change the binding.
   */
  attachedSession: string | null;
  /**
   * Whose turn it is while attached: `aido` = queued for the session to pick up,
   * `user` = the session handed it back (still open). null when not attached.
   */
  aidoTurn: "aido" | "user" | null;
  /** sessionId currently holding the claim (`next-todo`), or null. */
  claimedBy: string | null;
  /** When the claim was taken; basis for the lease (see `leaseTtlSeconds`). */
  claimedAt: Timestamp | null;
  /** Last time a session wrote the body — drives the "von aido" marker. */
  lastAidoEditAt: Timestamp | null;
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

/** Tool actions a session may perform; enforced server-side by the MCP layer. */
export type AgentToolName = "update-todo" | "handoff" | "complete-todo";

/**
 * Agent-Session (epic #212) — a running Claude-Code session bound to ONE space,
 * stored owner-only at `users/{uid}/sessions/{sessionId}` (the id is derived
 * deterministically from spaceId+hostname+workingFolder). Deliberately named
 * "Agent-Session" to avoid confusion with the device-/login sessions.
 */
export interface AgentSession {
  /** Firestore document id = sha256(spaceId|hostname|workingFolder). */
  id: string;
  /** The single space this session works in. */
  spaceId: string;
  hostname: string;
  workingFolder: string;
  /** Optional human label shown in the attach picker. */
  label: string | null;
  /** Actions this session may perform; default `['update-todo','handoff']`. */
  allowedTools: AgentToolName[];
  /** Claim lease in seconds; default from the user's `agentSessionDefaults`. */
  leaseTtlSeconds: number;
  createdAt: Timestamp | null;
  /** Heartbeat: refreshed by `register-session` and `next-todo`. */
  lastSeenAt: Timestamp | null;
}
