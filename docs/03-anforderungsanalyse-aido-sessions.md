# Anforderungsanalyse: Todos an eine Agent-Session binden und abarbeiten lassen

Bezug: [Konzept](01-konzept-aido-sessions.md), [Ist-Analyse](02-ist-analyse-aido-sessions.md).
Priorität: **Muss** = MVP, **Soll** = wichtig, aber nachgelagert, **Kann** = optional.

## 1. Funktionale Anforderungen

### Agent-Sessions (Registrierung & Verwaltung)

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-01 | Session registrieren | Muss | MCP-Tool `register-session(spaceId, hostname, workingFolder, label?, allowedTools?)`. Member-gegated (`requireMember`); **Upsert** mit deterministischer `sessionId = hash(spaceId+host+cwd)`; legt/aktualisiert `users/{uid}/sessions/{sessionId}` und setzt `lastSeenAt`. Gibt `sessionId` zurück. |
| FA-02 | Sessions speichern | Muss | Collection `users/{uid}/sessions/{sessionId}` (**owner-only**) mit `spaceId, hostname, workingFolder, label?, allowedTools, leaseTtlSeconds, createdAt, lastSeenAt`. Vom Owner (Client-SDK) lesbar für die UI. |
| FA-03 | Sessions verwalten (UI) | Soll | Settings-Panel **„Agent-Sessions"** (klar getrennt von Geräte-`SessionSettings`): auflisten (mit „zuletzt aktiv"), umbenennen (`label`), entfernen; `allowedTools` und `leaseTtlSeconds` je Session setzen. |
| FA-04 | Heartbeat / Aktivität | Soll | Jeder `next-todo`-Aufruf frischt `lastSeenAt`; die UI zeigt aktive vs. stale Sessions. |

### Bindung (Attach)

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-05 | Todo an Session anhängen (Liste) | Muss | Aktion „An Agent-Session anhängen…" in `TodoActions`; bietet nur die für **diesen Space** registrierten Sessions an; setzt `attachedSession` und `aidoTurn='aido'`. |
| FA-06 | Anhängen im Board | Soll | Gleiche Aktion im Board-Karten-Menü (`TodoCard`/`BoardView`, Muster #202). |
| FA-07 | Bindung lösen | Muss | „Lösen" entfernt `attachedSession` (Status zurück auf normal); nur via UI. |
| FA-08 | „Zurück an aido" | Muss | Bei `aidoTurn='user'` setzt ein expliziter Button `aidoTurn='aido'` (kein Auto-on-edit in v1). |
| FA-09 | Statusanzeige | Soll | Badge je Todo: `bei aido` / `in Arbeit` / `bei dir`, in Liste und Board. |

### Abholen & Bearbeiten (Loop)

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-10 | Nächstes Todo holen (Claim) | Muss | `next-todo` (Identität aus host+cwd+space): **Per-Space-Query** nach dem **ältesten (`createdAt` asc) offenen** Todo mit `attachedSession==self && aidoTurn=='aido'` und freiem/abgelaufenem Claim; **atomarer Claim** (Transaction): `claimedBy=sessionId, claimedAt=now`. Liefert `spaceId`, `todoId`, `title`, **Body als Markdown + Tiptap-JSON**, sonst „leer". |
| FA-11 | Ein Claim je Session | Muss | Eine Session hält höchstens einen aktiven Claim; hält sie bereits einen, liefert `next-todo` idempotent dieses Todo (strikt seriell). |
| FA-12 | Lease / Crash-Recovery | Muss | Ein Claim, dessen `claimedAt` älter als `leaseTtlSeconds` ist, gilt als frei und ist neu claimbar. |
| FA-13 | Body bearbeiten | Muss | `update-todo(bodyMarkdown, mode?)`: **Markdown→Tiptap** (inkl. Codeblock; **Inline-Code → Codeblock**); Modi **`append`** (Default, „💬 Antwort von aido"-Block) und `replace`; leitet `tags`/`mentions` neu ab; setzt `modifiedBy`; **kein** Auto-Handoff. |
| FA-14 | Zurückgeben (handoff) | Muss | `handoff`: `aidoTurn='user'`, Claim lösen — Todo bleibt **offen** („Frage beantwortet, ohne zu schließen"). |
| FA-15 | Abschließen | Muss | `complete-todo` (vorhanden) schließt das geclaimte Todo; **nur** wenn per Allowlist erlaubt. |
| FA-16 | „Von aido"-Kennzeichnung | Soll | Angehängte Antworten tragen einen sichtbaren Marker (Body-Block und/oder `lastAidoEditAt`), damit Mitglieder die Herkunft erkennen (da `modifiedBy` = Nutzer-uid). |

### Sicherheit / Wirkungs-Eingrenzung

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-17 | Scope auf das geclaimte Todo | Muss | `update-todo`/`handoff`/`complete-todo` wirken **nur** auf das Todo mit `claimedBy==self` (gültiger Lease); jeder andere Ziel-Todo wird abgewiesen. |
| FA-18 | Per-Session-Allowlist | Muss | `allowedTools` wird **serverseitig** für die Session-Tools erzwungen; Default einer neuen Session: `['update-todo','handoff']` (ohne `complete-todo`). |
| FA-19 | Bindung nicht durch Claude änderbar | Soll | Die Session kann `attachedSession` **nicht** selbst setzen/lösen (nur UI); sie darf nur `update-todo`/`handoff`/`complete-todo` im erlaubten Rahmen. |

### Konvertierung & Datenmodell

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-20 | Markdown↔Tiptap (serverfähig) | Muss | Eigenständige, vom React-Editor unabhängige Funktion (`src/lib/tiptap/markdown.ts`): Tiptap→Markdown (Lesen) und Markdown→Tiptap (Schreiben), erzeugt **ausschließlich** die in `useTiptapConfig` erlaubten Node-/Mark-Typen; Links über `linkSecurity`. |
| FA-21 | Neue Felder + Regeln | Muss | `Todo` um `attachedSession, aidoTurn, claimedBy, claimedAt, lastAidoEditAt` (optional/`null`) erweitern; `firestore.rules` validiert sie (Typ/Wert) **und** `users/{uid}/sessions`; Regeln + Tests im selben Schritt. |
| FA-22 | Lease-TTL-Default in Settings | Soll | `leaseTtlSeconds` je Session, mit nutzerweitem Default (in `users/{uid}`-Settings, regelseitig ohne Schema-Zwang). |

## 2. Nicht-funktionale Anforderungen

| ID | Anforderung | Kategorie | Beschreibung |
|---|---|---|---|
| NFA-01 | Regel-/Code-Parität | Sicherheit | Admin-SDK umgeht `firestore.rules`; `data.ts` erzwingt dieselben Constraints (Member, `modifiedBy`, Feld-Shapes). Neue Felder in **beiden** validiert (Muster #71/#198). |
| NFA-02 | XSS-Sicherheit | Sicherheit | Body nur über `<EditorContent>` rendern (nie `dangerouslySetInnerHTML`/`generateHTML`); der Konverter erzeugt nur erlaubte Nodes; Links gehärtet. |
| NFA-03 | Konsistenz Claim/Lease | Zuverlässigkeit | Claim ausschließlich **transaktional**; keine Doppel-Claims, kein Überschreiben eines noch gültigen Claims. |
| NFA-04 | Performance | Performance | `next-todo` ist Per-Space-Query (kein Collection-Group); höchstens **ein** einfacher Composite-Index; Lease-TTL-Read günstig (ein Settings-/Session-Read). |
| NFA-05 | Zustandslosigkeit | Architektur | Keine serverseitige Session-Speicherung über Requests; Identität pro Request aus host+cwd+space herleitbar; Crash-Recovery via Lease. |
| NFA-06 | Rate-Limit-Verträglichkeit | Performance | `next-todo`-Claim ist ein Write → Loop-Takt muss das 30/min-Limit respektieren; ggf. Claim separat takten/zählen. |
| NFA-07 | Abwärtskompatibilität | Wartbarkeit | Neue Felder optional/`null`; **keine** Migration/Backfill; bestehende Tools (`list-todos` etc.) unverändert nutzbar. |
| NFA-08 | Verständlichkeit (UX) | Usability | „Agent-Sessions" überall klar von Geräte-/Login-Sessions abgegrenzt. |
| NFA-09 | Testabdeckung | Qualität | Rules-Tests (`firestore-rules.test.mjs`) und MCP-Tool-Tests (`mcp-tools.test.mts`) decken neue Felder, Claim/Lease, Allowlist und Konvertierung ab. |

## 3. Akzeptanzkriterien

- [ ] `register-session(spaceId, host, cwd)` legt eine owner-only Session an; erneuter Aufruf mit
      gleichem host+cwd+space liefert **dieselbe** `sessionId` und aktualisiert `lastSeenAt`.
- [ ] `register-session` für einen Space, in dem der Nutzer **kein** Mitglied ist, wird abgewiesen.
- [ ] In der Liste lässt sich ein Todo einer Session **desselben Space** anhängen; danach Status
      `bei aido`. Sessions **anderer** Spaces erscheinen nicht im Picker.
- [ ] `next-todo` liefert das **älteste offene** angehängte Todo der Session inkl. Body als Markdown
      **und** Tiptap-JSON und claimt es; ein direkt folgender `next-todo` liefert das **nächste**
      Todo (nie dasselbe), bis keines mit `aidoTurn=='aido'` mehr offen ist → „leer".
- [ ] Zwei (theoretisch) gleichzeitige `next-todo` claimen **nicht** dasselbe Todo (Transaction).
- [ ] `update-todo` mit Markdown inkl. ```` ```code``` ```` schreibt einen **Codeblock**; Inline-Code
      landet ebenfalls als Codeblock; der Body rendert in der Web-UI korrekt und XSS-sicher.
- [ ] `update-todo` im Default-Modus **hängt an** (Original/Frage bleibt erhalten, „von aido"-Marker
      sichtbar); `replace` ersetzt.
- [ ] `update-todo`/`handoff`/`complete-todo` gegen ein **nicht** von der Session geclaimtes Todo
      werden abgewiesen.
- [ ] `handoff` setzt `aidoTurn='user'`, lässt das Todo **offen**; es verschwindet aus `next-todo`,
      bis der Nutzer „Zurück an aido" klickt.
- [ ] Ein Claim, älter als `leaseTtlSeconds`, ist erneut claimbar.
- [ ] Eine Session mit Default-Allowlist kann `complete-todo` **nicht** ausführen, bis es in den
      Settings freigeschaltet ist.
- [ ] Neue Todo-Felder sind in `firestore.rules` typ-/wert-validiert; Rules- und MCP-Tool-Tests
      grün im Emulator.
- [ ] Bestehende Tools/Flows (Liste, Board, `list-todos`, `add-todo`) funktionieren unverändert.

## 4. Abhängigkeiten zu anderen Anforderungen

- **MCP-Server (Epic #124)** — diese Anforderung erweitert dessen Tool-Set und Datenzugriff.
- **Komplementär:** [Channels-Push-Weg](01-konzept-claude-code-channels.md) — eigenständig, kein
  Blocker.
- **UI-Muster:** „Verschieben…" (#201/#202) als Vorlage für Attach in Liste & Board.
- **Regel-Muster:** `modifiedBy`-Keying (#198/#199), Move-Preserve-`createdBy` (#200), Feld-Shapes
  (#71) — werden für die neuen Felder fortgeschrieben.
- **Tiptap-Härtung:** `linkSecurity` (#17) wird vom Markdown-Konverter wiederverwendet.

## 5. Priorisierung

**MVP (Muss) — der durchgehende Loop-Pfad:**
FA-01, FA-02, FA-05, FA-07, FA-08, FA-10, FA-11, FA-12, FA-13, FA-14, FA-15, FA-17, FA-18, FA-20,
FA-21. Damit ist „registrieren → anhängen → `next-todo` → antworten (Markdown/Codeblock) →
handoff/complete" Ende-zu-Ende möglich, sicher eingegrenzt und regelkonform.

**Soll — Komfort & Sichtbarkeit:**
FA-03 (Sessions-Panel), FA-04 (Heartbeat-Anzeige), FA-06 (Board-Attach), FA-09 (Status-Badges),
FA-16 („von aido"-Marker), FA-19 (Bindung nicht durch Claude änderbar), FA-22 (Lease-TTL-Setting).

**Kann — später:**
Denormalisiertes Session-Label am Todo für Fremd-Mitglieder (Offene Frage #4), automatische
Rücksetzung von Todos einer entfernten Session (#8), Auto-„zurück an aido" bei Body-Änderung.

## 6. Referenzen

- [Konzept](01-konzept-aido-sessions.md)
- [Ist-Analyse](02-ist-analyse-aido-sessions.md)
