# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Aido is a collaborative todo app: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind, with Firebase (Auth, Firestore) on the client, `firebase-admin` on the server, Cloud Functions v2 for invite e-mails, and an MCP server endpoint. All application source lives under `src/`. (Note: `.cursorrules` is stale — it predates the App Router restructure and references removed OpenAI/Anthropic/Replicate/Deepgram integrations; ignore it.)

## Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm run lint           # ESLint (next lint)
npx tsc --noEmit       # type-check (only stale .next/types errors are expected)

# Security-rules tests (Firestore + Storage) in the Firebase emulator.
# Needs a JDK. With only Java 11 installed, invoke via firebase-tools@13
# (v15+ requires Java 21):
npm run test:rules
npx -y firebase-tools@13 emulators:exec --only firestore,storage --project demo-rules-test \
  "node tests/firestore-rules.test.mjs && node tests/storage-rules.test.mjs"
```

There is no unit-test runner; the only automated tests are the emulator-based security-rules suites in `tests/` (plain `node` scripts using `@firebase/rules-unit-testing`, run a single one with `node tests/<file>.mjs` inside `emulators:exec`). `functions/` has its own `package.json` (`npm run build`/`lint` there).

## Architecture

### Data model (Firestore) — authority lives in `firestore.rules`
- `users/{uid}` — **owner-only**; PII (email, displayName, photoURL, theme, notifications, language, timezone).
- `publicProfiles/{uid}` — readable by any authenticated user; PII-free (`displayName`, `displayNameLower`, `photoURL`, `emailHash`). This is the source for **all cross-user lookups**; user search is exact-match on `emailHash` (SHA-256) or prefix on `displayNameLower`, so the user base cannot be enumerated.
- `users/{uid}/todos/{id}` — fields: `text`, `content` (Tiptap JSON), `completed`, `sharedWith[]`, `mentionedUsers[]`, `tags[]`. A single collection-group rule governs reads (owner, sharees, mentioned users). Sharees may only update `completed`; everything else is owner-only.
- `users/{uid}/{contacts,outgoingContactRequests,incomingContactRequests}` — contact graph.
- `userApiKeys/{uid}` — **admin-only, no client access**; stores only `keyHash` (SHA-256) + `keyPrefix`.

When changing the data model, update `firestore.rules` **and** the tests in `tests/firestore-rules.test.mjs` together.

### Firebase access has two distinct layers
- **Client SDK** (`src/lib/firebase/firebase.ts`, exports `auth`/`db`) — used by components and the data helpers in `src/lib/firebase/firebaseUtils.ts` (profiles, contacts, search). Subject to Firestore rules.
- **Admin SDK** (`src/lib/firebase/admin.ts`, `server-only`) — initialized from the `FIREBASE_SERVICE_ACCOUNT_KEY` env var; returns `null` when unset so callers degrade to 503 rather than anything insecure. Used only in API routes that need to bypass rules (API-key storage) or verify ID tokens.

### Auth flow
`AuthProvider` (`src/lib/contexts/AuthContext.tsx`) wraps the app in `src/app/layout.tsx` (alongside `ThemeProvider`/`ErrorProvider`). It listens via `onAuthStateChanged`, lazily creates the `users/{uid}` doc, and upserts `publicProfiles/{uid}` on every login (this is also the migration path for existing users). `(protected)/layout.tsx` gates pages with a client-side redirect — actual data protection is the Firestore rules, not this guard. Server-side token verification happens in API routes via the Admin SDK's `verifyIdToken`.

### MCP server (`src/app/api/mcp/sse/route.ts`)
Model Context Protocol endpoint with `streamable-http` (POST) and SSE (GET) transport. Because the MCP SDK expects Node `http` objects inside Next.js route handlers, requests are shimmed with `node-mocks-http` and a hand-written `ManualMockServerResponse` + Web-Streams polyfills (`src/lib/mcp/http-utils.ts`). Sessions (server+transport per `mcp-session-id`) are held in an in-memory map (`session-manager.ts`) — **not durable across serverless instances**. Tool schemas/handlers are split across `schemas.ts` (Zod 4) and `tool-logic.ts` (`list-todos`/`add-todo`, currently a mock in-memory store). Every handler is guarded by `requireMcpAuth` (`src/lib/mcp/auth.ts`), which accepts either the shared `MCP_AUTH_TOKEN` or a personal API key (hash lookup in `userApiKeys`).

### Rich-text editing (Tiptap)
`src/lib/hooks/useTiptapConfig.ts` centralizes the editor config used by `TodoList`/`Todo`. `@`-mentions are sourced from the user's contacts; `#`-hashtags feed list filtering. Links are hardened via `src/lib/tiptap/linkSecurity.ts` (http/https/mailto allowlist, no `javascript:`/`data:`, `openOnClick` off). Never render Tiptap content with `dangerouslySetInnerHTML`/`generateHTML` — it goes through `<EditorContent>`/ProseMirror, which is the XSS-safe path.

### Routing
`src/app/(protected)/{todos,mentions,contacts,settings}/page.tsx` for authed pages, `src/app/login`, API routes under `src/app/api`. Components are in `src/components/` (not `src/app/components`), shared code in `src/lib/{contexts,hooks,firebase,mcp,tiptap}`.

## Git workflow

- `main` is the default and is **branch-protected** — no direct pushes. Every change goes through a feature branch and a PR.
- Branch naming: `fix/<issue>-<slug>`, `feature/<issue>-<slug>`, `docs/<slug>`, `chore/<slug>`.
- End commit messages with the `Co-Authored-By: Claude Fable 5` trailer and PR bodies with the Claude Code footer.
- Vercel is the only CI check; it occasionally sticks on "pending" — an empty commit on the branch retriggers it.

## Merging

- **Documentation-only changes may be merged immediately, without waiting for green CI.** This covers Markdown/docs, the `docs/` folder, README, comments — anything that does not affect application code or build output.
- For code changes, wait for the Vercel check to be green before merging.

## Deployment

- App: merges to `main` auto-deploy via Vercel.
- Firestore rules: `firebase deploy --only firestore:rules`. Deploy **after** the app when rules depend on new app behavior (e.g. a tightened read rule that the old client would break on).
- Storage rules: `firebase deploy --only storage` (only once Storage is enabled in the Firebase console — it is not currently set up).
- Cloud Functions: `cd functions && npm run deploy`.

## Environment

`.env.example` lists the required vars: `NEXT_PUBLIC_FIREBASE_*` (client config), `MCP_AUTH_TOKEN` (shared MCP secret), `FIREBASE_SERVICE_ACCOUNT_KEY` (single-line service-account JSON; without it the API-key feature returns 503 and MCP falls back to the shared token only).
