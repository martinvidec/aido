import { NextRequest, NextResponse } from 'next/server';
// Polyfills are now in http-utils.ts

import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode, isInitializeRequest, JSONRPCRequest, RequestSchema, ResultSchema, NotificationSchema, JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events'; // Standard Node.js EventEmitter, needed by node-mocks-http
import { SocketConnectOpts, NetConnectOpts, TcpSocketConnectOpts, IpcSocketConnectOpts, Socket } from 'net'; // Socket for Opts, NetConnectOpts etc.
import * as httpMocks from 'node-mocks-http'; 
import { PassThrough, Readable } from 'stream'; // PassThrough and Readable are for GET handler
import type { IncomingMessage, ServerResponse } from 'node:http'; // ServerResponse for node-mocks-http, IncomingMessage for both

// Import Schemas
import {
    ListTodosParamsSchema, // Keep for z.infer
    AddTodoParamsSchema, // Keep for z.infer
    ToolsListRequestSchema,
    ToolDefinitionSchema, // For typing toolsArray
    ToolsCallRequestSchema
} from '@/lib/mcp/schemas';

// Import Tool Logic Handlers
import { handleListTodosLogic, handleAddTodoLogic } from '@/lib/mcp/tool-logic';

// Import Session Management functions
import {
    getActiveSession,
    setActiveSession,
    deleteActiveSession
} from '@/lib/mcp/session-manager';

// Import HTTP Utilities (including ManualMockServerResponse)
import { ManualMockServerResponse } from '@/lib/mcp/http-utils';

// const activeTransports: Record<string, StreamableHTTPServerTransport> = {}; // Removed
// const activeServers: Record<string, McpServer> = {}; // Removed

function createAndConfigureMcpServer(sessionId: string): McpServer {
    console.log(`[${sessionId}] Creating new MCP Server instance`);
    const serverInfo = {
        name: "aido-mcp-server",
        version: "0.1.0",
    };
    const serverOptions = {
        capabilities: {
            tools: { /* Capabilities are now implicitly defined by tools/list and tools/call */ },
            logging: { logMessages: true },
            // enableJsonResponse: true, // Example if needed
        }
    };
    const mcpServer = new McpServer(serverInfo, serverOptions);

    // --- tools/list Handler (remains the same) ---
    mcpServer.setRequestHandler(ToolsListRequestSchema, async (_request: z.infer<typeof ToolsListRequestSchema>) => {
        console.log(`[${sessionId}] Handling tools/list request:`, _request);
        const toolsArray: z.infer<typeof ToolDefinitionSchema>[] = [
            {
                name: 'list-todos',
                description: 'Lists all todo items.',
                inputSchema: { type: 'object', properties: {} },
                outputSchema: {
                    type: 'object',
                    properties: {
                        items: {
                            type: 'array',
                            items: { type: 'object' }
                        }
                    }
                }
            },
            {
                name: 'add-todo',
                description: 'Adds a new todo item. Requires a "text" parameter.',
                inputSchema: { type: 'object', properties: { 'text': { 'type': 'string', description: 'The text content of the todo.' } }, required: ['text'] },
                outputSchema: { type: 'object' }
            },
        ];
        const actualResultPayload = { tools: toolsArray };
        return { result: actualResultPayload }; 
    });

    // --- tools/call Handler (centralized tool execution) ---
    mcpServer.setRequestHandler(ToolsCallRequestSchema, async (request: z.infer<typeof ToolsCallRequestSchema>) => {
        const toolName = request.params.name;
        const toolArgs = request.params.arguments;
        const metaArgs = request.params._meta;

        console.log(`[${sessionId}] Handling tools/call for tool: ${toolName} with args:`, toolArgs, `and meta:`, metaArgs);

        try {
            switch (toolName) {
                case 'list-todos':
                    const listTodosParamsForLogic: z.infer<typeof ListTodosParamsSchema> = { _meta: metaArgs };
                    ListTodosParamsSchema.parse(listTodosParamsForLogic); // Validate
                    return await handleListTodosLogic(sessionId, listTodosParamsForLogic);
                case 'add-todo':
                    const addTodoParamsForLogic: z.infer<typeof AddTodoParamsSchema> = {
                        ...(toolArgs || {}),
                        _meta: metaArgs,
                        text: toolArgs?.text as string, 
                    } as z.infer<typeof AddTodoParamsSchema>; 
                    if (toolArgs && typeof toolArgs.text === 'string') {
                        addTodoParamsForLogic.text = toolArgs.text;
                    } 
                    AddTodoParamsSchema.parse(addTodoParamsForLogic); // Validate
                    return await handleAddTodoLogic(sessionId, addTodoParamsForLogic);
                default:
                    console.error(`[${sessionId}] Unknown tool called via tools/call: ${toolName}`);
                    return { error: { code: ErrorCode.MethodNotFound, message: `Tool '${toolName}' not found.` } };
            }
        } catch (error) {
            console.error(`[${sessionId}] Error during tools/call for ${toolName}:`, error);
            let errorMessage = 'Internal server error during tool execution.';
            if (error instanceof z.ZodError) {
                errorMessage = `Invalid arguments for tool '${toolName}': ${error.errors.map(e => `${e.path.join('.')} - ${e.message}`).join(', ')}`;
            }
            return { error: { code: ErrorCode.InvalidParams, message: errorMessage } };
        }
    });

    // Direct handlers for list-todos and add-todo are now removed.
    // The McpServer instance will only have handlers for 'tools/list' and 'tools/call'.

    console.log(`[${sessionId}] MCP Server instance created with tools/list and tools/call handlers.`);
    return mcpServer;
}

export async function POST(req: NextRequest) {
    console.log("[General POST /api/mcp/sse] Incoming request headers:", Object.fromEntries(req.headers.entries()));

    let parsedBody: any;
    try {
        parsedBody = await req.json();
        console.log("[General POST /api/mcp/sse] Parsed request body:", parsedBody);
    } catch (e) {
        console.error("[General POST /api/mcp/sse] Error parsing JSON body:", e);
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const isInitRequest = parsedBody && typeof parsedBody === 'object' && isInitializeRequest(parsedBody as JSONRPCRequest);
    let sessionId = req.headers.get('mcp-session-id');
    let mcpServer: McpServer;
    let transport: StreamableHTTPServerTransport;
    let newSessionIdFromInit: string | undefined = undefined;

    if (isInitRequest) {
        newSessionIdFromInit = sessionId || randomUUID();
        sessionId = newSessionIdFromInit;
        console.log(`[${sessionId}] POST request is an Initialize request. Effective Session ID: ${sessionId}`);

        const existingSession = getActiveSession(sessionId);
        if (existingSession) {
            console.log(`[${sessionId}] Reusing existing server and transport for Initialize.`);
            mcpServer = existingSession.server;
            transport = existingSession.transport;
        } else {
            console.log(`[${sessionId}] Creating new server and transport for Initialize.`);
            mcpServer = createAndConfigureMcpServer(sessionId);
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => sessionId!, 
                onsessioninitialized: (assignedSessionId: string) => {
                    console.log(`[${assignedSessionId}] Transport session initialized via POST (isInit=true). Assigned: ${assignedSessionId}, Current Request: ${sessionId}`);
                },
                enableJsonResponse: true, 
            });
            setActiveSession(sessionId, mcpServer, transport); // Use session manager
            await mcpServer.connect(transport);
        }
    } else {
        console.log(`[${sessionId || 'No Session ID'}] POST request is NOT an Initialize request.`);
        if (!sessionId) {
            console.error("[POST] mcp-session-id header required for non-initialize requests.");
            return NextResponse.json({ error: "mcp-session-id header required" }, { status: 400 });
        }
        const existingSession = getActiveSession(sessionId);
        if (!existingSession) {
            console.warn(`[${sessionId}] No active transport or server found for non-initialize POST. Creating new set.`);
            mcpServer = createAndConfigureMcpServer(sessionId);
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => sessionId!,
                onsessioninitialized: (assignedSessionId: string) => {
                     console.log(`[${assignedSessionId}] Transport session re-initialized via POST (isInit=false, session existed or was just created).`);
                },
                enableJsonResponse: true, 
            });
            setActiveSession(sessionId, mcpServer, transport); // Use session manager
            await mcpServer.connect(transport);
        } else {
            console.log(`[${sessionId}] Reusing existing server and transport for non-Initialize POST.`);
            mcpServer = existingSession.server;
            transport = existingSession.transport;
        }
    }

    const mockReq = httpMocks.createRequest({
        method: req.method as any,
        url: req.url,
        headers: Object.fromEntries(req.headers.entries()),
    });

    console.log(`[POST Handler - ${sessionId}] Is Init Request? ${isInitRequest}. About to call createResponse.`);
    console.log(`[POST Handler - ${sessionId}] CRITICAL CHECK: typeof globalThis.WritableStream BEFORE createResponse =`, typeof globalThis.WritableStream);
    const mockRes = httpMocks.createResponse({ 
        eventEmitter: EventEmitter 
    });
    mockRes.setHeader('Content-Type', 'application/jsonrpc+json; charset=utf-8');

    const abortController = new AbortController();
    req.signal.addEventListener('abort', () => {
        console.log(`[${transport?.sessionId || sessionId}] POST Request aborted by client (NextRequest signal).`);
        if (!mockReq.destroyed) {
            mockReq.destroy(); 
        }
        abortController.abort(); 
    });
    (mockReq as any).signal = abortController.signal;

    try {
        console.log(`[${transport.sessionId || sessionId}] Calling transport.handleRequest with node-mocks-http req/res. Waiting for response to finish.`);
        
        await new Promise<void>((resolve, reject) => {
            mockRes.on('finish', () => {
                console.log(`[${sessionId}] mockRes 'finish' event fired.`);
                resolve();
            });
            mockRes.on('error', (err: Error) => {
                console.error(`[${sessionId}] mockRes 'error' event:`, err);
                reject(err);
            });

            transport.handleRequest(mockReq as any, mockRes as any, parsedBody)
                .then(() => {
                    console.log(`[${sessionId}] transport.handleRequest promise resolved.`);
                })
                .catch(err => {
                    console.error(`[${sessionId}] transport.handleRequest promise rejected:`, err);
                    if (!mockRes.writableEnded) {
                        try { mockRes.end(); } catch (e) { console.error("Error ending mockRes after transport error:", e); }
                    }
                    reject(err); 
                });
        });

        const responseData = mockRes._getData();
        console.log(`[POST - ${sessionId}] Raw mockRes._getData():`, responseData);
        console.log(`[POST - ${sessionId}] typeof mockRes._getData():`, typeof responseData);

        let bodyToReturn = responseData;
        let finalStatus = mockRes.statusCode;

        // Check if bodyToReturn is a string and potentially needs restructuring
        if (typeof bodyToReturn === 'string' && bodyToReturn.length > 0) {
            try {
                const parsedBody = JSON.parse(bodyToReturn);
                // Check for the specific malformed structure: { result: { result: ... }, jsonrpc: ..., id: ... }
                if (parsedBody && typeof parsedBody === 'object' && 
                    parsedBody.result && typeof parsedBody.result === 'object' && 
                    parsedBody.result.hasOwnProperty('result') &&
                    parsedBody.hasOwnProperty('jsonrpc') && parsedBody.hasOwnProperty('id')) {
                    
                    console.log(`[POST - ${sessionId}] Detected malformed JSON structure. Attempting to correct.`);
                    const correctedBody = {
                        jsonrpc: parsedBody.jsonrpc,
                        id: parsedBody.id,
                        result: parsedBody.result.result // Use the inner 'result' as the actual result
                    };
                    bodyToReturn = JSON.stringify(correctedBody);
                    console.log(`[POST - ${sessionId}] Corrected body:`, bodyToReturn);
                } else if (parsedBody && typeof parsedBody === 'object' && 
                           parsedBody.result && parsedBody.jsonrpc && parsedBody.id &&
                           !parsedBody.result.hasOwnProperty('result') && 
                           mockRes.getHeader('content-type') === 'application/json'){
                    // This case is for already well-formed JSON string from initialize, which is correct
                    console.log(`[POST - ${sessionId}] Body is a well-formed JSON string (e.g. from initialize), no correction needed.`);
                }
                // If it's a different JSON structure or not the one we target, leave it as is.
            } catch (e) {
                // Not a JSON string or other parsing error, leave bodyToReturn as is
                console.warn(`[POST - ${sessionId}] Could not parse bodyToReturn as JSON or error during restructuring, using original string. Error:`, e);
            }
        }

        const headers = mockRes._getHeaders();
        const finalHeaders = new Headers();

        for (const [key, value] of Object.entries(headers)) {
            if (value !== undefined) {
                finalHeaders.set(key, Array.isArray(value) ? value.join(', ') : String(value));
            }
        }

        if (newSessionIdFromInit && !finalHeaders.has('mcp-session-id')) {
             console.log(`[${sessionId}] Setting mcp-session-id header in response: ${newSessionIdFromInit}`);
            finalHeaders.set('mcp-session-id', newSessionIdFromInit);
        }
        
        console.log(`[POST - ${sessionId}] Headers being sent to NextResponse:`, finalHeaders);
        console.log(`[POST - ${sessionId}] Body being sent to NextResponse (type ${typeof bodyToReturn}):`, bodyToReturn);

        const response = new NextResponse(bodyToReturn, {
            status: finalStatus,
            headers: finalHeaders,
        });

        return response;

    } catch (error) {
        console.error(`[${transport?.sessionId || sessionId}] Error in POST handler (outer try-catch):`, error);
        const errResponse = {
            jsonrpc: "2.0",
            error: { code: ErrorCode.InternalError, message: "Internal server error" },
            id: (parsedBody as JSONRPCRequest)?.id ?? null
        };
        return NextResponse.json(errResponse, { status: 500, headers: { 'Content-Type': 'application/jsonrpc+json; charset=utf-8' } });
    } finally {
        console.log(`[${transport?.sessionId || sessionId}] POST request processing finished.`);
    }
}

export async function GET(req: NextRequest) {
    const sessionIdFromHeader = req.headers.get('mcp-session-id');
    const lastEventId = req.headers.get('mcp-last-event-id') || null;

    console.log(`[GET Handler] Incoming GET. Session ID from header: ${sessionIdFromHeader}, Last Event ID: ${lastEventId}`);

    let sessionId: string;
    let transport: StreamableHTTPServerTransport;
    let mcpServer: McpServer;

    if (sessionIdFromHeader) {
        sessionId = sessionIdFromHeader;
        console.log(`[GET Handler - ${sessionId}] SSE request for existing session. LastEventId: ${lastEventId}`);
        const existingSession = getActiveSession(sessionId);

        if (existingSession) {
            console.log(`[GET Handler - ${sessionId}] Found existing transport and server.`);
            transport = existingSession.transport;
            mcpServer = existingSession.server;
        } else {
            console.warn(`[GET Handler - ${sessionId}] No active server/transport found for session. Client might need to re-initialize via POST.`);
            mcpServer = createAndConfigureMcpServer(sessionId);
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => sessionId,
                onsessioninitialized: (sId) => console.log(`[GET Handler - ${sId}] Transport session initialized via GET (existing session ID, new instance).`),
            });
            setActiveSession(sessionId, mcpServer, transport); // Use session manager
            mcpServer.connect(transport); // Removed await here, as it was not present before and connect doesn't always need await for SSE
            console.log(`[GET Handler - ${sessionId}] Created and connected new transport/server for GET due to missing instances.`);
        }
    } else {
        sessionId = randomUUID(); 
        console.warn(`[GET Handler - ${sessionId}] mcp-session-id header missing. Generated new ID: ${sessionId}. Client should ideally POST to initialize first.`);
        mcpServer = createAndConfigureMcpServer(sessionId);
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId,
            onsessioninitialized: (sId) => console.log(`[GET Handler - ${sId}] Transport session initialized via GET (no header).`),
        });
        setActiveSession(sessionId, mcpServer, transport); // Use session manager
        mcpServer.connect(transport); // Removed await here
        console.log(`[GET Handler - ${sessionId}] Created new server/transport for GET due to missing session ID.`);
    }

    const sseNodeStream = new PassThrough();

    const mockReqForGet = httpMocks.createRequest({
        method: 'GET',
        url: '/api/mcp/sse',
        headers: {
            'mcp-session-id': sessionId,
            'mcp-last-event-id': lastEventId || undefined,
            'accept': 'text/event-stream',
            // Add any other headers the transport might expect from a real Node request
            'connection': 'keep-alive', 
            'host': new URL(req.url).host 
        }
    });

    const manualResForGet = new ManualMockServerResponse(sseNodeStream, mockReqForGet as unknown as IncomingMessage) as unknown as ServerResponse;

    console.log(`[GET Handler - ${sessionId}] Using ManualMockServerResponse for SSE stream. Attaching to transport.`);

    // This promise should not be awaited if we want to return the stream immediately
    transport.handleRequest(mockReqForGet as IncomingMessage, manualResForGet)
        .then(() => {
            console.log(`[GET Handler - ${sessionId}] transport.handleRequest (for SSE using ManualMock) promise resolved. Stream should have been ended by transport.`);
        })
        .catch(err => {
            console.error(`[GET Handler - ${sessionId}] Error in transport.handleRequest (SSE using ManualMock):`, err);
            if (!sseNodeStream.writableEnded) {
                console.error(`[GET Handler - ${sessionId}] Ending sseNodeStream due to error in transport.handleRequest.`);
                sseNodeStream.end();
            }
        });

    const webReadableStream = Readable.toWeb(sseNodeStream);

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', 'text/event-stream; charset=utf-8');
    responseHeaders.set('Cache-Control', 'no-cache, no-transform');
    responseHeaders.set('Connection', 'keep-alive');
    responseHeaders.set('X-Accel-Buffering', 'no'); 
    if (sessionId) {
        responseHeaders.set('mcp-session-id', sessionId);
    }
    // Any headers set on manualResForGet by the transport can be added here if needed,
    // but for SSE, these are the main ones. The transport usually writes 'event: message\ndata: ...\n\n'

    return new NextResponse(webReadableStream as any, {
        status: 200, // SSE typically starts with 200
        headers: responseHeaders
    });
}

export async function DELETE(req: NextRequest) {
    const sessionId = req.headers.get('mcp-session-id');
    console.log(`[DELETE ${sessionId || '(no id)'}] Incoming DELETE request, session ID: ${sessionId}`);

    if (!sessionId) {
        return NextResponse.json({ error: "mcp-session-id header is required" }, { status: 400 });
    }
    const session = getActiveSession(sessionId);
    if (session && session.transport) {
        console.log(`[DELETE ${sessionId}] Closing and disconnecting transport from server.`);
        await session.transport.close(); // transport will be closed by the SDK if connect was called
    }
    
    const deleted = deleteActiveSession(sessionId); // Use session manager

    if (!deleted) {
        console.log(`[DELETE ${sessionId}] No active session found to delete or already cleaned up.`);
        return NextResponse.json({ message: `Session ${sessionId} not found or already cleaned up.` }, { status: 404 });
    }
    console.log(`[DELETE ${sessionId}] Session resources cleaned up.`);
    return NextResponse.json({ message: `Session ${sessionId} resources deleted.` }, { status: 200 });
} 