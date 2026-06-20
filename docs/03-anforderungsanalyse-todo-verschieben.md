# Anforderungsanalyse: Todos in einen anderen Space verschieben

## 1. Funktionale Anforderungen

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-01 | Aktion „Verschieben →" | Muss | Im Todo-Aktionsmenü (`TodoActions`, Desktop-Popover **und** Mobile-BottomSheet) erscheint ein Eintrag „Verschieben →", der ein Submenü mit allen **anderen** Spaces des Nutzers öffnet. |
| FA-02 | Atomares Verschieben | Muss | Auswahl eines Ziel-Spaces legt das Todo via **`writeBatch`** im Ziel an (`spaces/{ziel}/todos/{neueId}`) und löscht es in der Quelle — in einer atomaren Operation. Übernommen werden: `title`, `body`, `completed`, `tags`, `mentions`, `createdBy`, `createdAt`. `spaceId` = Ziel. |
| FA-03 | `order` im Ziel | Muss | `order` im Ziel = `maxOrder(Ziel) + 1` (ans Ende). `maxOrder` wird per `query(todosCol(ziel), orderBy("order","desc"), limit(1))` ermittelt (1 Lesevorgang). |
| FA-04 | Feld `modifiedBy` | Muss | Neues Todo-Feld `modifiedBy: string` = der zuletzt schreibende Nutzer. `createTodo`: `modifiedBy = createdBy = uid`. Jeder Update/Move: `modifiedBy = request.auth.uid`. Wird zum `Todo`-Typ, `mapTodo` und **allen** Schreibpfaden ergänzt. |
| FA-05 | Regel-Anpassung (`firestore.rules`) | Muss | Todos `create`: `modifiedBy == request.auth.uid` **und** `createdBy in thisSpaceMembers()` (statt `createdBy == auth.uid`). Todos `update`: zusätzlich `modifiedBy == request.auth.uid`; `createdBy` bleibt unveränderlich. |
| FA-06 | Ersteller muss Ziel-Zugriff haben | Muss | Ein Todo darf nur in einen Space verschoben werden, in dem sein **Ersteller** (`createdBy`) Mitglied ist. Client prüft `targetSpace.members.includes(todo.createdBy)` vorab; ist es nicht erfüllt → **Rückmeldung** (Toast/Hinweis), kein Move. Hart abgesichert durch FA-05 (`createdBy in thisSpaceMembers()`). |
| FA-07 | `waitingOn`-Behandlung | Muss | Zeigt `waitingOn` auf einen Nicht-Mitglied des Ziels, wird vor dem Verschieben **inline gewarnt/bestätigt** („‚Wartet auf X' geht verloren — trotzdem verschieben?"). Bei Bestätigung wird `waitingOn = null` gesetzt; sonst Abbruch. (Kein `window.confirm`.) |
| FA-08 | Aktion bei nur einem Space ausblenden | Soll | Existiert kein anderer Space als Ziel, wird „Verschieben →" nicht angezeigt. |
| FA-09 | Bestätigungs-Toast | Soll | Nach erfolgreichem Verschieben: `showToast("In ‚<Space>' verschoben.")`. |
| FA-10 | Undo | Kann | Der Toast bietet optional „Rückgängig" (verschiebt zurück in den Quell-Space). |
| FA-11 | Verbleib im aktiven Space | Muss | Nach dem Verschieben bleibt der aktive Space unverändert; das Todo verschwindet aus der Quell-Liste (Live-Subscription). |

## 2. Nicht-funktionale Anforderungen

| ID | Anforderung | Kategorie | Beschreibung |
|---|---|---|---|
| NFA-01 | Berechtigung & Fälschungssicherheit | Sicherheit | Move regelseitig nur für Mitglieder von Quelle (delete) **und** Ziel (create). `modifiedBy == auth.uid` verhindert das Fälschen des Schreibenden; `createdBy in Ziel-Mitglieder` hält die Invariante „`createdBy` ist Mitglied seines Spaces" und verhindert Fremdzuweisung an Nicht-Mitglieder. |
| NFA-02 | Atomarität / Konsistenz | Zuverlässigkeit | `writeBatch` garantiert: nie Duplikate, nie verlorene Todos, auch bei Abbruch. |
| NFA-03 | Performance | Performance | Höchstens **1** zusätzlicher Lesevorgang (`maxOrder` im Ziel) pro Move; keine Vollladung des Ziel-Spaces. |
| NFA-04 | Abwärtskompatibilität | Wartbarkeit | Bestehende Todos ohne `modifiedBy` bleiben editierbar — der erste Update setzt das Feld (Regel prüft den Post-Write-Zustand). Keine zwingende Datenmigration; `migrateLegacyTodos`/`createTodo` setzen `modifiedBy` für neue Schreibvorgänge mit. |
| NFA-05 | Plattform-Parität & Scope | UX | Aktion auf Desktop und Mobile gleichwertig (gemeinsame `TodoActions`-Komponente). **Board** ist NICHT Teil dieses Features (optionales Folge-Issue). |
| NFA-06 | Sprache & Tokens | UX/Konsistenz | Texte deutsch; Styling über bestehende Tokens/Muster (Popover `bg-bg-pop`/`border-border`, `BottomSheet`), keine neuen Design-Primitive außer der inline-Bestätigung. |

## 3. Akzeptanzkriterien

- [ ] Im „…"-Menü eines Todos gibt es „Verschieben →" mit Liste der anderen Spaces (Desktop-Popover **und** Mobile-Sheet).
- [ ] Auswahl eines Ziels verschiebt das Todo; danach ist es im Ziel-Space vorhanden und im Quell-Space verschwunden — ohne Datenverlust (Titel, Body, Tags, Erledigt-Status, `createdBy`, `createdAt` erhalten).
- [ ] Die Operation ist atomar: Es entsteht nie ein Duplikat oder ein verlorenes Todo.
- [ ] `order` im Ziel-Space ist `maxOrder+1` (Todo erscheint am Ende der Ziel-Liste).
- [ ] `modifiedBy` ist nach dem Verschieben der verschiebende Nutzer; `createdBy`/`createdAt` sind unverändert.
- [ ] Verschieben in einen Space, in dem der Ersteller **kein** Mitglied ist, ist nicht möglich; der Nutzer erhält eine klare Rückmeldung (kein roher Permission-Fehler).
- [ ] Zeigt `waitingOn` auf einen Nicht-Mitglied des Ziels, erscheint vor dem Verschieben eine Bestätigung; nach Bestätigung ist `waitingOn` im Ziel `null`.
- [ ] Hat der Nutzer nur einen Space, wird „Verschieben →" nicht angezeigt.
- [ ] Nach erfolgreichem Verschieben erscheint ein Bestätigungs-Toast; der aktive Space bleibt gleich.
- [ ] `firestore.rules`-Tests decken ab: erlaubter Move (Mitglied beider Spaces, Ersteller im Ziel), abgelehnter Move (Ersteller nicht im Ziel; `modifiedBy != auth.uid`; Nicht-Mitglied), `waitingOn`-Validierung im Ziel, sowie dass bestehende Update-Pfade weiterhin funktionieren (mit `modifiedBy`).
- [ ] `npm run lint` und `npx tsc --noEmit` sind sauber.

## 4. Abhängigkeiten zu anderen Anforderungen

- Baut auf dem Spaces-/Todos-Datenmodell (Issues #40, #41) und der Feld-Typ-Härtung (#71) auf.
- Nutzt das Toast-Primitive (#43, inkl. optionalem Undo wie #70).
- Verwandt mit `removeSpaceMember`/`waitingOn`-Aufräumlogik (#63) — gleiche Klasse von „Member-Referenz wird ungültig".
- **Folge-Issue (nicht Teil):** Verschieben aus der Board-Ansicht (`TodoCard`).

## 5. Priorisierung

Hohe Dringlichkeit (vom User als „dringend" markiert). Reihenfolge: zuerst Datenschicht + Regeln (`modifiedBy`, `moveTodoToSpace`, Rules, Tests), dann Context-Methode, dann Listen-UI. Board-Support und Undo sind nachgelagert/optional.
