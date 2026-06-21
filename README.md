# Aido

A collaborative, **Spaces-based** todo app — rich-text todos, a chat-style daily capture, a Kanban board, real-time collaboration, and an MCP server (API key **or** OAuth) so AI assistants can read and write your todos. Built on Next.js 15 and Firebase.

Originally generated from [template-cursor-nextjs-firebase](https://github.com/martinvidec/template-cursor-nextjs-firebase).

## Features

### Spaces — the organizing unit
Everything lives in a **Space** (`spaces/{id}`) with members and an accent color. Any member can read and write everything in the space — full collaboration (this replaced the older "My Todos / Shared with me" split). Create, rename, recolor and delete spaces and invite members (search by display-name prefix or exact e-mail hash); only the creator may delete a space. Each space has three views:

- **Heute** — chat-style quick capture of short-lived daily items (a separate `daily` collection; never clutters the list).
- **Liste** — structured todos: a Tiptap composer (title + rich body), `@`-mentions, `#`-hashtag filtering, "waiting on \<member\>", interactive checklists, and a collapsible "Erledigt" (done) section.
- **Board** — the same todos as a Kanban, grouped by **person** or **status**, with drag & drop on desktop and a "move" sheet on mobile.

Responsive by design: a desktop shell (sidebar + scrolling column) and a dedicated mobile shell (header, space pills, bottom tabs, bottom sheets), switched purely via CSS. Live updates via Firestore snapshots. Legacy pre-redesign todos are migrated into spaces on login.

### Authentication
- Google sign-in (Firebase Auth). Owner-only user doc (`users/{uid}`, PII) plus a PII-free public profile (`publicProfiles/{uid}`: display name, photo, e-mail hash) used for **all** cross-user lookups — exact-match on the e-mail hash or display-name prefix, so the user base can't be enumerated.

### Rich text & mentions
- Tiptap editor with headings, lists, blockquote, code, hardened links, highlight, task lists and emoji. `@`-mentions resolve against your contacts; `#`-hashtags drive list filtering. Tags and mentions are derived from title/body on save.

### Contacts (`/contacts`)
- Send / accept / reject / cancel contact requests. Inviting a not-yet-registered e-mail creates an invite and a Cloud Function (`sendContactInviteEmail`) sends the e-mail. Contacts feed the `@`-mention suggestions.

### Settings (`/settings`)
- Profile (name, e-mail, photo), language, timezone, notification toggles; light / dark / system theme (oklch design tokens, persisted per user).
- **Personal API key** (`aido_…`): generate / rotate / revoke for external integrations (e.g. Claude Code/Desktop). The plaintext is shown exactly once; only a SHA-256 hash is stored (`userApiKeys/{uid}`, admin-only). Requires `FIREBASE_SERVICE_ACCOUNT_KEY`.
- **Agent-Sessions** (epic #212): manage the Claude-Code sessions you can hand todos to — rename, remove, set each session's tool **allowlist** and **lease**, plus the default lease for new sessions (see the MCP section below).

### MCP server (`/api/mcp/sse`)
Model Context Protocol over **streamable HTTP**, stateless via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) (serverless-friendly — no in-memory session map). **14 Firestore-backed tools**, all member-gated and scoped to the caller's uid:

`list-spaces` · `list-todos` · `add-todo` · `complete-todo` · `set-waiting-on` · `list-daily` · `add-daily` · `delete-todo` · `whoami` · `list-members`

…plus the **Agent-Sessions** work loop (epic #212): `register-session` · `next-todo` · `update-todo` · `handoff`.

Three authentication methods on the same endpoint:
- the shared `MCP_AUTH_TOKEN` (transport only — data tools require a user identity),
- a **personal API key** (`aido_…`) → uid,
- **OAuth 2.1** (for the claude.ai web connector — see below).

Quickstart with Claude Code:
```bash
claude mcp add --transport http aido https://<your-app>/api/mcp/sse \
  --header "Authorization: Bearer aido_<your-key>"
```

**Let Claude work off your todos (Agent-Sessions, epic #212).** Assign a todo to a running Claude-Code session and have it answer in place — even without closing it:
1. In the session, call `register-session` once with your hostname + working folder (returns a `sessionId`).
2. In the aido web UI, attach todos to that session ("An Agent-Session anhängen …").
3. In the session, loop: `next-todo` (claims the oldest attached todo, body as Markdown) → `update-todo` (answer in Markdown, incl. code blocks) → `handoff` (back to you, still open) **or** `complete-todo`.

A **claim + lease** stops the same todo being picked up endlessly; a per-session **allowlist** (default: answer + handoff, *not* complete) and **scope to the claimed todo** bound what the loop can do. Manage sessions, allowlists and the lease in **Settings → Agent-Sessions**. No extra env var — this uses your personal API key.

### OAuth (claude.ai connector)
aido is its own **OAuth Authorization Server** for the MCP resource server, reusing the existing Google login for consent:
- Discovery: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`
- Dynamic Client Registration: `/api/oauth/register`
- Authorize + consent page: `/oauth/authorize` (signs in with Firebase Google) → `/api/oauth/authorize/confirm`
- Token: `/api/oauth/token` with PKCE (S256)

Access tokens are short-lived signed JWTs (`sub` = uid); refresh tokens are revocable Firestore entries. Requires `OAUTH_SIGNING_SECRET`.

### Security
- **Firestore rules are the authority**: space membership gates `todos`/`daily`; field-validated writes; owner-only user docs; admin-only API-key and OAuth collections; deny-by-default Storage.
- The Admin SDK bypasses rules, so the MCP tools re-enforce membership and field invariants in code (mirrored by emulator tests).
- Security headers on every route (CSP, `X-Frame-Options`, HSTS, `nosniff`, `Referrer-Policy`); Tiptap link hardening (http/https/mailto allowlist, no `javascript:`/`data:`, `openOnClick` off); Dependabot (root + `functions/`).

## Tech stack

- **Next.js 15** (App Router), React 19, TypeScript, **Tailwind** (oklch design tokens, light/dark via `data-theme`)
- **Firebase**: Auth, Firestore (client SDK v12); **firebase-admin** (v13) for token verification, the Admin-SDK MCP/OAuth data path, and API-key/OAuth storage
- **Cloud Functions v2** (`functions/`): contact-invite e-mails
- **Tiptap 2** for rich-text editing; **markdown-it** for the server-side Markdown↔Tiptap conversion (Agent-Sessions)
- **@modelcontextprotocol/sdk** + **mcp-handler** (MCP transport) · **jose** (OAuth JWTs) · **Zod 4**
- **Vercel** hosting (auto-deploy on merge to `main`); **Node 24.x** runtime (`engines`)

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_FIREBASE_*` — Firebase web app config
   - `FIREBASE_SERVICE_ACCOUNT_KEY` — service-account JSON (single line); needed for personal API keys and the MCP/OAuth data path
   - `MCP_AUTH_TOKEN` — optional shared MCP secret (`openssl rand -hex 32`)
   - `OAUTH_SIGNING_SECRET` — for the OAuth connector (`openssl rand -base64 48`)
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
| `npm run test:rules` | Firestore + Storage security-rules tests (emulator) |
| `npm run test:mcp` | MCP tool tests against the Firestore emulator (real tool code, incl. the Agent-Sessions loop, via `tsx`) |
| `npm run test:markdown` | Markdown↔Tiptap module unit tests (no emulator, via `tsx`) |
| `npm run test:oauth` | OAuth flow tests against the Firestore + Auth emulators (via `tsx`) |
| `npm run test:device-login` | Device-login flow tests (Firestore + Auth emulators, via `tsx`) |
| `npm run test:migration` | Legacy-todo → Spaces migration smoke test (emulator) |
| `npm run migrate:legacy` | One-time admin migration of all users' legacy todos into spaces |

> The `firebase` CLI isn't installed globally — run the emulator/deploy commands via `npx -y firebase-tools@13` (needs a JDK; v13 works with Java 11).

## Deployment

- **App**: merges to `main` deploy automatically via Vercel.
- **Firestore rules**: `npx -y firebase-tools@13 deploy --only firestore:rules`
- **Storage rules**: `npx -y firebase-tools@13 deploy --only storage` (once Storage is enabled in the Firebase console)
- **Cloud Functions**: `npx -y firebase-tools@13 deploy --only functions`

## Project structure

```
src/
  app/
    (protected)/{todos,contacts,settings}/   # authed pages (/todos = the Spaces shell)
    oauth/authorize/                         # OAuth consent page
    .well-known/                             # OAuth discovery metadata
    api/
      mcp/sse/                               # MCP endpoint (mcp-handler)
      oauth/{register,token,authorize/confirm}/  # OAuth Authorization Server
      user/apiKey/                           # personal API keys
  components/
    shell/                                   # Spaces UI: heute/, list/, board/ + mobile shell
  lib/
    contexts/   # Spaces, Todos, Daily, Auth, Theme, Toast, Error providers
    firebase/   # client SDK init, admin SDK init, data helpers
    mcp/        # auth guard, admin data layer, tool logic, request context
    oauth/      # tokens (JWT), PKCE, admin stores, config
    tiptap/     # mention/hashtag extensions, link security, Markdown↔Tiptap (markdown.ts)
functions/      # Cloud Functions (invite e-mails)
tests/          # emulator tests (rules, mcp, oauth, device-login, migration) + markdown unit
docs/           # design handoff + concept/spec documents
firestore.rules # Firestore security rules (the authority)
storage.rules   # Storage security rules
```
