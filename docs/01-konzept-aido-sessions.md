# Konzept: Todos an eine Claude-Code-Session binden und abarbeiten lassen

## 1. Zusammenfassung

Statt Todos pauschal „aido" zuzuweisen, bindet der Nutzer ein Todo an eine **konkrete,
laufende Claude-Code-Session**. Eine Session meldet sich beim Start über ein neues MCP-Tool
(`register-session`) mit **Hostname** und **Working Folder** an und wird dadurch in der aido-UI
sichtbar. Dort kann der Nutzer ein Todo per **„An Session anhängen…"** einer Session zuordnen
(mehrere Sessions pro Nutzer möglich). Die Session fragt im `/loop` über `next-todo` jeweils das
**älteste, noch nicht erledigte, an sie gebundene Todo** ab, liest dessen Rich-Text-Body,
**beantwortet Fragen darin und ergänzt es** (Tiptap inkl. **Codeblöcken**) und gibt es entweder
**zurück an den Menschen** (offen) oder **schließt es ab**. Ein **Claim+Lease+Status-Mechanismus**
stellt sicher, dass nie endlos dasselbe Todo abgeholt wird.

> **Abgrenzung zu [Konzept 01 – Claude Code Channels](01-konzept-claude-code-channels.md):**
> Channels sind der **Push-Weg** (aido benachrichtigt eine Session über Ereignisse). Dieses
> Konzept ist der **Pull-/Arbeits-Weg** (eine Session holt sich gezielt die ihr zugewiesenen
> Todos und schreibt Antworten zurück). Beide sind komplementär.

## 2. Problemstellung

Der erste Entwurf („Todo an *aido* zuweisen") trägt nicht, aus zwei Gründen:

1. **Nicht jeder Nutzer betreibt einen MCP-Loop.** Eine generische `assignTo: aido`-Markierung
   würde ohne ein laufendes Claude-Code-Setup **nichts bewirken** — das Todo bliebe einfach
   liegen.
2. **„aido" ist nicht von „mir mit Claude" unterscheidbar.** Der Nutzer ist über seinen
   Personal-API-Key mit dem MCP-Server verbunden und handelt dabei unter der **eigenen uid**
   (`requireUserUid()` in `tool-logic.ts`). Ob ich ein Todo *interaktiv* mit Claude bearbeite
   oder ein `/loop` es *automatisch* abarbeitet, ist serverseitig identisch. Eine pauschale
   „aido"-Zuständigkeit ist deshalb mehrdeutig.

Die Bindung an eine **benannte, konkrete Session** (Host + Ordner) löst beides: es passiert nur
dann etwas, wenn (a) eine Session tatsächlich läuft und sich gemeldet hat **und** (b) der Nutzer
ein Todo **explizit** an genau diese Session gehängt hat. Keine Magie, keine Mehrdeutigkeit.

Zusätzlich bestehen weiterhin die technischen Lücken aus dem ersten Entwurf:

- Das von `list-todos` gelieferte `TodoView` (`src/lib/mcp/data.ts`) enthält **nicht den
  `body`** — die eigentliche Aufgabe/Frage ist für Claude unsichtbar.
- Es gibt **kein Tool, das `body` schreibt** (`add-todo` erzeugt nur Plain-Text-Bodies, ohne
  Codeblöcke); „eine Frage beantworten, ohne zu schließen" ist damit unmöglich.

## 3. Zielsetzung

- Eine Claude-Code-Session **registriert sich** zu Beginn mit Hostname + Working Folder und ist
  danach in der aido-UI als anhängbares Ziel sichtbar (mit „zuletzt aktiv").
- Der Nutzer kann ein Todo in der Web-UI **einer Session anhängen** und die Bindung wieder lösen;
  der Bindungs-/Bearbeitungszustand ist **sichtbar** (Badge „bei aido / in Arbeit / bei dir").
- Eine Session holt per `next-todo` deterministisch das **älteste offene gebundene Todo**, liest
  den **vollständigen Body**, kann ihn **mit formatiertem Text (Markdown→Tiptap, Codeblöcke)
  ergänzen/beantworten** und es **offen zurückgeben** oder **abschließen**.
- **Kein Todo wird endlos erneut abgeholt:** ein Todo kehrt erst zu „bei aido" zurück, wenn ein
  **Mensch** reagiert hat — oder ein abgestürzter Claim per **Lease** verfällt.
- aido-Antworten **rendern korrekt** in der Web-UI (read-only Body, inkl. Codeblöcke) und sind
  als **„von aido"** erkennbar.
- Sicherheit/Parität bleiben gewahrt: alle Schreibpfade durchlaufen die bestehenden Member-Gates,
  `firestore.rules` validiert die neuen Felder, der Body bleibt XSS-sicher.

**Messbar erreicht**, wenn: eine in `~/project` auf Host *MacBook* registrierte Session ein dort
angehängtes Todo mit einer Frage per `next-todo` erhält, eine codeblock-haltige Antwort per
`update-todo` **append** zurückschreibt, per `handoff` offen an den Menschen zurückgibt — und das
Todo danach in der UI als „bei dir / aido hat geantwortet" mit formatierter Antwort erscheint,
während `next-todo` im selben Loop bereits das **nächste** Todo liefert (nie wieder dasselbe).

## 4. Lösungsidee

### 4.1 Agent-Sessions als eigenständige Objekte

Eine Session ist eine **„Agent-Session"** (bewusst anders benannt als die bestehenden
**Geräte-/Login-Sessions**, um Verwechslung zu vermeiden) und an **genau einen Space gebunden**.
Neue Collection `users/{uid}/sessions/{sessionId}` (owner-only lesbar, damit der Nutzer seine
Sessions im Attach-Picker sieht; vom MCP-Server via Admin-SDK geschrieben). Felder: `spaceId`,
`hostname`, `workingFolder`, `label?`, `allowedTools`, `leaseTtlSeconds`, `createdAt`, `lastSeenAt`.

- **Space-Bindung:** `register-session(spaceId, …)` registriert die Session für **einen** Space (der
  Aufrufer muss Mitglied sein, `requireMember`). Dadurch bleibt `next-todo` ein **reiner
  Per-Space-Query** — **kein** Collection-Group-Query, kein Cross-Space-Leak, Member-Gate =
  bestehendes `requireMember`.
- **Identität deterministisch:** `sessionId = hash(spaceId + hostname + workingFolder)`. So kann
  **jeder** spätere MCP-Aufruf seine Session **aus der Umgebung neu herleiten** (Claude Code kennt
  cwd + Hostname; den Space hält die Loop-Konfiguration) — der zustandslose Server muss sich nichts
  „merken", der Loop keine ID mitschleppen.
- `register-session` ist ein **Upsert**: legt an bzw. aktualisiert `lastSeenAt`. Jeder
  `next-todo`-Aufruf frischt `lastSeenAt` als Heartbeat. Stale Sessions kann die UI ausgrauen.

### 4.2 Anhängen in der Web-UI

Neues Todo-Feld **`attachedSession: sessionId | null`**. Ein Todo hängt an **genau einer** Session,
die **im selben Space** registriert ist (v1; per Identität ohnehin space-gebunden). UI: Aktion
**„An Agent-Session anhängen…"** in `TodoActions` und im Board-Karten-Menü (analog zum frischen
„Verschieben…" #201/#202), die die für **diesen Space** registrierten Sessions des Nutzers anbietet,
z.B. `MacBook · ~/Documents/GitHub/aido (aktiv vor 2 min)`. Beim Anhängen → Zustand **`bei aido`**.

### 4.3 Zustandsmaschine (Claim + Lease + „Ball im Feld")

Pro angehängtem Todo zwei Aspekte: **wessen Zug** (`aidoTurn: 'aido' | 'user'`) und der **Claim/
Lease** (`claimedBy: sessionId | null`, `claimedAt: Timestamp | null`).

```
        attach (UI)          next-todo (claim, Lease)        complete-todo
 offen ──────────────► [bei aido] ───────────────► [in Arbeit] ───────────► erledigt
                          ▲                            │
   User: „zurück an       │                            │ Claude: handoff
   aido" / Antwort        └───────────[bei dir]◄───────┘ (Antwort, offen lassen)
                                          ▲_________________│
                                          Lease abgelaufen → zurück zu [bei aido]
```

- **`next-todo`** wählt das **älteste (`createdAt` asc) offene** Todo mit
  `attachedSession == meineSession && aidoTurn == 'aido'`, dessen Claim frei oder dessen Lease
  abgelaufen ist, und **claimt es atomar** (Transaction): `claimedBy = sessionId`,
  `claimedAt = now`. Damit ist es **sofort aus der Warteschlange** — der nächste `next-todo`-Aufruf
  bekommt das *nächste* Todo, nie dasselbe doppelt.
- Claude beendet seinen Zug **genau zweifach**: **`complete-todo`** (erledigt) **oder** **`handoff`**
  → `aidoTurn = 'user'` (offen, Ball zurück beim Menschen). Beides löscht den Claim.
- Ein Todo kehrt nur über einen **menschlichen Zug** zu `bei aido` zurück (expliziter
  **„Zurück an aido"-Button** in der UI; kein Auto-on-edit in v1) — **oder** über **Lease-Ablauf**
  als **Crash-Absicherung**, falls Claude weder abschließt noch zurückgibt. Die **Lease-Dauer ist
  in den Einstellungen konfigurierbar** (je Session, mit nutzerweitem Default).

So ist „endlos dasselbe Todo" strukturell ausgeschlossen, und „Frage beantworten ohne zu
schließen" ist exakt der `handoff`-Pfad.

### 4.4 MCP-Server-Erweiterung

| Tool | Zweck |
|---|---|
| `register-session` (neu) | Upsert der **space-gebundenen** Session (`spaceId`, `hostname`, `workingFolder`, `label?`, `allowedTools?`) → `sessionId`; zuerst aufgerufen, bevor der Loop startet |
| `next-todo` (neu) | **Per-Space-Query**: claimt & liefert das älteste offene Todo der Session **inkl. Body** (Markdown **und** Tiptap-JSON) + `spaceId`/`todoId`; leer, wenn nichts ansteht |
| `update-todo` (neu) | schreibt `body` aus **Markdown** (→ Tiptap, inkl. Codeblock); Modi **`append`** (Default, „Antwort von aido"-Block) und `replace`; leitet `tags`/`mentions` neu ab; setzt `modifiedBy` + „von aido"-Marker; **kein** Auto-Handoff (Claude darf mehrfach editieren) |
| `handoff` (neu) | `aidoTurn = 'user'`, Claim lösen — Ball zurück an den Menschen (Todo bleibt offen) |
| `complete-todo` (vorhanden) | Abschluss |

`list-todos`/`list-spaces`/… bleiben wie sie sind. Schreib-Tools laufen weiter durch das
Rate-Limit (`enforceWriteRateLimit`).

### 4.5 Markdown ↔ Tiptap

Claude denkt in Markdown, der Body ist Tiptap-/ProseMirror-JSON. Konvertierung in **beide
Richtungen** (Tiptap→Markdown fürs Lesen in `next-todo`, Markdown→Tiptap fürs Schreiben in
`update-todo`), mindestens für **Codeblöcke**, Fett/Kursiv, Listen, Überschriften und Links
(abgesichert über `linkSecurity`). **Inline-Code wird auf einen Codeblock abgebildet** — die
Inline-`code`-Mark ist im Editor deaktiviert (`useTiptapConfig` `code:false`). `tags`/`mentions`
werden aus dem neuen Body wie gehabt abgeleitet.

### 4.6 „Von aido" sichtbar machen

Da aido unter der uid des Nutzers schreibt (`modifiedBy` = Nutzer-uid), erhält die angehängte
Antwort einen **Marker**, damit Mitglieder sie nicht für eine menschliche Eingabe halten — z.B. ein
eigener Body-Block „💬 Antwort von aido" beim `append` und/oder ein Feld `lastAidoEditAt`. Die UI
zeigt den Bearbeitungszustand als Badge (`bei aido` / `in Arbeit` / `bei dir`).

### 4.7 Ablauf im `/loop`

`register-session` (einmal beim Start) → dann je Tick: `next-todo` → Body lesen → bearbeiten/
antworten via `update-todo` → `complete-todo` **oder** `handoff` → nächster Tick. Liefert
`next-todo` nichts, idlet der Loop.

### 4.8 Eingrenzung der Wirkung (Least Privilege)

Die Wirkung einer automatisierten Session wird auf zwei serverseitig durchsetzbaren Ebenen
begrenzt — wichtig, weil ein gebundenes Todo von einem anderen Space-Mitglied stammen kann und im
Loop einen Agenten steuert (Prompt-Injection-Risiko):

1. **Scope auf das geclaimte Todo.** `update-todo`/`handoff`/`complete-todo` wirken **nur** auf das
   Todo, das die aufrufende Session aktuell hält (`claimedBy == meineSession`, Lease gültig); ein
   Aufruf gegen ein anderes Todo wird abgewiesen. Eine Session hält **höchstens einen** aktiven
   Claim (strikt seriell). Damit kann ein bösartiger Todo-Inhalt den Loop nicht dazu bringen,
   *andere* Todos zu verändern oder zu löschen — der Blast-Radius ist genau dieses eine Todo.
2. **Per-Session-Tool-Allowlist.** `register-session` deklariert (und die Settings-UI editiert) die
   Liste **erlaubter Aktionen** der Session, z.B. `['update-todo','handoff','complete-todo']`. Der
   Server erzwingt sie für die Session-Tools — eine Session lässt sich so auf „antworten &
   zurückgeben, aber nie schließen" oder „nur lesen" beschränken.

Die breiten CRUD-Tools (`add-todo`, `delete-todo`, `set-waiting-on`, …) sind **nicht** Teil der
Session-Arbeitsfläche; der Loop bekommt sie gar nicht erst an die Hand.

> **Ehrliche Grenze:** Die Allowlist bindet die **Session-Tools**, nicht den API-Key an sich — sie
> verhindert nicht, dass *derselbe Key* die globalen CRUD-Tools direkt aufruft. Die eigentliche
> Bedrohung ist aber die Injection *in den Loop*, und die ist durch (1)+(2) eingegrenzt. Welche
> Tools eine Session real erhält, bestimmt zusätzlich die Claude-Code-MCP-Konfiguration des Loops.

## 5. Betroffene Komponenten

| Bereich | Datei(en) | Art der Betroffenheit |
|---|---|---|
| Datenmodell Sessions | `src/lib/types.ts` | Neu: `Session`-Typ (inkl. `spaceId`, `allowedTools`, `leaseTtlSeconds`) |
| Datenmodell Todo | `src/lib/types.ts` (`Todo`) | Neu: `attachedSession`, `aidoTurn`, `claimedBy`, `claimedAt`, `lastAidoEditAt` |
| Sicherheitsregeln | `firestore.rules`, `tests/firestore-rules.test.mjs` | `users/{uid}/sessions` (owner-only); Validierung der neuen Todo-Felder; gemeinsam aktualisiert |
| MCP-Datenzugriff | `src/lib/mcp/data.ts` | `registerSession`, `nextTodo` (**Per-Space-Query** + atomarer Claim/Lease per Transaction), `updateTodo`, `handoffTodo`; `TodoView` um Body/Status erweitern |
| MCP-Tools/Dispatch | `src/lib/mcp/tool-logic.ts`, Schemas (Zod), `src/app/api/mcp/sse/route.ts` | Neue Tools registrieren + Rate-Limit |
| Tiptap-Konvertierung | neu unter `src/lib/tiptap/` (`markdown.ts`), `src/lib/tiptap/linkSecurity.ts` | Markdown↔Tiptap inkl. Codeblock; Link-Härtung |
| Rich-Text-Render | `src/lib/hooks/useTiptapConfig.ts`, `src/components/shell/list/TodoBody` | Codeblock-Rendering sicherstellen |
| Web-UI Agent-Sessions | neue Komponente (Settings-Panel, klar von Geräte-`SessionSettings` getrennt) | Agent-Sessions auflisten, umbenennen (`label`), entfernen, **erlaubte Tools** & **Lease-TTL** je Session einstellen |
| Web-UI Attach/Status | `src/components/shell/list/TodoActions`, Board-Karten-Menü | „An Agent-Session anhängen…", „Zurück an aido", Badge, ggf. Filter |
| Workspace-State | `src/lib/contexts/TodosContext.tsx` (ggf. `SpacesContext`) | `attachedSession`/Status-CRUD, Filter |
| Indizes | `firestore.indexes.json` (neu, minimal) | Per-Space-Query auf `todos`; ggf. **einfacher** Composite-Index (`attachedSession`,`completed`) — **kein** Collection-Group-Index (Space-Bindung) |
| MCP-Tool-Tests | `tests/mcp-tools.test.mts` | Neue Tools, Claim/Lease, gegen Firestore-Emulator |
| Doku | `CLAUDE.md`, `README`, `.env.example` | Setup, Tool-Liste, `/loop`-Nutzung |

## 6. Abgrenzung

Nicht Teil dieser Anforderung:

- **Der Push-/Channels-Weg** ([Konzept 01](01-konzept-claude-code-channels.md)) — getrennt.
- **Eine separate Firestore-/Auth-Identität „aido".** Sessions handeln unter der uid des
  Personal-API-Key-Eigentümers; kein Bot-User.
- **Mehrere Sessions pro Todo / Menschen-Zuweisung.** v1: ein Todo ↔ eine Session; keine
  Human-Assignees.
- **Autonome Aktionen außerhalb des gebundenen Todos.** Scope: das per `next-todo` erhaltene Todo
  lesen, Body ergänzen/beantworten, zurückgeben oder abschließen. Kein Handeln „in der Welt".
- **Bau des `/loop` selbst** — Claude-Code-Nutzungsmuster; wir liefern nur die MCP-Tools.
- **Migration von Bestandsdaten.** Alle neuen Felder sind optional/`null`; kein Backfill.

## 7. Offene Fragen

**Bereits entschieden:**
- **Rückgabe an aido:** nur expliziter **„Zurück an aido"-Button** in der UI (kein Auto-on-edit in v1).
- **Lease-TTL:** in den Einstellungen konfigurierbar (je Session, mit nutzerweitem Default) statt fest verdrahtet.
- **Wirkungs-Eingrenzung:** Scope auf das geclaimte Todo **+** Per-Session-Tool-Allowlist via `register-session` (siehe 4.8).
- **Default-Allowlist:** eine frisch registrierte Session darf `['update-todo','handoff']` — also
  antworten & zurückgeben, **nicht** selbst abschließen; `complete-todo` wird pro Session in den
  Settings freigeschaltet.
- **Space-Bindung:** `register-session` ist auf **einen Space** beschränkt → `next-todo` ist ein
  Per-Space-Query (kein Collection-Group, kein Cross-Space-Leak, kein Spezial-Index).
- **Benennung:** „**Agent-Sessions**" (klar getrennt von Geräte-/Login-Sessions).
- **Inline-Code:** wird in `update-todo` auf einen **Codeblock** abgebildet (Inline-`code`-Mark ist deaktiviert).
- **Session-Speicherort:** `users/{uid}/sessions/{sessionId}` (owner-only) mit `spaceId`-Feld.

**Noch offen:**
4. **Sichtbarkeit für andere Space-Mitglieder:** ein angehängtes Todo liegt ggf. in einem geteilten
   Space. Mitglied B kann A's Session-Doc nicht lesen — brauchen wir ein **denormalisiertes Label**
   (Host/Ordner) am Todo für die Anzeige, oder reicht „an eine Session gebunden"? *Empfehlung:
   schlankes Label denormalisieren.*
5. **Darf Claude die Bindung selbst ändern?** *Empfehlung: nein* — Anhängen/Lösen nur via UI; die
   Session darf nur `update-todo`/`handoff`/`complete-todo`, nicht `attachedSession` setzen.
7. **Vertrauen/Prompt-Injection (Rest):** Die technische Eingrenzung steht (4.8). Offen bleibt die
   *Erwartungshaltung*: Soll eine aido-Antwort grundsätzlich als „bitte prüfen" markiert sein, bevor
   sie als erledigt gilt — und kennzeichnen wir die Herkunft eines gebundenen Todos (wer hat es
   erstellt), damit der Loop fremdem Inhalt nicht blind folgt?
8. **Session-Lifecycle:** Wann gilt eine Session als „weg" (TTL auf `lastSeenAt`)? Werden Todos
   einer entfernten Session automatisch auf `bei dir` zurückgesetzt?
