# Anforderungsanalyse: Firestore-gebundene MCP-Tools

## 1. Funktionale Anforderungen

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-01 | Auth liefert uid | **Muss** | `authenticateMcp(req)` gibt bei persönlichem Key die uid zurück (Doc-ID aus `userApiKeys`); bei Shared-Token einen uid-losen Kontext; sonst Error. |
| FA-02 | Datentools erfordern uid | **Muss** | Tools mit Datenzugriff lehnen Aufrufe ohne uid (z. B. Shared-Token) mit klarer Fehlermeldung ab. |
| FA-03 | Membership-Enforcement | **Muss** | Vor jedem Lese-/Schreibzugriff auf einen Space wird geprüft, dass die uid in `spaces/{id}.members` ist; sonst „nicht gefunden/keine Berechtigung". |
| FA-04 | `list-spaces` | **Muss** | Listet die Spaces der uid: `id`, `name`, `color`, Mitgliederzahl, offene Todos (Count). |
| FA-05 | `list-todos` (pro Space) | **Muss** | Parameter `spaceId`, optional `includeCompleted`, optional `tag`. Liefert Todos (`id`, `title`, `completed`, `waitingOn`, `tags`, `order`). Body als Plaintext-Auszug optional. |
| FA-06 | `add-todo` | **Muss** | Parameter `spaceId`, `title`, optional `bodyText`, optional `waitingOn`. Setzt `createdBy=uid`, `order=max+1`, leitet `tags`/`mentions` ab. `waitingOn` muss Mitglied sein. |
| FA-07 | `complete-todo` | **Soll** | Parameter `spaceId`, `todoId`, `completed`. Setzt `completed` (analog `setTodoStatus`, ohne `waitingOn` zu verwaisen). |
| FA-08 | `set-waiting-on` | **Soll** | Parameter `spaceId`, `todoId`, `userId`\|null. `userId` muss Mitglied sein. |
| FA-09 | `list-daily` | **Soll** | Parameter `spaceId`, optional `date` (Default heute). Liefert Heute-Items (`id`, `text`, `completed`, `date`). |
| FA-10 | `add-daily` | **Soll** | Parameter `spaceId`, `text`. Setzt `author=uid`, `date=heute` (`YYYY-MM-DD`), `completed=false`. |
| FA-11 | MCP-konformes Antwortformat | **Soll** | Tool-Ergebnisse als `content`-Blöcke (`{ content: [{ type:"text", text }] }`), zusätzlich strukturierte Daten wo sinnvoll. |
| FA-12 | `tools/list` aktualisiert | **Muss** | Meldet das neue Tool-Set mit korrekten `inputSchema` (inkl. `required`). |
| FA-13 | `delete-todo` | **Kann** | Parameter `spaceId`, `todoId`. Mitglied darf löschen. |
| FA-14 | `whoami` / `list-members` | **Kann** | uid/Anzeigename des Keys bzw. Mitglieder eines Space (via `publicProfiles`). |

## 2. Nicht-funktionale Anforderungen

| ID | Anforderung | Kategorie | Beschreibung |
|---|---|---|---|
| NFA-01 | Mandantentrennung | Sicherheit | Kein Tool darf Daten außerhalb der Spaces der uid lesen/schreiben (Admin-SDK umgeht Rules → Code-seitige Prüfung zwingend). |
| NFA-02 | Rules-Parität | Sicherheit/Integrität | Schreibtools spiegeln `firestore.rules`: `createdBy`/`author`=uid & immutable, `waitingOn`∈members, Feldtypen, Daily-`date`-Regex. |
| NFA-03 | Kein Datenleck im Log | Sicherheit | Keine Tokens/Keys/PII in Logs (bestehende Praxis fortführen). |
| NFA-04 | Rate-Limiting | Sicherheit/Stabilität | Schreibtools pro uid leichtgewichtig begrenzt (analog `rateLimit` in `apiKeys.ts`). |
| NFA-05 | Stateless-Korrektheit | Zuverlässigkeit | Datentools liefern korrekte Ergebnisse unabhängig von der nicht-durablen Session-Map (kein Cross-Request-State nötig). |
| NFA-06 | Graceful Degradation | Robustheit | Ohne `FIREBASE_SERVICE_ACCOUNT_KEY`: klare 503/Tool-Fehlermeldung statt Crash. |
| NFA-07 | Performance | Performance | `list-spaces`/Counts mit serverseitigen Count-Queries; keine N+1-Vollscans. |

## 3. Akzeptanzkriterien

- [ ] Ein per **persönlichem Key** verbundener Client kann `list-spaces` aufrufen und erhält genau seine Spaces.
- [ ] `list-todos`/`add-todo`/`complete-todo` wirken auf **echte** `spaces/{id}/todos` und sind in der Web-UI sichtbar (und umgekehrt).
- [ ] Ein Aufruf mit `spaceId`, in dem die uid **kein** Mitglied ist, liefert einen Berechtigungsfehler und **keine** Daten.
- [ ] `add-todo` mit `waitingOn` = Nicht-Mitglied wird abgelehnt; mit Mitglied akzeptiert.
- [ ] `add-daily` erzeugt ein Item mit korrektem `date` (`YYYY-MM-DD`) und `author=uid`.
- [ ] Datentools mit **Shared-Token** (ohne uid) werden mit klarer Meldung abgelehnt.
- [ ] Angelegte Todos tragen `createdBy=uid`, valides `order`, abgeleitete `tags`/`mentions`.
- [ ] Ohne `FIREBASE_SERVICE_ACCOUNT_KEY` antworten Datentools mit einem klaren Konfigurationsfehler (kein Crash).
- [ ] `tools/list` listet das neue Tool-Set mit korrekten Schemas.

## 4. Abhängigkeiten zu anderen Anforderungen

- Baut auf den persönlichen API-Keys (Issue #21) und dem Spaces-Datenmodell (Issues #40/#41) auf.
- FA-04…FA-14 hängen alle an **FA-01/FA-03** (uid + Membership) — diese zuerst.
- Keine Abhängigkeit zur Token-Migration (#107) oder zu offenen Issues.

## 5. Priorisierung

1. **Fundament (Muss):** FA-01, FA-02, FA-03, FA-12 — uid-Auth + Membership + Tool-Registrierung.
2. **Lese-Kern (Muss):** FA-04, FA-05.
3. **Schreib-Kern (Muss/Soll):** FA-06, dann FA-07, FA-08.
4. **Daily (Soll):** FA-09, FA-10.
5. **Komfort/Format (Soll/Kann):** FA-11, FA-13, FA-14.
