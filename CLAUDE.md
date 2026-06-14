# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Aido is a collaborative todo app: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind, with Firebase (Auth, Firestore) on the client, `firebase-admin` on the server, Cloud Functions v2 for invite e-mails, and an MCP server endpoint. All application source lives under `src/`. The UI was redesigned around **Spaces** (epic #38) — see "Redesign UI (Spaces shell)" below.

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
- `spaces/{spaceId}` — **top-level; the redesign's organizing unit** (replaces "My Todos / Shared with me"). Fields: `name`, `color` (oklch hue), `members[]`, `createdBy`, `createdAt`. Any member may read/update (rename/recolor/invite); `createdBy`/`createdAt` immutable; only the creator may delete.
- `spaces/{spaceId}/todos/{id}` — structured todos: `spaceId`, `title`, `body` (Tiptap JSON), `completed`, `waitingOn` (userId|null), `tags[]`, `mentions[]`, `createdBy`, `createdAt`, `order`. **Any space member may read AND write** (full collaboration); `createdBy` immutable; `waitingOn` must be null or a current member. Membership is checked in rules via a `get()` on the parent space.
- `spaces/{spaceId}/daily/{id}` — short-lived "Heute" items: `spaceId`, `text`, `completed`, `date` (YYYY-MM-DD), `author`, `createdAt`. Member read/write; `author` immutable.
- `users/{uid}/todos/{id}` — **legacy** (pre-redesign): `text`, `content` (Tiptap JSON), `completed`, `sharedWith[]`, `mentionedUsers[]`, `tags[]`. Superseded by `spaces/{spaceId}/todos`; kept as backup and lazily migrated on login (see Auth flow). A collection-group rule still governs reads; sharees may only update `completed`.
- `users/{uid}/{contacts,outgoingContactRequests,incomingContactRequests}` — contact graph.
- `userApiKeys/{uid}` — **admin-only, no client access**; stores only `keyHash` (SHA-256) + `keyPrefix`.

When changing the data model, update `firestore.rules` **and** the tests in `tests/firestore-rules.test.mjs` together.

### Firebase access has two distinct layers
- **Client SDK** (`src/lib/firebase/firebase.ts`, exports `auth`/`db`) — used by components and the data helpers in `src/lib/firebase/firebaseUtils.ts` (profiles, contacts, search). Subject to Firestore rules.
- **Admin SDK** (`src/lib/firebase/admin.ts`, `server-only`) — initialized from the `FIREBASE_SERVICE_ACCOUNT_KEY` env var; returns `null` when unset so callers degrade to 503 rather than anything insecure. Used only in API routes that need to bypass rules (API-key storage) or verify ID tokens.

### Auth flow
`AuthProvider` (`src/lib/contexts/AuthContext.tsx`) wraps the app in `src/app/layout.tsx` (alongside `ThemeProvider`/`ErrorProvider`). It listens via `onAuthStateChanged`, lazily creates the `users/{uid}` doc, upserts `publicProfiles/{uid}` on every login (also the migration path for existing users), and lazily migrates legacy `users/{uid}/todos` into spaces once per user (issue #48, guarded by the `todosMigratedToSpacesAt` flag; `migrateLegacyTodos` in `firebaseUtils`). `(protected)/layout.tsx` gates pages with a client-side redirect — actual data protection is the Firestore rules, not this guard. Server-side token verification happens in API routes via the Admin SDK's `verifyIdToken`.

### MCP server (`src/app/api/mcp/sse/route.ts`)
Model Context Protocol endpoint with `streamable-http` (POST) and SSE (GET) transport. Because the MCP SDK expects Node `http` objects inside Next.js route handlers, requests are shimmed with `node-mocks-http` and a hand-written `ManualMockServerResponse` + Web-Streams polyfills (`src/lib/mcp/http-utils.ts`). Sessions (server+transport per `mcp-session-id`) are held in an in-memory map (`session-manager.ts`) — **not durable across serverless instances**. Tool schemas/handlers are split across `schemas.ts` (Zod 4) and `tool-logic.ts` (`list-todos`/`add-todo`, currently a mock in-memory store). Every handler is guarded by `requireMcpAuth` (`src/lib/mcp/auth.ts`), which accepts either the shared `MCP_AUTH_TOKEN` or a personal API key (hash lookup in `userApiKeys`).

### Rich-text editing (Tiptap)
`src/lib/hooks/useTiptapConfig.ts` centralizes the editor config used by the Liste composer/rows (`src/components/shell/list/*`: `TodoEditor` for editing, `TodoBody` for the read-only render). `@`-mentions are sourced from the user's contacts; `#`-hashtags feed list filtering. Checklist checkboxes stay interactive in the read-only body via TaskItem's `onReadOnlyChecked`. Links are hardened via `src/lib/tiptap/linkSecurity.ts` (http/https/mailto allowlist, no `javascript:`/`data:`, `openOnClick` off). Never render Tiptap content with `dangerouslySetInnerHTML`/`generateHTML` — it goes through `<EditorContent>`/ProseMirror, which is the XSS-safe path.

### Redesign UI (Spaces shell)
`/todos` renders `AppShell` (`src/components/shell/`), which provides the chrome (there is **no global Navbar**). Responsive via CSS: `DesktopShell` (`md:flex`, sidebar + scrolling main column) and `MobileShell` (`md:hidden`, fixed header + bottom tabs + bottom sheets). Workspace state lives in React contexts: `SpacesContext` (spaces, activeSpace, list/board `view`, open counts), `TodosContext` (active space's todos, tag filter, CRUD — **shared by Liste & Board**), `DailyContext` (Heute items), `ToastContext`. Views: Heute (`shell/heute/`), Liste (`shell/list/`), Board (`shell/board/`). Design tokens are oklch CSS variables in `globals.css` (dark default on `:root`, light on `html[data-theme="light"]`); `ThemeContext` toggles `data-theme` **and** the legacy `.dark` class together, and Tailwind utilities map onto the tokens (`bg-bg-card`, `text-text-dim`, `border-border`, …). Fonts: Nunito (UI) + JetBrains Mono (tags/numbers) via `next/font`.

### Routing
`src/app/(protected)/{todos,contacts,settings}/page.tsx` for authed pages. `/todos` is the redesigned Spaces shell and the post-login landing route; `/` is a thin redirector (authed → `/todos`, else → `/login`). `src/app/login`, API routes under `src/app/api`. Components are in `src/components/` (shell UI under `src/components/shell/`), shared code in `src/lib/{contexts,hooks,firebase,mcp,tiptap,theme,utils}`.

## Git workflow

- `main` is the default and is **branch-protected** — no direct pushes. Every change goes through a feature branch and a PR.
- Branch naming: `fix/<issue>-<slug>`, `feature/<issue>-<slug>`, `docs/<slug>`, `chore/<slug>`.
- End commit messages with the `Co-Authored-By: Claude Fable 5` trailer and PR bodies with the Claude Code footer.
- Vercel is the only CI check; it occasionally sticks on "pending" — an empty commit on the branch retriggers it.

## Merging

- **Documentation-only changes may be merged immediately, without waiting for green CI.** This covers Markdown/docs, the `docs/` folder, README, comments — anything that does not affect application code or build output.
- For code changes, wait for the Vercel check to be green before merging.

## Deployment

The `firebase` CLI is **not installed globally** (a bare `firebase …` gives "command not found"). Prefix every Firebase command with `npx -y firebase-tools@13` — the same v13 pin the rules tests use (v15+ needs Java 21 / Node ≤22; this machine has Java 11 / Node 25). First-time auth: `npx -y firebase-tools@13 login`. The default project (`template-2-20926`) is set in `.firebaserc`.

- App: merges to `main` auto-deploy via Vercel.
- Firestore rules: `npx -y firebase-tools@13 deploy --only firestore:rules`. Deploy **after** the app when rules depend on new app behavior (e.g. a tightened read rule that the old client would break on).
- Storage rules: `npx -y firebase-tools@13 deploy --only storage` (only once Storage is enabled in the Firebase console — it is not currently set up).
- Cloud Functions: `npx -y firebase-tools@13 deploy --only functions` (the `functions/` `npm run deploy` script calls a bare `firebase` and will fail without a global install).
- **Legacy-todo migration (one-time, issue #66):** the client-lazy migration only runs on the owner's login, so sharees stay stranded until the owner logs in again. Run `npm run migrate:legacy` once against prod (`FIREBASE_SERVICE_ACCOUNT_KEY` set; add `--dry-run` first) to migrate **all** users up front. It mirrors the client's deterministic space ids/markers, so it's idempotent and safe to interleave with client runs. Smoke-test it against the emulator with `npm run test:migration`.

## Environment

`.env.example` lists the required vars: `NEXT_PUBLIC_FIREBASE_*` (client config), `MCP_AUTH_TOKEN` (shared MCP secret), `FIREBASE_SERVICE_ACCOUNT_KEY` (single-line service-account JSON; without it the API-key feature returns 503 and MCP falls back to the shared token only).
