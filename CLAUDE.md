# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Git workflow

- `main` is the default and is **branch-protected** — no direct pushes. Every change goes through a feature branch and a PR.
- Branch naming: `fix/<issue>-<slug>`, `feature/<issue>-<slug>`, `docs/<slug>`, `chore/<slug>`.
- End commit messages with the `Co-Authored-By: Claude Fable 5` trailer and PR bodies with the Claude Code footer.

## Merging

- **Documentation-only changes may be merged immediately, without waiting for green CI.** This covers Markdown/docs, the `docs/` folder, README, comments — anything that does not affect application code or build output.
- For code changes, wait for the Vercel check to be green before merging.

## Verifying changes

- `npm run build`, `npx tsc --noEmit`, `npm run lint` for the app.
- `npm run test:rules` runs the Firestore + Storage security-rules tests in the Firebase emulator. Needs a JDK; if only Java 11 is installed, run via `firebase-tools@13` (v15+ requires Java 21).

## Deployment

- App: merges to `main` auto-deploy via Vercel.
- Firestore rules: `firebase deploy --only firestore:rules` (deploy **after** the app for rules that depend on new app behavior).
- Storage rules: `firebase deploy --only storage` (only once Storage is enabled in the Firebase console).
- Cloud Functions: `cd functions && npm run deploy`.
