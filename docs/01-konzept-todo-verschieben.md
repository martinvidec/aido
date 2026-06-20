# Konzept: Todos in einen anderen Space verschieben

## 1. Zusammenfassung

Nutzer sollen ein bestehendes Todo aus seinem aktuellen Space in einen anderen
Space, dem sie ebenfalls angehören, verschieben können ("Move to space"). Da
Todos unter dem Firestore-Pfad `spaces/{spaceId}/todos/{id}` liegen und die
`spaceId` Teil des Pfads ist, ist das technisch kein Feld-Update, sondern ein
atomares **Anlegen im Ziel-Space + Löschen im Quell-Space**.

## 2. Problemstellung

Heute ist ein Todo dauerhaft an den Space gebunden, in dem es angelegt wurde.
Wird ein Todo im falschen Space erstellt, oder ändert sich die Zuordnung
(z. B. eine Aufgabe gehört thematisch in ein anderes Projekt/Team), gibt es
keine Möglichkeit, es zu verschieben — der Nutzer muss es manuell im Ziel-Space
neu anlegen (Titel, Body, Tags, Wartet-auf gehen dabei verloren) und das alte
löschen. Das ist umständlich und fehleranfällig.

## 3. Zielsetzung

- Ein Todo kann mit wenigen Klicks/Taps von Space A nach Space B verschoben
  werden, **ohne Datenverlust** (Titel, Body/Tiptap-JSON, Erledigt-Status,
  Tags, Ersteller und Erstelldatum bleiben erhalten).
- Die Aktion ist sowohl auf Desktop als auch auf Mobile erreichbar.
- Die Operation ist **atomar** — es entstehen niemals Duplikate oder verlorene
  Todos, auch wenn die Operation mittendrin abbricht.
- Es können nur Spaces als Ziel gewählt werden, in denen der Nutzer Mitglied
  ist (sonst würde die Firestore-Regel die Erstellung ohnehin ablehnen).
- Datenkonsistenz: Felder, die an die Space-Mitgliedschaft gebunden sind
  (`waitingOn`), werden beim Verschieben korrekt behandelt.

## 4. Lösungsidee

**Datenoperation (atomar via Firestore `writeBatch`):**
1. Neues Todo-Dokument im Ziel-Space anlegen (`spaces/{zielId}/todos/{neueId}`)
   mit allen übernommenen Feldern; `spaceId` wird auf die Ziel-`spaceId`
   gesetzt; `order` wird im Ziel-Space neu berechnet (ans Ende).
2. Quell-Todo (`spaces/{quellId}/todos/{id}`) löschen.
3. Beide Schreibvorgänge in einem `writeBatch` → atomar.

**`waitingOn`-Behandlung:** Ist `waitingOn` gesetzt und der referenzierte Nutzer
ist **kein** Mitglied des Ziel-Spaces, wird `waitingOn` beim Verschieben auf
`null` gesetzt (sonst lehnt die Firestore-Regel `hasValidWaitingOn()` den
Schreibvorgang ab). Andernfalls bleibt es erhalten.

**UI:** Eine neue Aktion "Verschieben →" im bestehenden Aktionsmenü pro Todo
(`TodoActions`, genutzt sowohl im Desktop-Popover als auch im Mobile-
BottomSheet der Liste). Beim Auswählen erscheint ein Picker mit allen anderen
Spaces des Nutzers. Auswahl löst die Move-Operation aus; eine Toast-Meldung
bestätigt ("In ‚<Space>' verschoben").

## 5. Betroffene Komponenten

| Bereich | Datei(en) | Art der Änderung |
|---|---|---|
| Firestore-Schreiblogik | `src/lib/firebase/firebaseUtils.ts` | Neue Funktion `moveTodoToSpace(...)` (Batch: create im Ziel + delete in Quelle) |
| Todos-State | `src/lib/contexts/TodosContext.tsx` | Neue Context-Methode `moveTodo(todoId, targetSpaceId)` |
| Spaces-State | `src/lib/contexts/SpacesContext.tsx` | Liefert bereits Spaces+Mitglieder; ggf. Helfer zum Auflisten der Ziel-Spaces |
| Listen-UI | `src/components/shell/list/TodoActions.tsx` | Neuer Eintrag "Verschieben" mit Space-Picker-Submenü (Desktop + Mobile) |
| Board-UI (optional) | `src/components/shell/board/TodoCard.tsx` u. a. | Optional: Move-to-Space im Card-Menü (Abgrenzung beachten) |
| Firestore-Regeln | `firestore.rules` | Voraussichtlich **keine** Änderung nötig (vorhandene create/delete-Regeln decken den Move ab) — wird in der Ist-Analyse verifiziert |
| Tests | `tests/firestore-rules.test.mjs`, ggf. neuer Test | Regel-/Verhaltenstests für den Move |

## 6. Abgrenzung

Nicht Teil dieser Anforderung:

- **Bulk-Move** (mehrere Todos gleichzeitig verschieben) — nur Einzel-Todo.
- **Verschieben in einen Space, in dem der Nutzer NICHT Mitglied ist** — der
  Picker zeigt nur eigene Spaces.
- **Kopieren** (Original behalten) — es ist ein Verschieben, kein Duplizieren.
- **Verschieben von Daily-/„Heute"-Items** — nur strukturierte Todos.
- **Drag & Drop zwischen Spaces** — die Aktion läuft über das Menü/den Picker.
  (Board-DnD bleibt auf Status/Person innerhalb des Spaces beschränkt.)
- **Beibehalten der Todo-ID** im Ziel-Space — es wird eine neue ID vergeben
  (Todos werden nirgends per ID referenziert).

## 7. Offene Fragen (entschieden)

1. **Board-Ansicht:** → **Nur Listen-Ansicht** im ersten Schritt. Board-Support
   wird als optionales Folge-Issue erfasst, nicht Teil dieses Features.
2. **`waitingOn` ungültig im Ziel-Space:** → **Vorher warnen/bestätigen.** Zeigt
   der Wartet-auf-Nutzer im Ziel-Space nicht als Mitglied, wird der Nutzer
   gewarnt, dass „Wartet auf" verloren geht, und muss bestätigen; bei Bestätigung
   wird `waitingOn` auf `null` gesetzt.
3. **Sichtbarkeit der Aktion bei nur einem Space:** → **Aktion ausblenden**, wenn
   es keinen anderen Space als Ziel gibt.
4. **Aktiver Space nach dem Verschieben:** → **Im aktuellen Space bleiben.** Das
   Todo verschwindet aus der aktuellen Liste; ein Toast bestätigt das Verschieben.
5. **`mentions` im Ziel-Space:** → **Unverändert übernehmen** (reine UIDs, bleiben
   technisch gültig). Kein Filtern auf Ziel-Mitglieder in diesem Feature.
