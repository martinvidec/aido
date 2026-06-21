# Spezifikation: Todos an eine Agent-Session binden und abarbeiten lassen

Bezug: [Konzept](01-konzept-aido-sessions.md), [Ist-Analyse](02-ist-analyse-aido-sessions.md),
[Anforderungsanalyse](03-anforderungsanalyse-aido-sessions.md).

## 1. Übersicht

Eine **Agent-Session** ist ein an genau einen Space gebundenes Objekt unter
`users/{uid}/sessions/{sessionId}`. Eine Claude-Code-Session registriert sich (`register-session`),
der Nutzer hängt Todos dieses Space an die Session (UI), und die Session holt sie per `next-todo`
(Claim + Lease), beantwortet/ergänzt den Body (`update-todo`, Markdown→Tiptap) und gibt sie offen
zurück (`handoff`) oder schließt sie ab (`complete-todo`). Die Wirkung ist durch **Scope auf das
geclaimte Todo** und eine **Per-Session-Allowlist** eingegrenzt. Kein Datenmodell-Bruch: alle neuen
Felder sind optional/`null`, kein Backfill.

## 2. Technisches Design

### 2.1 Architektur

- Alle Server-Tools leben weiter im bestehenden MCP-Endpoint (`route.ts` → `tool-logic.ts` →
  `data.ts`, Admin-SDK, per-Request-Principal). Es kommt **kein** neuer Prozess/Service dazu.
- `next-todo` ist ein **Per-Space-Query** (Session ist space-gebunden) → **kein** Collection-Group,
  **kein** Spezial-Index. Die Kandidaten werden wie in `listTodos` geladen und **in-memory**
  gefiltert/sortiert (Anzahl angehängter Todos je Session ist klein).
- Markdown↔Tiptap ist ein **serverfähiges Modul** (`src/lib/tiptap/markdown.ts`), unabhängig von
  `useTiptapConfig`/`@tiptap/react`.

### 2.2 Datenmodell

**Neuer Typ `AgentSession`** (`src/lib/types.ts`), Collection `users/{uid}/sessions/{sessionId}`:

```ts
export type AgentToolName = 'update-todo' | 'handoff' | 'complete-todo';

export interface AgentSession {
  id: string;                 // = sessionId = sha256(spaceId|hostname|workingFolder) (hex, gekürzt)
  spaceId: string;
  hostname: string;
  workingFolder: string;
  label: string | null;
  allowedTools: AgentToolName[];   // Default ['update-todo','handoff']
  leaseTtlSeconds: number;         // Default aus User-Setting (z.B. 600)
  createdAt: Timestamp | null;
  lastSeenAt: Timestamp | null;
}
```

**`Todo`-Erweiterung** (`src/lib/types.ts`, alle optional/`null`):

```ts
attachedSession: string | null;    // sessionId, oder null = nicht gebunden
aidoTurn: 'aido' | 'user' | null;  // wessen Zug (nur sinnvoll wenn attached)
claimedBy: string | null;          // sessionId, die den Claim hält
claimedAt: Timestamp | null;       // Claim-Zeitpunkt (Lease-Basis)
lastAidoEditAt: Timestamp | null;  // Marker „von aido"
```

**Zustands-Ableitung** (für UI-Badge & `next-todo`):

| Zustand | Bedingung |
|---|---|
| nicht gebunden | `attachedSession == null` |
| `bei aido` (Queue) | attached & `aidoTurn=='aido'` & (`claimedBy==null` **oder** Lease abgelaufen) |
| `in Arbeit` | attached & `aidoTurn=='aido'` & `claimedBy!=null` & Lease gültig |
| `bei dir` | attached & `aidoTurn=='user'` |
| erledigt | `completed==true` |

**User-Setting** (`users/{uid}`): `agentSessionDefaults: { leaseTtlSeconds: number }` (z.B. 600).

### 2.3 Schnittstellen (MCP-Tools)

Session-Identität wird in `register-session`/`next-todo` aus `(spaceId, hostname, workingFolder)`
**deterministisch** abgeleitet; die mutierenden Session-Tools nehmen die `sessionId` (aus
`register-session`/`next-todo`) entgegen.

| Tool | Zod-Eingabe | Rückgabe / Wirkung |
|---|---|---|
| `register-session` | `{ spaceId, hostname, workingFolder, label?, allowedTools? }` | `requireMember`; Upsert `users/{uid}/sessions/{sha}`; setzt `lastSeenAt`; `allowedTools` Default `['update-todo','handoff']`, `leaseTtlSeconds` aus User-Default. → `{ sessionId, spaceId, allowedTools, leaseTtlSeconds }` |
| `next-todo` | `{ spaceId, hostname, workingFolder }` | `requireMember`; löst `sessionId`, Session muss existieren; **claimt** (s. 2.4); Heartbeat `lastSeenAt`. → `{ todo: { spaceId, todoId, title, bodyMarkdown, body, tags, createdBy } } \| { todo: null }` |
| `update-todo` | `{ sessionId, spaceId, todoId, bodyMarkdown, mode? }` (`mode` ∈ `append`\|`replace`, Default `append`) | Scope+Allowlist (`update-todo`); Markdown→Tiptap; `append` fügt „💬 Antwort von aido"-Block + Antwort an, `replace` ersetzt; `tags`/`mentions` neu ableiten; `modifiedBy=uid`, `lastAidoEditAt=now`. → aktualisierte `TodoView` |
| `handoff` | `{ sessionId, spaceId, todoId }` | Scope+Allowlist (`handoff`); `aidoTurn='user'`, `claimedBy=null`,`claimedAt=null`. Todo bleibt offen. → `TodoView` |
| `complete-todo` | **erweitert:** `{ spaceId, todoId, completed, sessionId? }` | Ohne `sessionId`: bisheriges Verhalten (member-gegated). Mit `sessionId`: zusätzlich Scope+Allowlist (`complete-todo`) und Claim lösen. |

`requireUserUid()` + `enforceWriteRateLimit(uid)` gelten wie bei den bestehenden Schreib-Tools.
`next-todo`-Claim ist ein Write — wird gezählt; bei engem Loop-Takt das 30/min-Limit beachten
(NFA-06).

### 2.4 Claim/Lease-Algorithmus (`nextTodo` in `data.ts`)

```
1. session = getSession(uid, sha(spaceId,host,cwd));  // McpToolError not_found falls fehlt
   requireMember(uid, spaceId); touch lastSeenAt.
2. Lade Kandidaten: spaces/{spaceId}/todos where attachedSession == sessionId
   (Einzelfeld-Filter, auto-indexiert). In-memory:
   a. self = Kandidaten mit completed==false && aidoTurn=='aido' && claimedBy==sessionId
            && lease gültig  → falls vorhanden: ältestes (createdAt) zurückgeben (idempotenter Self-Claim).
   b. frei = completed==false && aidoTurn=='aido' && (claimedBy==null || claimedAt < now-leaseTtl)
   c. sortiere `frei` nach createdAt asc.
3. Für jeden Kandidaten in `frei` (ältester zuerst): runTransaction:
   - re-read doc; prüfe Eligibilität erneut (nicht von anderem gültig geclaimt, noch aidoTurn=='aido', offen);
   - falls ok: set claimedBy=sessionId, claimedAt=serverTimestamp, modifiedBy=uid; commit; return.
   - falls inzwischen weg-geclaimt: nächster Kandidat.
4. Keiner → { todo: null }.
```

Transaktion garantiert **kein Doppel-Claim** (NFA-03). „Höchstens ein Claim je Session" entsteht aus
Schritt 2a (Self-Claim wird vor Neu-Claim bevorzugt) + striktem Loop-Muster (handoff/complete vor
nächstem `next-todo`).

### 2.5 Markdown ↔ Tiptap (`src/lib/tiptap/markdown.ts`)

Erzeugt/liest **ausschließlich** die in `useTiptapConfig` registrierten Typen: `doc, paragraph,
heading, bulletList, orderedList, listItem, codeBlock, taskList, taskItem, blockquote` sowie Marks
`bold, italic, strike, link, highlight`. **Keine** Inline-`code`-Mark, **kein** `horizontalRule`,
**kein** `hardBreak`.

```ts
export function markdownToTiptap(md: string): TiptapContent | null; // null bei leer
export function tiptapToMarkdown(doc: TiptapContent | null): string;
export function appendAnswer(existing: TiptapContent | null, answerMd: string, opts: { at: Date }): TiptapContent;
```

- **Parser:** `markdown-it` (neue Dependency) → Token-Stream → Tiptap-JSON-Mapping.
- **Codeblock:** ` ```lang … ``` ` → `codeBlock` (Attr `language`). **Inline-Code** (kein Inline-Mark
  verfügbar): wird zu einem **eigenen `codeBlock`** befördert; steht Inline-Code mitten im Satz, wird
  der Absatz an dieser Stelle getrennt (Code als eigener Block). *Tool-Beschreibung weist den Agenten
  an, für Code bevorzugt fenced Blocks zu nutzen.*
- **Links:** nur wenn `isSafeLinkUrl(url)` (aus `linkSecurity`) — sonst als Klartext.
- **Nicht abbildbares** (`---`, harte Umbrüche) wird verworfen/zu Absätzen normalisiert.
- **`appendAnswer`:** `existing.content` + Marker-Block (`heading`/`paragraph` „💬 Antwort von aido ·
  {Zeit}") + konvertierte Antwort.
- **Lesen (`tiptapToMarkdown`):** Walk über die Nodes; `mention`→`@label`, `hashtag`/Text bleibt
  Text; `codeBlock`→fenced. `tags`/`mentions` werden beim Schreiben weiterhin über
  `deriveTags`/`deriveMentions` aus Title+Body abgeleitet (unverändert).

### 2.6 Sicherheitsregeln (`firestore.rules`)

**Sessions** unter `match /users/{userId}`:

```
match /sessions/{sessionId} {
  allow read, write, delete: if isOwner(userId);
}
```

(MCP schreibt via Admin-SDK ohnehin an den Regeln vorbei; die Regel deckt das **UI**-Lesen/-Editieren
durch den Owner ab — Umbenennen, `allowedTools`/`leaseTtlSeconds`, Löschen.)

**Todo-Felder** — `hasValidTodoFields` (bzw. neue Hilfsfunktion) um Shape-Checks erweitern, auf
create **und** update (Teil-Updates mergen in die volle Doc-Form):

```
&& (!('attachedSession' in d) || d.attachedSession == null || d.attachedSession is string)
&& (!('aidoTurn' in d)        || d.aidoTurn == null || d.aidoTurn in ['aido','user'])
&& (!('claimedBy' in d)       || d.claimedBy == null || d.claimedBy is string)
&& (!('claimedAt' in d)       || d.claimedAt == null || d.claimedAt is timestamp)
&& (!('lastAidoEditAt' in d)  || d.lastAidoEditAt == null || d.lastAidoEditAt is timestamp)
```

`modifiedBy == auth.uid` und `createdBy`-Immutabilität bleiben unverändert (die Data-Layer setzt
`modifiedBy=uid`). *Residual (Offene Frage):* ein Member könnte per Client-SDK `claimedBy` fälschen;
für v1 nur Shape-Validierung, optional später Admin-only-Restriktion via `diff()`.

### 2.7 Web-UI

| Komponente (neu/geändert) | Aufgabe |
|---|---|
| `src/lib/types.ts` | `AgentSession`, Todo-Felder |
| `src/lib/firebase/firebaseUtils.ts` | `attachTodoToSession(spaceId,todoId,sessionId,uid)`, `detachTodoSession(...)`, `setTodoAidoTurn(...,'aido',uid)` („zurück an aido"); je `modifiedBy=uid` |
| `src/lib/firebase/firebaseUtils.ts` | `subscribeAgentSessionsForSpace(uid,spaceId,cb)`, `renameSession`, `deleteSession`, `setSessionConfig(allowedTools,leaseTtlSeconds)` |
| `src/lib/contexts/TodosContext.tsx` | `attachToSession`, `detach`, `returnToAido` ergänzen |
| `src/components/shell/AttachToSessionMenu.tsx` (neu) | Picker (analog `MoveToSpaceMenu`), zeigt Sessions des **aktiven Space** |
| `src/components/shell/list/TodoActions.tsx` | Einträge „An Agent-Session anhängen…", „Lösen", „Zurück an aido" (bei `aidoTurn=='user'`) |
| `src/components/shell/board/{TodoCard,BoardView}.tsx` | Attach-Eintrag + Status-Badge |
| `src/components/shell/StatusBadge` (neu, klein) | leitet Badge `bei aido`/`in Arbeit`/`bei dir` aus Todo-Feldern + Lease ab |
| `src/components/AgentSessionsSettings.tsx` (neu) | in `UserSettings` neben `ApiKeySettings`; **klar von `SessionSettings` (Geräte) getrennt**; Liste, Umbenennen, Entfernen, `allowedTools`/`leaseTtlSeconds` |
| `src/components/UserSettings.tsx` | `agentSessionDefaults.leaseTtlSeconds` lesen/schreiben |

## 3. Implementierungsplan

### 3.1 Änderungen pro Komponente

| Komponente | Änderung | Aufwand |
|---|---|---|
| `types.ts` + `firestore.rules` + `tests/firestore-rules.test.mjs` | Felder, `AgentSession`, Sessions-Regel, Shape-Checks + Tests | Mittel |
| `src/lib/tiptap/markdown.ts` (+ `markdown-it` dep) | Markdown↔Tiptap, `appendAnswer`, Inline-Code→Codeblock, Link-Härtung | Mittel–Groß |
| `src/lib/mcp/data.ts` | `registerSession`, `nextTodo` (Claim/Lease-Txn), `updateTodo`, `handoffTodo`, `completeTodo(sessionId?)`; `TodoView`/Body | Groß |
| `src/lib/mcp/tool-logic.ts` + `route.ts` | Handler, Zod-Schemas, Tool-Registrierung, Allowlist-Enforcement | Mittel |
| `tests/mcp-tools.test.mts` | Claim/Lease, Allowlist, Scope, `update-todo`-Modi, Konvertierung | Mittel–Groß |
| `firebaseUtils.ts` + `TodosContext.tsx` | Attach/Detach/Return-Helfer + Sessions-Abo | Mittel |
| Liste/Board-UI + `AttachToSessionMenu` + `StatusBadge` | Attach-Aktionen + Badges | Mittel |
| `AgentSessionsSettings.tsx` + `UserSettings.tsx` | Sessions-Panel + Lease-TTL-Default | Mittel |
| `CLAUDE.md`/`README`/`.env.example` | Tool-Liste, `/loop`-Setup, Benennung | Klein |

### 3.2 Reihenfolge (issue-fähig geschnitten)

1. **Datenmodell + Regeln + Rules-Tests** (Felder, `AgentSession`, Sessions-Collection). *Fundament.*
2. **Markdown↔Tiptap-Modul** (+ Unit-Tests). *Unabhängig, parallel zu 1.*
3. **MCP-Datenzugriff** (`registerSession`, `nextTodo`-Claim/Lease, `updateTodo`, `handoff`,
   `completeTodo(sessionId?)`, Body in `TodoView`). *Abh.: 1, 2.*
4. **MCP-Tools/Dispatch** (Zod, `route.ts`, Allowlist) + **MCP-Tool-Tests**. *Abh.: 3.*
5. **Client-Schreibhelfer + `TodosContext` + Sessions-Abo.** *Abh.: 1.*
6. **Liste/Board-UI** (Attach-Menü, „zurück an aido", Status-Badges). *Abh.: 5.*
7. **Agent-Sessions-Settings-Panel + Lease-TTL-Default.** *Abh.: 5.*
8. **Doku** (`CLAUDE.md`/`README`/`.env`, `/loop`-Anleitung). *Abschluss.*

Schritte 1–4 liefern den **MVP-Loop end-to-end** (über MCP testbar); 5–7 die Web-UX.

→ Als **Epic** mit Sub-Issues anlegen (CLAUDE.md „Spec → Issues"), Deploy-Reihenfolge wie oben.

## 4. Testplan

- **Rules-Tests** (`firestore-rules.test.mjs`): `users/{uid}/sessions` owner-only; gültige/ungültige
  `aidoTurn`/`claimedBy`/`claimedAt`-Shapes; Member darf `attachedSession`/`aidoTurn` setzen;
  `modifiedBy`-Pflicht bleibt.
- **MCP-Tool-Tests** (`mcp-tools.test.mts`, Emulator): `register-session` deterministische id +
  Upsert + Member-Gate; `next-todo` liefert ältestes, claimt, zweiter Aufruf → nächstes; Self-Claim
  idempotent; Lease-Ablauf reclaim; kein Doppel-Claim (parallele Txn-Simulation); `update-todo`
  append/replace + Markdown→Codeblock + Tags-Rederivation + **Scope-Reject** (nicht geclaimt) +
  **Allowlist-Reject**; `handoff` setzt `aidoTurn='user'` + löst Claim; `complete-todo` mit
  `sessionId` Allowlist-gegated.
- **Markdown-Modul-Tests:** Überschriften/Listen/Codeblock/Links (safe & unsafe)/Inline-Code→Codeblock;
  `tiptapToMarkdown` Grund-Roundtrip; `appendAnswer` erhält Original + Marker.
- **Manuell:** echte Claude-Code-Session: `register-session` → UI-Attach → `/loop` mit `next-todo`/
  `update-todo`/`handoff` → Badge-Wechsel + formatierter Body in der Web-UI.

## 5. Migration / Deployment

- **Keine Datenmigration** (Felder optional/`null`, kein Backfill).
- **Kein neuer Index** (In-memory-Filter in `nextTodo`); `firestore.indexes.json` nur anlegen, falls
  später ein Composite-Index gewünscht ist.
- **Deploy-Reihenfolge:** App zuerst (Vercel, enthält den MCP-Endpoint), dann
  `npx -y firebase-tools@13 deploy --only firestore:rules` (Sessions-Regel + Feld-Shapes; alte
  Clients verletzen nichts, da Felder optional).
- **Keine neuen Env-Variablen** — Sessions laufen über den vorhandenen Personal-API-Key.
- **Neue Dependency:** `markdown-it` (+ Types) in `package.json`.

## 6. Referenzen

- [Konzept](01-konzept-aido-sessions.md)
- [Ist-Analyse](02-ist-analyse-aido-sessions.md)
- [Anforderungsanalyse](03-anforderungsanalyse-aido-sessions.md)
