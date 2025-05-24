import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const activeTransports: Record<string, StreamableHTTPServerTransport> = {};
const activeServers: Record<string, McpServer> = {};

export function getActiveSession(sessionId: string): { server: McpServer, transport: StreamableHTTPServerTransport } | undefined {
    const server = activeServers[sessionId];
    const transport = activeTransports[sessionId];
    if (server && transport) {
        return { server, transport };
    }
    return undefined;
}

export function setActiveSession(sessionId: string, server: McpServer, transport: StreamableHTTPServerTransport): void {
    activeServers[sessionId] = server;
    activeTransports[sessionId] = transport;
    console.log(`[SessionManager - ${sessionId}] Session set/updated.`);
}

export function deleteActiveSession(sessionId: string): boolean {
    let deletedServer = false;
    let deletedTransport = false;
    if (activeServers[sessionId]) {
        delete activeServers[sessionId];
        deletedServer = true;
    }
    if (activeTransports[sessionId]) {
        delete activeTransports[sessionId];
        deletedTransport = true;
    }
    if (deletedServer || deletedTransport) {
        console.log(`[SessionManager - ${sessionId}] Session deleted.`);
        return true;
    }
    console.log(`[SessionManager - ${sessionId}] Session not found for deletion.`);
    return false;
}

export function hasActiveSession(sessionId: string): boolean {
    return sessionId in activeServers && sessionId in activeTransports;
} 