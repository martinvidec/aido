# Anforderungsanalyse: Chat-Thread pro Todo

## 1. Funktionale Anforderungen

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-01 | Thread-Datenmodell | Muss | Subcollection `spaces/{spaceId}/todos/{todoId}/messages/{id}` mit Feldern `body` (Tiptap-JSON), `text`, `tags[]`, `mentions[]`, `author` (uid, immutable), `source` (`'user'\|'aido'`), `sessionId` (nullable), `createdAt`. |
| FA-02 | Firestore-Rules | Muss | Neuer `messages`-Block in `match /spaces/{spaceId}`: Lesen/Schreiben nur für Space-Mitglieder; `author` unveränderlich; Feld-Shapes validiert (merge-sicher). Rules-Tests zusammen mit der Rule. |
| FA-03 | Thread-Composer (Editor) | Muss | Rich-Text-Composer mit denselben Fähigkeiten wie der Todo-Editor: Formatierung, Listen/Task-Listen, Codeblöcke, sichere Links, `#`-Tags, `@`-Mentions. Kein Titelfeld. |
| FA-04 | Mentions aus Space-Mitgliedern | Muss | `@`-Vorschläge im Thread stammen aus den **Mitgliedern des aktiven Space** (`mentionMembers`), nicht aus Kontakten. Todo-Editor-Verhalten bleibt unverändert. |
| FA-05 | Nachrichten-Renderer | Muss | Read-only Darstellung jeder Nachricht über den XSS-sicheren ProseMirror-Pfad; chronologisch sortiert; mit Absender (Anzeigename/Avatar) und Zeitstempel; aido-Nachrichten erkennbar markiert (`source='aido'`). |
| FA-06 | Live-Aktualisierung | Muss | Thread aktualisiert sich in Echtzeit (`onSnapshot`) für den geöffneten Todo; Abo wird beim Schließen/Verlassen wieder gelöst. |
| FA-07 | Eigene Nachricht löschen | Muss | Verfasser kann eigene Nachrichten löschen (analog `daily`). Bearbeiten ist **nicht** Teil des MVP. |
| FA-08 | MCP-Tool: Thread-Post | Muss | Neues session-gebundenes MCP-Tool, mit dem eine aido-Session eine Nachricht (Markdown→Tiptap) in den Thread des **geclaimten** Todos schreibt. Abgesichert über `requireSession` → `assertToolAllowed` → `requireClaim`; `enforceWriteRateLimit`. `source='aido'`, `sessionId` gesetzt. |
| FA-09 | MCP: Thread lesen | Muss | aido erhält beim Aufnehmen den Thread-Verlauf als Markdown — entweder als Erweiterung von `next-todo` oder als eigenes Lese-Tool (`list-messages`/`read-thread`). |
| FA-10 | Session-Modell erweitern | Muss | Neues Tool in `AgentToolName`, `ALL_AGENT_TOOLS` und das `allowedTools`-Enum von `register-session` aufnehmen; Default-Allowlist entsprechend anpassen. |
| FA-11 | Body bleibt Ergebnis | Soll | `update-todo` / Tool-Beschreibungen so anpassen, dass aido **Konversation in den Thread** und nur das **Ergebnis in den Body** schreibt. `appendAnswer`-Nutzung entsprechend zurückfahren. |
| FA-12 | UI-Einhängung Liste | Muss | Thread-Panel erscheint in der aufgeklappten Todo-Zeile der **Listen**-Ansicht (`TodoRow`). |
| FA-13 | Ungelesen/Benachrichtigung | Kann | Ungelesen-Indikator / Mention-Benachrichtigung — **nicht** MVP; als spätere Ausbaustufe vorgemerkt. |
| FA-14 | Board-Detailansicht | Kann | Thread zusätzlich in der Board-Detailansicht — **nicht** MVP. |

## 2. Nicht-funktionale Anforderungen

| ID | Anforderung | Kategorie | Beschreibung |
|---|---|---|---|
| NFA-01 | Zugriffskontrolle | Sicherheit | Nur Space-Mitglieder lesen/schreiben (Rules); aido-Schreibzugriff nur auf den geclaimten Todo (`requireClaim`) und nur bei erlaubtem Tool (Allowlist). |
| NFA-02 | XSS-Sicherheit | Sicherheit | Rendern ausschließlich über `<EditorContent>`/ProseMirror; niemals `dangerouslySetInnerHTML`/`generateHTML`. Link-Härtung (`isSafeLinkUrl`, nur http/https/mailto). |
| NFA-03 | Autor-Integrität | Sicherheit | `author` unveränderlich (Rules); `source`/`sessionId` serverseitig gesetzt, nicht clientseitig fälschbar über den aido-Pfad. |
| NFA-04 | Performance/Skalierung | Performance | Nur der geöffnete Todo abonniert seinen Thread; keine Space-weiten Thread-Listener. `orderBy('createdAt')`. |
| NFA-05 | Missbrauchsschutz | Robustheit | aido-Schreibzugriffe durch `enforceWriteRateLimit` (30/min/uid) gedeckelt. |
| NFA-06 | Wartbarkeit / DRY | Qualität | Editor-Fähigkeiten über `useTiptapConfig` geteilt; keine Duplizierung der Tiptap-Konfiguration; Markdown-Konvertierung über bestehendes `markdown.ts`. |
| NFA-07 | Deploy-Sicherheit | Betrieb | Additive Subcollection; Rules nach Client deployen; keine neue Laufzeit-Abhängigkeit. |

## 3. Akzeptanzkriterien

- [ ] Ein Space-Mitglied kann in der aufgeklappten Todo-Zeile eine Thread-Nachricht mit Formatierung, `#`-Tag und `@`-Mention (aus Space-Mitgliedern) verfassen und absenden.
- [ ] Die Nachricht erscheint bei allen Mitgliedern live, chronologisch, mit Absender und Zeit; XSS-sicher gerendert.
- [ ] Ein Nicht-Mitglied kann den Thread weder lesen noch beschreiben (Rules-Test grün).
- [ ] Der `author` einer Nachricht kann nicht nachträglich verändert werden (Rules-Test grün).
- [ ] Ein Verfasser kann seine eigene Nachricht löschen; fremde nicht.
- [ ] Eine aido-Session kann via MCP-Tool eine Nachricht in den Thread des **geclaimten** Todos posten (`source='aido'`); ein Versuch auf einen nicht-geclaimten Todo schlägt fehl (`requireClaim`).
- [ ] aido erhält beim Aufnehmen den bisherigen Thread-Verlauf als Markdown.
- [ ] Der Todo-Body wächst durch Rückfragen/Antworten nicht mehr an; neue Konversation landet ausschließlich im Thread.
- [ ] `npm run test:rules` und `npm run test:mcp` decken die neuen Pfade ab und sind grün.

## 4. Abhängigkeiten zu anderen Anforderungen

- Baut auf **Agent-Sessions (Epic #212)** auf: `register-session`, `next-todo`, `update-todo`, `handoff`, Claim/Lease-Modell.
- Wechselwirkung mit **Issue #245** (Polling-Loop → aido-Claude-Plugin): Wenn aido künftig in den Thread statt in den Body schreibt, müssen die Skill-/Tool-Beschreibungen des Plugins den neuen Flow abbilden.
- Nutzt bestehende Bausteine: `useTiptapConfig`, `TodoEditor`/`TodoBody`, `markdown.ts`, `DailyContext`-Muster, MCP-Registrierungsmuster.

## 5. Priorisierung

**MVP (Muss):** FA-01–FA-10, FA-12 sowie alle NFA. Das liefert den kompletten Thread inkl. Mensch↔aido-Schleife in der Listenansicht.

**Soll (früh danach):** FA-11 (aido-Body-Semantik sauber ziehen; teils schon im MCP-MVP nötig, damit der Nutzen greift).

**Kann (später):** FA-13 (Ungelesen/Benachrichtigungen), FA-14 (Board-Detailansicht).
