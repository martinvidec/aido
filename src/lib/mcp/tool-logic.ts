import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ListTodosParamsSchema, AddTodoParamsSchema } from '@/lib/mcp/schemas'; // Import schema types using alias

// Mock data store
const mockTodoStore: Record<string, { id: string, text: string, completed: boolean }> = {};

// --- Internal handlers for actual tool logic ---
export async function handleListTodosLogic(sessionId: string, params: z.infer<typeof ListTodosParamsSchema> | undefined) {
    console.log(`[${sessionId}] (tool-logic) Internal logic for list-todos, params:`, params);
    // _meta is part of params due to ListTodosParamsSchema extending MetaSchema
    // No other specific params for list-todos currently used from 'params' object directly
    const todos = Object.values(mockTodoStore);
    return { result: { items: todos } };
}

export async function handleAddTodoLogic(sessionId: string, params: z.infer<typeof AddTodoParamsSchema>) {
    console.log(`[${sessionId}] (tool-logic) Internal logic for add-todo, params:`, params);
    // params already validated by the time it gets here if using Zod in tools/call handler
    const newTodo = {
        id: randomUUID(),
        text: params.text, // Access text directly from parsed params
        completed: false,
    };
    mockTodoStore[newTodo.id] = newTodo;
    return { result: newTodo };
} 