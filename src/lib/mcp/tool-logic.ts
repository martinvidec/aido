import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getPrincipal } from "./context";
import { McpToolError, listSpacesForUid, listTodos } from "./data";

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
