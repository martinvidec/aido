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
  listDaily,
  addDaily,
  deleteTodo,
  whoami,
  listMembers,
  registerSession,
  nextTodo,
  updateTodo,
  handoffTodo,
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
  sessionId?: string;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  enforceWriteRateLimit(uid);
  return jsonResult(await completeTodo(uid, args.spaceId, args.todoId, args.completed, args.sessionId));
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

export async function handleListDaily(args: {
  spaceId: string;
  date?: string;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  return jsonResult(await listDaily(uid, args.spaceId, args.date));
}

export async function handleAddDaily(args: {
  spaceId: string;
  text: string;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  enforceWriteRateLimit(uid);
  return jsonResult(await addDaily(uid, args.spaceId, args.text));
}

export async function handleDeleteTodo(args: {
  spaceId: string;
  todoId: string;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  enforceWriteRateLimit(uid);
  return jsonResult(await deleteTodo(uid, args.spaceId, args.todoId));
}

export async function handleWhoami(): Promise<CallToolResult> {
  const uid = requireUserUid();
  return jsonResult(await whoami(uid));
}

export async function handleListMembers(args: { spaceId: string }): Promise<CallToolResult> {
  const uid = requireUserUid();
  return jsonResult(await listMembers(uid, args.spaceId));
}

// --- Agent-Sessions (epic #212, issue #216) ---

export async function handleRegisterSession(args: {
  spaceId: string;
  hostname: string;
  workingFolder: string;
  label?: string;
  allowedTools?: string[];
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  return jsonResult(await registerSession(uid, args));
}

// next-todo claims a todo (a write) but is the loop's polling mechanism, so it is
// deliberately NOT subject to the write rate limit — only the content-mutating
// tools below are (issue #216, NFA-06).
export async function handleNextTodo(args: {
  spaceId: string;
  hostname: string;
  workingFolder: string;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  const todo = await nextTodo(uid, args);
  return jsonResult({ todo });
}

export async function handleUpdateTodo(args: {
  sessionId: string;
  spaceId: string;
  todoId: string;
  bodyMarkdown: string;
  mode?: "append" | "replace";
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  enforceWriteRateLimit(uid);
  return jsonResult(await updateTodo(uid, args));
}

export async function handleHandoff(args: {
  sessionId: string;
  spaceId: string;
  todoId: string;
}): Promise<CallToolResult> {
  const uid = requireUserUid();
  enforceWriteRateLimit(uid);
  return jsonResult(await handoffTodo(uid, args));
}
