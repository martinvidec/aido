import { RequestSchema, ResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// --- Global Zod Schemas ---
export const MetaSchema = z.object({
  _meta: z.object({
    progressToken: z.any().optional(),
  }).optional()
});

// Schemas for list-todos
export const ListTodosParamsSchema = MetaSchema.extend({});
export const ListTodosRequestSchema = RequestSchema.extend({
    method: z.literal('list-todos'),
    params: ListTodosParamsSchema.optional(),
});
export const TodoSchema = z.object({
    id: z.string(),
    text: z.string(),
    completed: z.boolean(),
});
export const ListTodosResultSchema = ResultSchema.extend({
    result: z.object({ items: z.array(TodoSchema) }),
});

// Schemas for add-todo
export const AddTodoParamsSchema = MetaSchema.extend({
  text: z.string(),
});
export const AddTodoRequestSchema = RequestSchema.extend({
    method: z.literal('add-todo'),
    params: AddTodoParamsSchema,
});
export const AddTodoResultSchema = ResultSchema.extend({
    result: TodoSchema,
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
export const ToolsListRequestSchema = RequestSchema.extend({
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
export const ToolsCallRequestSchema = RequestSchema.extend({
    method: z.literal('tools/call'),
    params: ToolsCallParamsSchema,
});
export const ToolsCallResultSchema = ResultSchema.extend({ 
    result: z.any(),
});
// --- End Global Zod Schemas --- 