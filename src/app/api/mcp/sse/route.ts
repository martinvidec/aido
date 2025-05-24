import { NextRequest, NextResponse } from 'next/server';
// Attempt to polyfill Web Streams if they are missing from global scope
import { ReadableStream as NodeWebReadableStream, WritableStream as NodeWebWritableStream } from 'node:stream/web';

// @ts-ignore
if (typeof globalThis.ReadableStream === 'undefined') {
  // @ts-ignore
  globalThis.ReadableStream = NodeWebReadableStream;
  console.log('[Polyfill] globalThis.ReadableStream was polyfilled.');
}
// @ts-ignore
if (typeof globalThis.WritableStream === 'undefined') {
  // @ts-ignore
  globalThis.WritableStream = NodeWebWritableStream;
  console.log('[Polyfill] globalThis.WritableStream was polyfilled.');
}
// End Polyfill

import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode, isInitializeRequest, JSONRPCRequest, RequestSchema, ResultSchema, NotificationSchema, JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events'; // Standard Node.js EventEmitter
import { SocketConnectOpts, NetConnectOpts, TcpSocketConnectOpts, IpcSocketConnectOpts } from 'net'; // Für connect Optionen
import * as httpMocks from 'node-mocks-http'; // Import node-mocks-http
import { PassThrough, Readable } from 'stream'; // Node.js PassThrough Stream
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'net';

const mockTodoStore: Record<string, { id: string, text: string, completed: boolean }> = {};

// --- Global Zod Schemas ---
const MetaSchema = z.object({
  _meta: z.object({
    progressToken: z.any().optional(),
  }).optional()
});

// Schemas for list-todos
const ListTodosParamsSchema = MetaSchema.extend({});
const ListTodosRequestSchema = RequestSchema.extend({
    method: z.literal('list-todos'),
    params: ListTodosParamsSchema.optional(),
});
const TodoSchema = z.object({
    id: z.string(),
    text: z.string(),
    completed: z.boolean(),
});
const ListTodosResultSchema = ResultSchema.extend({
    result: z.object({ items: z.array(TodoSchema) }),
});

// Schemas for add-todo
const AddTodoParamsSchema = MetaSchema.extend({
  text: z.string(),
});
const AddTodoRequestSchema = RequestSchema.extend({
    method: z.literal('add-todo'),
    params: AddTodoParamsSchema,
});
const AddTodoResultSchema = ResultSchema.extend({
    result: TodoSchema,
});

// Schemas for tools/list
const ToolsListParamsSchema = MetaSchema.extend({});
const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.object({ 
    type: z.literal('object'),
    properties: z.record(z.string(), z.any()).optional(),
    required: z.array(z.string()).optional(),
  }).describe("JSON Schema for the tool's input parameters."),
  outputSchema: z.object({ 
    type: z.literal('object'),
    properties: z.record(z.string(), z.any()).optional(),
  }).optional().describe("JSON Schema for the tool's output."),
});
const ToolsListRequestSchema = RequestSchema.extend({
  method: z.literal('tools/list'),
  params: ToolsListParamsSchema.optional(),
});
const ToolsListResultSchema = ResultSchema.extend({
  result: z.object({ tools: z.array(ToolDefinitionSchema) }), 
});

// Schemas for tools/call
const ToolsCallArgsSchema = z.record(z.string(), z.any()).optional();
const ToolsCallParamsSchema = MetaSchema.extend({
    name: z.string(),
    arguments: ToolsCallArgsSchema,
});
const ToolsCallRequestSchema = RequestSchema.extend({
    method: z.literal('tools/call'),
    params: ToolsCallParamsSchema,
});
const ToolsCallResultSchema = ResultSchema.extend({ 
    result: z.any(),
});
// --- End Global Zod Schemas ---

const activeTransports: Record<string, StreamableHTTPServerTransport> = {};
const activeServers: Record<string, McpServer> = {};

// --- Internal handlers for actual tool logic ---
async function handleListTodosLogic(sessionId: string, params: z.infer<typeof ListTodosParamsSchema> | undefined) {
    console.log(`[${sessionId}] Internal logic for list-todos, params:`, params);
    const todos = Object.values(mockTodoStore);
    return { result: { items: todos } };
}

async function handleAddTodoLogic(sessionId: string, params: z.infer<typeof AddTodoParamsSchema>) {
    console.log(`[${sessionId}] Internal logic for add-todo, params:`, params);
    const newTodo = {
        id: randomUUID(),
        text: params.text,
        completed: false,
    };
    mockTodoStore[newTodo.id] = newTodo;
    return { result: newTodo };
}

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
                        text: toolArgs?.text as string, // Ensure text is passed if present
                    } as z.infer<typeof AddTodoParamsSchema>; 
                     // Ensure text is properly part of the object before parsing if toolArgs is generic
                    if (toolArgs && typeof toolArgs.text === 'string') {
                        addTodoParamsForLogic.text = toolArgs.text;
                    } else if (!addTodoParamsForLogic.text && toolArgs && typeof toolArgs.text !== 'string') {
                        // If text is missing or not a string in toolArgs, but AddTodoParamsSchema requires it (and it does)
                        // Zod parse will catch this. We could also throw a more specific error here.
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

        if (activeServers[sessionId] && activeTransports[sessionId]) {
            console.log(`[${sessionId}] Reusing existing server and transport for Initialize.`);
            mcpServer = activeServers[sessionId];
            transport = activeTransports[sessionId];
        } else {
            console.log(`[${sessionId}] Creating new server and transport for Initialize.`);
            mcpServer = createAndConfigureMcpServer(sessionId);
            activeServers[sessionId] = mcpServer;
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => sessionId!, 
                onsessioninitialized: (assignedSessionId: string) => {
                    console.log(`[${assignedSessionId}] Transport session initialized via POST (isInit=true). Assigned: ${assignedSessionId}, Current Request: ${sessionId}`);
                },
                enableJsonResponse: true, 
            });
            activeTransports[sessionId] = transport;
            await mcpServer.connect(transport);
        }
    } else {
        console.log(`[${sessionId || 'No Session ID'}] POST request is NOT an Initialize request.`);
        if (!sessionId) {
            console.error("[POST] mcp-session-id header required for non-initialize requests.");
            return NextResponse.json({ error: "mcp-session-id header required" }, { status: 400 });
        }
        if (!activeTransports[sessionId] || !activeServers[sessionId]) {
            console.warn(`[${sessionId}] No active transport or server found for non-initialize POST. Creating new set.`);
            mcpServer = createAndConfigureMcpServer(sessionId);
            activeServers[sessionId] = mcpServer;
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => sessionId!,
                onsessioninitialized: (assignedSessionId: string) => {
                     console.log(`[${assignedSessionId}] Transport session re-initialized via POST (isInit=false, session existed or was just created).`);
                },
                enableJsonResponse: true, 
            });
            activeTransports[sessionId] = transport;
            await mcpServer.connect(transport);
        } else {
            console.log(`[${sessionId}] Reusing existing server and transport for non-Initialize POST.`);
            mcpServer = activeServers[sessionId];
            transport = activeTransports[sessionId];
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
        const existingTransport = activeTransports[sessionId];
        const existingServer = activeServers[sessionId];

        if (existingTransport && existingServer) {
            console.log(`[GET Handler - ${sessionId}] Found existing transport and server.`);
            transport = existingTransport;
            mcpServer = existingServer;
        } else {
            console.warn(`[GET Handler - ${sessionId}] No active server/transport found for session. Client might need to re-initialize via POST.`);
            // This path might be problematic if client strictly expects GET to resume.
            // For now, we'll create new ones, but this implies the session wasn't kept alive or initialized.
            mcpServer = createAndConfigureMcpServer(sessionId);
            activeServers[sessionId] = mcpServer;
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => sessionId,
                onsessioninitialized: (sId) => console.log(`[GET Handler - ${sId}] Transport session initialized via GET (existing session ID, new instance).`),
            });
            activeTransports[sessionId] = transport;
            mcpServer.connect(transport);
            console.log(`[GET Handler - ${sessionId}] Created and connected new transport/server for GET due to missing instances.`);
        }
    } else {
        // No session ID in header - this is unusual for SSE continuation, client should POST first.
        // However, some clients might probe with GET first.
        sessionId = randomUUID(); 
        console.warn(`[GET Handler - ${sessionId}] mcp-session-id header missing. Generated new ID: ${sessionId}. Client should ideally POST to initialize first.`);
        mcpServer = createAndConfigureMcpServer(sessionId);
        activeServers[sessionId] = mcpServer;
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId,
            onsessioninitialized: (sId) => console.log(`[GET Handler - ${sId}] Transport session initialized via GET (no header).`),
        });
        activeTransports[sessionId] = transport;
        mcpServer.connect(transport);
        console.log(`[GET Handler - ${sessionId}] Created new server/transport for GET due to missing session ID.`);
    }

    const sseNodeStream = new PassThrough();

    // Manual mock for ServerResponse for SSE GET requests
    class ManualMockServerResponse extends EventEmitter implements ServerResponse {
        private _headers: Record<string, string | number | string[]> = {};
        statusCode: number = 200;
        statusMessage: string = 'OK';
        headersSent: boolean = false;
        sendDate: boolean = true;
        // @ts-ignore
        req: IncomingMessage; // Will be set by transport or can be shimmed if needed

        // Writable stream properties
        writable: boolean = true;
        writableEnded: boolean = false;
        writableFinished: boolean = false;
        writableHighWaterMark: number;
        writableLength: number;
        writableObjectMode: boolean = false;
        writableCorked: number = 0;
        destroyed: boolean = false;
        // @ts-ignore
        closed: boolean = false;
        // @ts-ignore
        errored: Error | null = null;
        finished: boolean = false; // Added finished property


        constructor(private sseStreamTarget: PassThrough, request: IncomingMessage) {
            super();
            // @ts-ignore
            this.req = request;
            this.writableHighWaterMark = this.sseStreamTarget.writableHighWaterMark;
            this.writableLength = this.sseStreamTarget.writableLength;
            this.sseStreamTarget.on('finish', () => this.emit('finish'));
            this.sseStreamTarget.on('close', () => this.emit('close'));

        }

        setHeader(name: string, value: string | number | string[]): this {
            this._headers[name.toLowerCase()] = value;
            return this;
        }

        getHeader(name: string): string | number | string[] | undefined {
            return this._headers[name.toLowerCase()];
        }

        getHeaders(): Record<string, string | number | string[]> {
            return this._headers;
        }

        hasHeader(name: string): boolean {
            return name.toLowerCase() in this._headers;
        }
        
        removeHeader(name: string): void {
            delete this._headers[name.toLowerCase()];
        }

        // @ts-ignore
        writeHead(statusCode: number, statusMessage?: string | Record<string, string | number | string[]>, headers?: Record<string, string | number | string[]>): this {
            this.statusCode = statusCode;
            let actualHeaders: Record<string, string | number | string[]> | undefined;
            if (typeof statusMessage === 'object') {
                this.statusMessage = ''; // Or parse from statusMessage if it's a string.
                actualHeaders = statusMessage;
            } else if (typeof statusMessage === 'string') {
                this.statusMessage = statusMessage;
                if (headers) {
                    actualHeaders = headers;
                }
            }
            
            if (actualHeaders) {
                for (const [key, value] of Object.entries(actualHeaders)) {
                    this.setHeader(key, value);
                }
            }
            this.headersSent = true; // Simulate headers being sent
            return this;
        }
        
        write(chunk: any, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void): boolean {
            let callback: ((error?: Error | null) => void) | undefined;
            let actualEncoding: BufferEncoding = 'utf-8'; // Default to utf-8

            if (typeof encoding === 'function') {
                callback = encoding;
            } else if (typeof encoding === 'string') {
                actualEncoding = encoding;
                if (typeof cb === 'function') {
                    callback = cb;
                }
            } else if (typeof cb === 'function') {
                callback = cb;
            }
            
            const success = this.sseStreamTarget.write(chunk, actualEncoding);
            if (callback) {
                process.nextTick(() => callback(null)); // Node.js write callbacks are generally (error) => void
            }
            return success;
        }

        end(chunk?: any, encodingOrCb?: BufferEncoding | (() => void), cb?: () => void): this {
            let callback: (() => void) | undefined;
            let encoding: BufferEncoding = 'utf-8';

            if (typeof chunk === 'function') {
                callback = chunk; chunk = undefined;
            } else if (typeof encodingOrCb === 'function') {
                callback = encodingOrCb;
            } else if (typeof encodingOrCb === 'string') {
                encoding = encodingOrCb;
                if (typeof cb === 'function') callback = cb;
            }

            if (chunk && typeof chunk !== 'function') {
                this.sseStreamTarget.write(chunk, encoding);
            } else {
            }
            this.sseStreamTarget.end();
            this.writableEnded = true;
            this.writableFinished = true;
            this.finished = true; // Set finished to true
            if (callback) process.nextTick(callback);
            return this;
        }

        flushHeaders(): void { /* For SSE, headers are part of the initial response */ }
        
        get socket(): Socket | null { return null; }
        get connection(): Socket | null { return null; } // Same as socket
        assignSocket(_socket: Socket): void {}
        detachSocket(_socket: Socket): void {}
        // @ts-ignore
        writeContinue(callback?: () => void): void { if(callback) callback(); }
        // @ts-ignore
        setTimeout(_msecs: number, callback?: () => void): this { if(callback) callback(); return this; }
        // @ts-ignore
        addTrailers(_headers: any): void {}

        // Writable stream specific methods (mostly delegating or no-op)
        _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
            this.sseStreamTarget._write(chunk, encoding, callback);
        }
        _final(callback: (error?: Error | null) => void): void {
            // @ts-ignore
            this.sseStreamTarget._final?.(callback);
             if(!this.sseStreamTarget._final) callback(); // If _final doesn't exist on PassThrough for some reason
        }
        _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
            this.sseStreamTarget.destroy(error || undefined); // Pass error or undefined
            this.destroyed = true;
            callback(error);
        }
        cork(): void { this.sseStreamTarget.cork(); }
        uncork(): void { this.sseStreamTarget.uncork(); }
        destroy(error?: Error): this {
            this.sseStreamTarget.destroy(error);
            this.destroyed = true;
            return this;
        }
        // @ts-ignore
        getwritableEnded(): boolean { return this.writableEnded; }
         // @ts-ignore
        setDefaultEncoding(encoding: BufferEncoding): this {
            this.sseStreamTarget.setDefaultEncoding(encoding);
            return this;
        }
         // @ts-ignore
        pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean; }): T {
            return this.sseStreamTarget.pipe(destination, options);
        }

    }

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

    const manualResForGet = new ManualMockServerResponse(sseNodeStream, mockReqForGet as any) as unknown as ServerResponse;

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
    const transport = activeTransports[sessionId];
    const mcpServer = activeServers[sessionId]; 
    if (mcpServer && transport) {
        console.log(`[DELETE ${sessionId}] Closing and disconnecting transport from server.`);
        await transport.close();
    }
    if (activeTransports[sessionId]) {
        console.log(`[DELETE ${sessionId}] Deleting active transport reference.`);
        delete activeTransports[sessionId];
    }
    if (activeServers[sessionId]) {
        console.log(`[DELETE ${sessionId}] Deleting active server reference.`);
        delete activeServers[sessionId];
    }
    if (!transport && !mcpServer) {
        console.log(`[DELETE ${sessionId}] No active session found to delete or already cleaned up.`);
        return NextResponse.json({ message: `Session ${sessionId} not found or already cleaned up.` }, { status: 404 });
    }
    console.log(`[DELETE ${sessionId}] Session resources cleaned up.`);
    return NextResponse.json({ message: `Session ${sessionId} resources deleted.` }, { status: 200 });
} 