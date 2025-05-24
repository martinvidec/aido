# Aido

This is a TODOs App.
This App is generated from https://github.com/martinvidec/template-cursor-nextjs-firebase

## Features
- Authenticate with Google
- Create, edit and delete TODOs
- Mark TODOs as "Done"
- Share TODOs with other users
- **Model Context Protocol (MCP) Server:**
    - Implements an MCP server at `/api/mcp/sse`.
    - Supports `streamable-http` (POST) and basic SSE (GET) transport.
    - Provides mock tools: `list-todos` and `add-todo`.
    - Compatible with `@modelcontextprotocol/inspector` for testing.

## Technologies used
This doesn't really matter, but is useful for the AI to understand more about this project. We are using the following technologies
- React with Next.js 14 App Router
- TailwindCSS
- Firebase Auth, Storage, and Database
- Multiple AI endpoints including OpenAI, Anthropic, and Replicate using Vercel's AI SDK
- **@modelcontextprotocol/sdk:** For MCP server implementation.
- **Zod:** For schema validation in the MCP server.
- **node-mocks-http:** For shimming Node.js HTTP objects in Next.js API routes for the MCP SDK.
