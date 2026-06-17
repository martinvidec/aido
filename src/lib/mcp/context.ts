import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { McpPrincipal } from "./auth";

// Per-request MCP principal (issue #119). The MCP SDK registers tool handlers
// once per session, but the authenticated identity is per HTTP request (from the
// Authorization header). Binding the uid to the session would be insecure —
// a later request on the same session-id could authenticate as a different key.
// So the POST handler runs each request inside this AsyncLocalStorage scope and
// the tool handlers read the principal from it, always for the CURRENT request.

const store = new AsyncLocalStorage<{ principal: McpPrincipal }>();

export function runWithPrincipal<T>(principal: McpPrincipal, fn: () => T): T {
  return store.run({ principal }, fn);
}

export function getPrincipal(): McpPrincipal | null {
  return store.getStore()?.principal ?? null;
}
