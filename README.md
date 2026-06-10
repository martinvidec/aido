# Aido

A collaborative todo app with rich-text editing, sharing, mentions and an MCP server — built on Next.js and Firebase.

Originally generated from [template-cursor-nextjs-firebase](https://github.com/martinvidec/template-cursor-nextjs-firebase).

## Features

### Authentication
- Sign in with Google (Firebase Auth popup flow)
- Protected routes under `(protected)/` — todos, mentions, contacts, settings
- User document (`users/{uid}`, owner-only) plus a PII-free public profile (`publicProfiles/{uid}`: display name, photo, e-mail hash) used for all cross-user lookups

### Todos (`/todos`)
- Rich-text editor (Tiptap) with toolbar: bold, italic, underline, strikethrough, headings, bullet/ordered lists, blockquote, code block, links, highlight, task lists, emoji picker, undo/redo
- Create, edit, delete; checkbox to mark todos done
- **@-Mentions**: type `@` to mention one of your contacts; mentioned users see the todo in their mentions feed
- **#-Hashtags**: type `#` to tag todos; the list has a tag-based search/filter (all terms must match)
- Live updates via Firestore snapshots; own and shared todos in separate sections

### Sharing
- Share a todo with other users (search by display-name prefix, or enter an exact e-mail address)
- Shared users ("sharees") can read the todo and toggle `completed` — nothing else; enforced server-side by Firestore rules, not just in the UI
- E-mail lookup works via SHA-256 hash exact-match, so the user base cannot be enumerated

### Mentions feed (`/mentions`)
- Lists all todos in which you are mentioned, with owner info from public profiles

### Contacts (`/contacts`)
- Send, accept, reject and cancel contact requests
- Inviting a not-yet-registered e-mail address creates an invite; a Cloud Function (`sendContactInviteEmail`) sends the invitation e-mail
- Contacts feed the @-mention suggestions

### Settings (`/settings`)
- Profile (display name, e-mail, photo), language, timezone, e-mail/push notification toggles
- Theme: light / dark / system (persisted per user)
- **Personal API key**: generate / rotate / revoke a key (`aido_…`) for external integrations. The plaintext is shown exactly once; only a SHA-256 hash is stored (`userApiKeys/{uid}`, no client access). Requires `FIREBASE_SERVICE_ACCOUNT_KEY` on the server.

### MCP server (`/api/mcp/sse`)
- Model Context Protocol server with `streamable-http` (POST) and SSE (GET) transport, session management included
- Tools: `list-todos`, `add-todo`
- Auth: `Authorization: Bearer <token>` — either the shared `MCP_AUTH_TOKEN` or a personal API key; unauthenticated requests are rejected
- Compatible with `@modelcontextprotocol/inspector`

### Security
- Firestore rules: owner-only user docs, field-validated todo updates (sharees restricted to `completed`), admin-only API-key hashes, deny-by-default Storage rules
- Emulator-based rules test suite: `npm run test:rules` (Firestore + Storage)
- Security headers on every route (CSP, `X-Frame-Options`, HSTS, `nosniff`, `Referrer-Policy`)
- Tiptap link hardening: protocol allowlist (http/https/mailto), no `javascript:`/`data:` URLs, `openOnClick` disabled
- Dependabot (weekly, root + `functions/`)

## Tech stack

- **Next.js 15** (App Router) with React 19, TypeScript, TailwindCSS
- **Firebase**: Auth, Firestore (client SDK v12), Security Rules; `firebase-admin` for server-side token verification and API-key storage
- **Cloud Functions v2** (`functions/`, Node 22): contact invite e-mails
- **Tiptap 2**: rich-text editing (mentions, hashtags, task lists, links)
- **@modelcontextprotocol/sdk** + **Zod 4**: MCP server and schema validation
- **Vercel**: hosting/deployment (auto-deploy on merge to `main`)

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_FIREBASE_*` — Firebase web app config
   - `MCP_AUTH_TOKEN` — shared secret for the MCP endpoint (`openssl rand -hex 32`)
   - `FIREBASE_SERVICE_ACCOUNT_KEY` — service-account JSON (single line); needed for personal API keys
3. Run the dev server:
   ```bash
   npm run dev
   ```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | ESLint (next lint) |
| `npm run test:rules` | Firestore + Storage rules tests in the Firebase emulator (needs Java; `firebase-tools@13` if only Java 11 is available) |

## Deployment

- **App**: merges to `main` deploy automatically via Vercel
- **Firestore rules**: `firebase deploy --only firestore:rules`
- **Storage rules**: `firebase deploy --only storage` (once Storage is enabled in the Firebase console)
- **Cloud Functions**: `cd functions && npm run deploy`

## Project structure

```
src/
  app/                  # Next.js App Router (login, (protected)/*, api/)
  components/           # UI components (TodoList, Todo, ShareTodo, …)
  lib/
    contexts/           # Auth, Theme, Error providers
    firebase/           # client SDK init, admin SDK init, data helpers
    hooks/              # useAuth, useError, useTiptapConfig
    mcp/                # MCP server: auth guard, schemas, tool logic, sessions
    tiptap/             # mention/hashtag extensions, link security
functions/              # Cloud Functions (invite e-mails)
tests/                  # emulator-based security-rules tests
firestore.rules         # Firestore security rules
storage.rules           # Storage security rules
```
