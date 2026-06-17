import { ResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Request schemas are defined standalone (method + params) instead of
// RequestSchema.extend(...): with zod v4 the extend blows up TypeScript's
// recursion limit (TS2589) when passed to setRequestHandler.

// --- Global Zod Schemas ---
export const MetaSchema = z.object({
  _meta: z.object({
    progressToken: z.any().optional(),
  }).optional()
});

// Schemas for list-spaces (issue #119): no input params.
export const ListSpacesParamsSchema = MetaSchema.extend({});

// Schemas for list-todos (issue #119): scoped to one space; optional filters.
export const ListTodosParamsSchema = MetaSchema.extend({
    spaceId: z.string().min(1),
    includeCompleted: z.boolean().optional(),
    tag: z.string().optional(),
});
export const ListTodosRequestSchema = z.object({
    method: z.literal('list-todos'),
    params: ListTodosParamsSchema.optional(),
});

// Write tools (issue #120): all space-scoped.
export const AddTodoParamsSchema = MetaSchema.extend({
    spaceId: z.string().min(1),
    title: z.string().min(1),
    bodyText: z.string().optional(),
    waitingOn: z.string().nullable().optional(),
});
export const CompleteTodoParamsSchema = MetaSchema.extend({
    spaceId: z.string().min(1),
    todoId: z.string().min(1),
    completed: z.boolean(),
});
export const SetWaitingOnParamsSchema = MetaSchema.extend({
    spaceId: z.string().min(1),
    todoId: z.string().min(1),
    userId: z.string().nullable(),
});
export const ListDailyParamsSchema = MetaSchema.extend({
    spaceId: z.string().min(1),
    date: z.string().optional(),
});
export const AddDailyParamsSchema = MetaSchema.extend({
    spaceId: z.string().min(1),
    text: z.string().min(1),
});

// Schemas for tools/list
export const ToolsListParamsSchema = MetaSchema.extend({});
export const ToolDefinitionSchema = z.object({
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
// Plain TS type for tool definitions: z.infer on ToolDefinitionSchema also
// exceeds the TS recursion limit under zod v4.
export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, any>; required?: string[] };
  outputSchema?: { type: 'object'; properties?: Record<string, any> };
};

export const ToolsListRequestSchema = z.object({
  method: z.literal('tools/list'),
  params: ToolsListParamsSchema.optional(),
});
export const ToolsListResultSchema = ResultSchema.extend({
  result: z.object({ tools: z.array(ToolDefinitionSchema) }), 
});

// Schemas for tools/call
export const ToolsCallArgsSchema = z.record(z.string(), z.any()).optional();
export const ToolsCallParamsSchema = MetaSchema.extend({
    name: z.string(),
    arguments: ToolsCallArgsSchema,
});
export const ToolsCallRequestSchema = z.object({
    method: z.literal('tools/call'),
    params: ToolsCallParamsSchema,
});
export const ToolsCallResultSchema = ResultSchema.extend({ 
    result: z.any(),
});
// --- End Global Zod Schemas --- 