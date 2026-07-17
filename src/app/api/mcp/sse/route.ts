import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import type { NextRequest } from "next/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { authenticateMcp } from "@/lib/mcp/auth";
import { runWithPrincipal } from "@/lib/mcp/context";
import { McpToolError } from "@/lib/mcp/data";
import {
  handleListSpaces,
  handleListTodos,
  handleAddTodo,
  handleCompleteTodo,
  handleSetWaitingOn,
  handleListDaily,
  handleAddDaily,
  handleDeleteTodo,
  handleWhoami,
  handleListMembers,
  handleRegisterSession,
  handleNextTodo,
  handleUpdateTodo,
  handleHandoff,
  handlePostMessage,
  handleListMessages,
  errorResult,
} from "@/lib/mcp/tool-logic";

// MCP endpoint (epic #124). The transport is handled by `mcp-handler` (the
// Next.js/Vercel MCP adapter) — streamable HTTP in stateless mode, which works
// on serverless without the in-memory session map the old hand-rolled
// node-mocks-http shim relied on. Tool logic lives in tool-logic.ts/data.ts.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Turn an McpToolError (membership / validation / not-found / rate-limit) into a
// clean MCP error result instead of an unhandled throw. Zod input validation is
// done by the SDK before the callback runs, so only McpToolError reaches here.
async function safe(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof McpToolError) return errorResult(`${e.code}: ${e.message}`);
    console.error("[mcp tool] unexpected error", e);
    return errorResult("Internal error during tool execution.");
  }
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.tool(
      "list-spaces",
      "Lists the spaces you are a member of, with member and open-todo counts.",
      () => safe(() => handleListSpaces())
    );
    server.tool(
      "list-todos",
      "Lists todos in a space you are a member of.",
      {
        spaceId: z.string().min(1),
        includeCompleted: z.boolean().optional(),
        tag: z.string().optional(),
      },
      (args) => safe(() => handleListTodos(args))
    );
    server.tool(
      "add-todo",
      "Creates a todo in a space you are a member of.",
      {
        spaceId: z.string().min(1),
        title: z.string().min(1),
        bodyText: z.string().optional(),
        waitingOn: z.string().nullable().optional(),
      },
      (args) => safe(() => handleAddTodo(args))
    );
    server.tool(
      "complete-todo",
      "Marks a todo complete or open again. Pass sessionId when completing the todo your agent session has claimed (requires the 'complete-todo' allowlist entry).",
      {
        spaceId: z.string().min(1),
        todoId: z.string().min(1),
        completed: z.boolean(),
        sessionId: z.string().optional(),
      },
      (args) => safe(() => handleCompleteTodo(args))
    );
    server.tool(
      "set-waiting-on",
      "Sets (or clears) the member a todo is waiting on.",
      { spaceId: z.string().min(1), todoId: z.string().min(1), userId: z.string().nullable() },
      (args) => safe(() => handleSetWaitingOn(args))
    );
    server.tool(
      "list-daily",
      'Lists a space\'s short-lived "Heute" items for a date (default today).',
      { spaceId: z.string().min(1), date: z.string().optional() },
      (args) => safe(() => handleListDaily(args))
    );
    server.tool(
      "add-daily",
      'Adds a short-lived "Heute" item dated today.',
      { spaceId: z.string().min(1), text: z.string().min(1) },
      (args) => safe(() => handleAddDaily(args))
    );
    server.tool(
      "delete-todo",
      "Deletes a todo from a space you are a member of.",
      { spaceId: z.string().min(1), todoId: z.string().min(1) },
      (args) => safe(() => handleDeleteTodo(args))
    );
    server.tool(
      "whoami",
      "Returns the uid and display name of the personal API key owner.",
      () => safe(() => handleWhoami())
    );
    server.tool(
      "list-members",
      "Lists the members (uid + display name) of a space you belong to.",
      { spaceId: z.string().min(1) },
      (args) => safe(() => handleListMembers(args))
    );
    // --- Agent-Sessions (epic #212): the work loop ---
    server.tool(
      "register-session",
      "Registers (or refreshes) a Claude-Code agent session bound to one space. Call this FIRST; returns a sessionId for update-todo/handoff. Default allowlist is ['update-todo','handoff'].",
      {
        spaceId: z.string().min(1),
        hostname: z.string().min(1),
        workingFolder: z.string().min(1),
        label: z.string().optional(),
        allowedTools: z.array(z.enum(["update-todo", "handoff", "complete-todo", "post-message"])).optional(),
      },
      (args) => safe(() => handleRegisterSession(args))
    );
    server.tool(
      "next-todo",
      "Claims and returns the oldest open todo bound to this session (identified by hostname+workingFolder+spaceId), with its body as Markdown and its discussion thread (field 'thread'). Returns {todo:null} when nothing is queued.",
      { spaceId: z.string().min(1), hostname: z.string().min(1), workingFolder: z.string().min(1) },
      (args) => safe(() => handleNextTodo(args))
    );
    server.tool(
      "update-todo",
      "Writes the RESULT of your work into the BODY of the todo your session has claimed, from Markdown (code blocks supported). mode 'replace' (default) overwrites the body with the current result; 'append' adds a block to it. Do NOT put questions or the back-and-forth conversation here — use post-message (the discussion thread) for that.",
      {
        sessionId: z.string().min(1),
        spaceId: z.string().min(1),
        todoId: z.string().min(1),
        bodyMarkdown: z.string(),
        mode: z.enum(["append", "replace"]).optional(),
      },
      (args) => safe(() => handleUpdateTodo(args))
    );
    server.tool(
      "handoff",
      "Hands the claimed todo back to the human (keeps it open) and releases the claim. Post any open question to the thread FIRST (post-message) so the human sees what you need; they answer in the thread and re-attach the todo for you to continue.",
      { sessionId: z.string().min(1), spaceId: z.string().min(1), todoId: z.string().min(1) },
      (args) => safe(() => handleHandoff(args))
    );
    server.tool(
      "post-message",
      "Posts a message from your session into the DISCUSSION THREAD of the todo you currently have claimed (Markdown; code blocks supported). Use this for questions, clarifications and rework notes — keep the conversation OUT of the todo body (that is for the result). Requires the 'post-message' allowlist entry.",
      {
        sessionId: z.string().min(1),
        spaceId: z.string().min(1),
        todoId: z.string().min(1),
        bodyMarkdown: z.string().min(1),
      },
      (args) => safe(() => handlePostMessage(args))
    );
    server.tool(
      "list-messages",
      "Lists the discussion thread of a todo you can access (oldest first), each message as Markdown with its author.",
      { spaceId: z.string().min(1), todoId: z.string().min(1) },
      (args) => safe(() => handleListMessages(args))
    );
  },
  { serverInfo: { name: "aido-mcp-server", version: "0.2.0" } },
  { streamableHttpEndpoint: "/api/mcp/sse", disableSse: true, verboseLogs: false }
);

// Authenticate (shared token or personal API key → uid) and run the MCP handler
// inside the per-request principal scope so tools resolve THIS request's user
// (issues #117/#119). Personal-key data tools require the uid; the shared token
// only reaches transport-level methods (initialize / tools/list).
async function handler(req: NextRequest): Promise<Response> {
  const auth = await authenticateMcp(req);
  if (!auth.ok) return auth.response;
  return runWithPrincipal(auth.principal, () => mcpHandler(req));
}

export { handler as GET, handler as POST, handler as DELETE };
