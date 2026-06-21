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

# MCP tool tests (issue #122): exercise the real Admin-SDK tool code
# (src/lib/mcp/data.ts + tool-logic.ts) against the Firestore emulator.
npm run test:mcp
```

There is no general unit-test runner; the automated tests are emulator-based and live in `tests/`. Two flavours:
- **Security-rules + migration suites** — plain `node` `.mjs` scripts using `@firebase/rules-unit-testing` (rules) or `firebase-admin` (migration), run inside `emulators:exec` (e.g. `node tests/<file>.mjs`).
- **MCP tool tests** (`tests/mcp-tools.test.mts`, `npm run test:mcp`) — TypeScript run via `tsx`; they import the real `src/lib/mcp/*` code. The runner needs `node --conditions=react-server` (so the `server-only` guard resolves to an empty module) and pre-initializes the `admin`-named Firebase app so `admin.ts` reuses the emulator-bound app instead of going through `cert()`.

`functions/` has its own `package.json` (`npm run build`/`lint` there).

## Architecture

### Data model (Firestore) — authority lives in `firestore.rules`
- `users/{uid}` — **owner-only**; PII (email, displayName, photoURL, theme, notifications, language, timezone).
- `publicProfiles/{uid}` — readable by any authenticated user; PII-free (`displayName`, `displayNameLower`, `photoURL`, `emailHash`). This is the source for **all cross-user lookups**; user search is exact-match on `emailHash` (SHA-256) or prefix on `displayNameLower`, so the user base cannot be enumerated.
- `spaces/{spaceId}` — **top-level; the redesign's organizing unit** (replaces "My Todos / Shared with me"). Fields: `name`, `color` (oklch hue), `members[]`, `createdBy`, `createdAt`. Any member may read/update (rename/recolor/invite); `createdBy`/`createdAt` immutable; only the creator may delete.
- `spaces/{spaceId}/todos/{id}` — structured todos: `spaceId`, `title`, `body` (Tiptap JSON), `completed`, `waitingOn` (userId|null), `tags[]`, `mentions[]`, `createdBy`, `createdAt`, `order`. **Any space member may read AND write** (full collaboration); `createdBy` immutable; `waitingOn` must be null or a current member. Membership is checked in rules via a `get()` on the parent space. **Agent-Session binding (epic #212):** `attachedSession` (sessionId|null), `aidoTurn` (`'aido'`|`'user'`|null), `claimedBy`/`claimedAt` (claim + lease), `lastAidoEditAt` — all optional, shape-validated in rules.
- `spaces/{spaceId}/daily/{id}` — short-lived "Heute" items: `spaceId`, `text`, `completed`, `date` (YYYY-MM-DD), `author`, `createdAt`. Member read/write; `author` immutable.
- `users/{uid}/todos/{id}` — **legacy** (pre-redesign): `text`, `content` (Tiptap JSON), `completed`, `sharedWith[]`, `mentionedUsers[]`, `tags[]`. Superseded by `spaces/{spaceId}/todos`; kept as backup and lazily migrated on login (see Auth flow). A collection-group rule still governs reads; sharees may only update `completed`.
- `users/{uid}/{contacts,outgoingContactRequests,incomingContactRequests}` — contact graph.
- `users/{uid}/sessions/{sessionId}` — **owner-only**; Agent-Sessions (epic #212): a Claude-Code session bound to one space (`sessionId = sha256(spaceId|hostname|workingFolder)`). Fields: `spaceId`, `hostname`, `workingFolder`, `label`, `allowedTools`, `leaseTtlSeconds`, `createdAt`, `lastSeenAt`. Written by the MCP server (Admin SDK); the owner reads/edits them in settings (`agentSessionDefaults.leaseTtlSeconds` on the user doc is the default lease for new sessions).
- `userApiKeys/{uid}` — **admin-only, no client access**; stores only `keyHash` (SHA-256) + `keyPrefix`.

When changing the data model, update `firestore.rules` **and** the tests in `tests/firestore-rules.test.mjs` together.

### Firebase access has two distinct layers
- **Client SDK** (`src/lib/firebase/firebase.ts`, exports `auth`/`db`) — used by components and the data helpers in `src/lib/firebase/firebaseUtils.ts` (profiles, contacts, search). Subject to Firestore rules.
- **Admin SDK** (`src/lib/firebase/admin.ts`, `server-only`) — initialized from the `FIREBASE_SERVICE_ACCOUNT_KEY` env var; returns `null` when unset so callers degrade to 503 rather than anything insecure. Used only in API routes that need to bypass rules (API-key storage) or verify ID tokens.

### Auth flow
`AuthProvider` (`src/lib/contexts/AuthContext.tsx`) wraps the app in `src/app/layout.tsx` (alongside `ThemeProvider`/`ErrorProvider`). It listens via `onAuthStateChanged`, lazily creates the `users/{uid}` doc, upserts `publicProfiles/{uid}` on every login (also the migration path for existing users), and lazily migrates legacy `users/{uid}/todos` into spaces once per user (issue #48, guarded by the `todosMigratedToSpacesAt` flag; `migrateLegacyTodos` in `firebaseUtils`). `(protected)/layout.tsx` gates pages with a client-side redirect — actual data protection is the Firestore rules, not this guard. Server-side token verification happens in API routes via the Admin SDK's `verifyIdToken`.

### MCP server (`src/app/api/mcp/sse/route.ts`)
Model Context Protocol endpoint built on **`mcp-handler`** (the Next.js/Vercel adapter) in **stateless** streamable-HTTP mode (`disableSse: true`) — no durable per-session server state. Tools are registered inline with Zod schemas in `route.ts`; handlers live in `tool-logic.ts` and the **Firestore-backed** data access in `data.ts` (Admin SDK — so it **mirrors `firestore.rules` itself**: membership, immutable `createdBy`, `modifiedBy == caller`, field shapes). Every request is authenticated by `authenticateMcp` (`src/lib/mcp/auth.ts`): the shared `MCP_AUTH_TOKEN` (transport only, no user identity), a personal API key (`aido_…`, hash lookup in `userApiKeys` → uid), or an OAuth JWT (claude.ai connector). Data tools require a `user` principal (the shared token is rejected); the per-request uid is bound via `AsyncLocalStorage` (`context.ts`). Write tools are throttled per uid (`enforceWriteRateLimit`, 30/min).

Tools: `list-spaces`, `list-todos`, `add-todo`, `complete-todo`, `set-waiting-on`, `list-daily`, `add-daily`, `delete-todo`, `whoami`, `list-members`, plus the **Agent-Sessions** work loop (epic #212): `register-session`, `next-todo`, `update-todo`, `handoff`.

**Agent-Sessions (epic #212) — let a Claude-Code session work off todos.** `register-session(spaceId, hostname, workingFolder)` (call first) upserts a space-bound session and returns a deterministic `sessionId`. In a `/loop`: `next-todo` **claims** (transaction + lease) the oldest open todo bound to that session and returns its body as Markdown; `update-todo` writes an answer (Markdown→Tiptap incl. code blocks, **append** by default — `src/lib/tiptap/markdown.ts`, dep `markdown-it`); `handoff` returns it **open** to the human and **releases the session binding** (re-attach to have the agent work it again); `complete-todo` (with `sessionId`) closes it — both clear `attachedSession`/claim so a done/handed-off todo is no longer "assigned" in the UI. Wirkung is bounded by **scope-to-claimed-todo** + a **per-session tool allowlist** (default `['update-todo','handoff']`). The user attaches todos to a session in the web UI (`AttachToSessionMenu`, status badge via `StatusBadge`) and manages sessions in settings (`AgentSessionsSettings`). **No new env var** — Agent-Sessions use the personal API key.

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

## Spec → Issues (Epic pattern)

When a spec (e.g. the `docs/0X-*.md` flow from the `concept-analysis-spec` skill) is broken into **multiple** issues, **always** create one **Epic** issue as the parent and link the others as native GitHub **sub-issues** (not just a checklist):

1. Create the Epic first (`gh issue create --label epic …`); its body holds the goal, links to the `docs/` spec files, the ordered sub-issue list, and the deploy ordering.
2. Create each child issue (`Teil von Epic #<epic>` in the body; reference the same `docs/`).
3. Link each child to the Epic via the sub-issues REST API — the child's **database id** (`gh api repos/{owner}/{repo}/issues/<child> --jq .id`), then `gh api --method POST repos/{owner}/{repo}/issues/<epic>/sub_issues -F sub_issue_id=<dbId>`. Verify with `gh api repos/{owner}/{repo}/issues/<epic>/sub_issues --jq '.[].number'`.
4. The `epic` label already exists. A single issue from a spec needs no Epic.

## Merging

- **Documentation-only changes may be merged immediately, without waiting for green CI.** This covers Markdown/docs, the `docs/` folder, README, comments — anything that does not affect application code or build output.
- For code changes, wait for the Vercel check to be green before merging.

### Merging stacked PRs (Epic sub-issues)

When an Epic's sub-issues ship as **stacked** PRs (each branched off the previous feature branch, not `main`), do **not** just `gh pr merge <parent> --squash --delete-branch` down the stack. Deleting a stacked PR's base branch does **not** reliably auto-retarget its child — GitHub may **close** the child, and a closed PR whose base branch is gone cannot be reopened or retargeted (`Cannot change the base branch of a closed pull request`). Squash also leaves children `CONFLICTING` against `main` (the squashed parent is a new SHA).

Do this instead:
1. Before merging the bottom of the stack, retarget every higher child PR to `main` (`gh pr edit <n> --base main`) **while it is still OPEN**.
2. After each merge to `main`, rebuild the next branch cleanly: `git checkout -B <branch> origin/main && git cherry-pick <that issue's single commit>` (our branches are one commit each), force-push, wait for green Vercel, merge. Each squash commit on `main` then contains exactly its own issue's diff.
3. Recovery if a child already got closed: cherry-pick its commit onto `main` on a fresh branch, force-push, open a **new** PR (`Closes #<issue>` still works).

## Deployment

The `firebase` CLI is **not installed globally** (a bare `firebase …` gives "command not found"). Prefix every Firebase command with `npx -y firebase-tools@13` — the same v13 pin the rules tests use (v15+ needs Java 21 / Node ≤22; this machine has Java 11 / Node 25). First-time auth: `npx -y firebase-tools@13 login`. The default project (`template-2-20926`) is set in `.firebaserc`.

- App: merges to `main` auto-deploy via Vercel.
- Firestore rules: `npx -y firebase-tools@13 deploy --only firestore:rules`. Deploy **after** the app when rules depend on new app behavior (e.g. a tightened read rule that the old client would break on).
- Storage rules: `npx -y firebase-tools@13 deploy --only storage` (only once Storage is enabled in the Firebase console — it is not currently set up).
- Cloud Functions: `npx -y firebase-tools@13 deploy --only functions` (the `functions/` `npm run deploy` script calls a bare `firebase` and will fail without a global install).
- **Legacy-todo migration (one-time, issue #66):** the client-lazy migration only runs on the owner's login, so sharees stay stranded until the owner logs in again. Run `npm run migrate:legacy` once against prod (`FIREBASE_SERVICE_ACCOUNT_KEY` set; add `--dry-run` first) to migrate **all** users up front. It mirrors the client's deterministic space ids/markers, so it's idempotent and safe to interleave with client runs. Smoke-test it against the emulator with `npm run test:migration`.

## Environment

`.env.example` lists the required vars: `NEXT_PUBLIC_FIREBASE_*` (client config), `MCP_AUTH_TOKEN` (shared MCP secret), `FIREBASE_SERVICE_ACCOUNT_KEY` (single-line service-account JSON; without it the API-key feature returns 503 and MCP falls back to the shared token only).
