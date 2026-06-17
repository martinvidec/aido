import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { rateLimit } from "@/lib/apiKeys";
import { getPrincipal } from "./context";
import {
  McpToolError,
  listSpacesForUid,
  listTodos,
  addTodo,
  completeTodo,
  setWaitingOn,
} from "./data";

// Firestore-backed MCP tool handlers (issue #119). Each handler resolves the
// current request's user (from the AsyncLocalStorage principal), runs the
// member-gated data access, and returns an MCP content block. McpToolError
// thrown by the data layer is mapped to an error result by the tools/call
// dispatch in route.ts.

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

// Data tools require a personal API key (→ uid). The shared MCP token has no
// user identity, so it is rejected here.
function requireUserUid(): string {
  const principal = getPrincipal();
  if (!principal || principal.kind !== "user") {
    throw new McpToolError(
      "unauthorized",
      "This tool requires a personal API key (aido_…); the shared MCP token has no user identity."
    );
  }
  return principal.uid;
}

// Lightweight per-uid write throttle (issue #120), reusing the fixed-window
// limiter from apiKeys. Per serverless instance — a brake against scripted
// spam, not a distributed quota.
const WRITE_RATE_LIMIT = { max: 30, windowMs: 60_000 };
function enforceWriteRateLimit(uid: string): void {
  if (!rateLimit(`mcp:write:${uid}`, WRITE_RATE_LIMIT)) {
    throw new McpToolError("rate_limited", "Too many writes; slow down and retry shortly.");
  }
}

export async function handleListSpaces(): Promise<CallToolResult> {
  const uid = requireUserUid();
  return jsonResult(await listSpacesForUid(uid));
}

export async function handleListTodos(args: {
  spaceId: string;
  includeCompleted?: boolean;
  tag?: string;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  const todos = await listTodos(uid, args.spaceId, {
    includeCompleted: args.includeCompleted,
    tag: args.tag,
  });
  return jsonResult(todos);
}

export async function handleAddTodo(args: {
  spaceId: string;
  title: string;
  bodyText?: string;
  waitingOn?: string | null;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  enforceWriteRateLimit(uid);
  const todo = await addTodo(uid, args.spaceId, {
    title: args.title,
    bodyText: args.bodyText,
    waitingOn: args.waitingOn,
  });
  return jsonResult(todo);
}

export async function handleCompleteTodo(args: {
  spaceId: string;
  todoId: string;
  completed: boolean;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  enforceWriteRateLimit(uid);
  return jsonResult(await completeTodo(uid, args.spaceId, args.todoId, args.completed));
}

export async function handleSetWaitingOn(args: {
  spaceId: string;
  todoId: string;
  userId: string | null;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  enforceWriteRateLimit(uid);
  return jsonResult(await setWaitingOn(uid, args.spaceId, args.todoId, args.userId));
}
