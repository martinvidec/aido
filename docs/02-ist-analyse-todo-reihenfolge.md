# Ist-Analyse: Todos manuell nach Reihenfolge ordnen

## 1. Aktueller Zustand

Todos werden ausschließlich nach dem Feld **`order: number`** sortiert, das beim
Anlegen einmalig auf `maxOrder + 1` gesetzt wird (Insertion-Order). Es existiert
**keine UI**, um die Reihenfolge nachträglich zu ändern — der Typ-Kommentar hält
das fest: *„There is no manual reordering UI."*

Konkret:

- **Datenmodell:** `spaces/{spaceId}/todos/{id}` trägt `order: number`
  (`src/lib/types.ts`, Z. 55–59).
- **Schreiben:** `createTodo(...)` schreibt `order: input.order ?? 0`
  (`firebaseUtils.ts`, Z. 215). `TodosContext.createTodo` berechnet
  `maxOrder + 1` über alle geladenen Todos (Z. 178–182).
- **Lesen/Sortieren:** `getTodosForSpace` und `subscribeTodosForSpace` fragen mit
  `orderBy("order","asc")` ab (`firebaseUtils.ts`, Z. 222 / 234). Die Live-
  Subscription (`onSnapshot`, issue #72) hält die Liste bei allen Mitgliedern
  aktuell.
- **Listen-Render:** `TodoSections` teilt `filtered` in `open`/`done` und rendert
  je eine `TodoRow` in der gegebenen (order-)Reihenfolge — kein Drag, kein Handle.
- **Board-Render:** `buildColumns` (`board/columns.ts`) gruppiert dieselben Todos
  nach Person/Status in Spalten; innerhalb jeder Spalte bleibt die order-
  Reihenfolge erhalten. `BoardView` nutzt **HTML5-Drag&Drop** (`onDragStart`/
  `onDrop`), um Karten **zwischen Spalten** zu ziehen → das ändert `waitingOn`
  bzw. `completed` (via `col.apply`), **nicht** `order`. HTML5-DnD funktioniert
  **nicht auf Touch**.
- **Regeln:** `firestore.rules` erlaubt jedem Space-Mitglied ein `update`, sofern
  `order is number`, `modifiedBy == caller` und `createdBy` unverändert bleibt
  (Z. 182–187, `hasValidTodoFields`). Eine `order`-Änderung ist damit **bereits
  regelkonform** — es fehlt nur Client-Logik und UI.

## 2. Relevante Dateien und Komponenten

| Datei/Komponente | Beschreibung | Relevanz |
|---|---|---|
| `src/lib/types.ts` | `Todo`-Typ inkl. `order: number` (+ Kommentar „kein Reorder-UI") | Kommentar aktualisieren; Typ bleibt |
| `src/lib/firebase/firebaseUtils.ts` | `createTodo` (order-Vergabe), `getTodosForSpace`/`subscribeTodosForSpace` (orderBy), `editTodoContent`/`setTodoStatus` (Update-Muster mit `modifiedBy`) | **Neue** `reorderTodo(...)`-Schreibfunktion; Muster für `modifiedBy` übernehmen |
| `src/lib/contexts/TodosContext.tsx` | Lädt/mutiert die Todos des aktiven Space; CRUD-Methoden; berechnet `maxOrder+1` | **Neue** Methode `reorder(...)`; optimistisches Update optional |
| `src/components/shell/list/TodoSections.tsx` | Rendert offene + erledigte Rows | Offene Liste in `Reorder.Group` wandeln |
| `src/components/shell/list/TodoRow.tsx` | Einzelne Listenzeile (Desktop/Mobile) | Drag-Handle ergänzen; `Reorder.Item` |
| `src/components/shell/list/ListView.tsx`, `MobileTodos.tsx` | Desktop-/Mobile-Rahmen der Liste | Einbindung der Reorder-fähigen Sektion |
| `src/components/shell/list/TodoActions.tsx` | Aktionsmenü (Popover/Sheet) | Optional „Nach oben/unten" als A11y-Fallback |
| `src/components/shell/board/columns.ts` | `buildColumns`: Spalten + `apply`-Drop | Spalten-Todos bleiben order-sortiert; Intra-Spalten-Reorder einhängen |
| `src/components/shell/board/BoardView.tsx`, `MobileBoard.tsx`, `TodoCard.tsx` | Board-DnD zwischen Spalten | Intra-Spalten-Reorder ergänzen (zus. zum Spaltenwechsel) |
| `firestore.rules` | Erlaubt order-Update bereits | **Keine** Änderung; nur Test ergänzen |
| `tests/firestore-rules.test.mjs` | Regeltests Todos | Test: Mitglied darf `order` ändern, Typ erzwungen |
| `package.json` | `framer-motion ^11` vorhanden | `Reorder` nutzbar, **keine neue Dependency** |

## 3. Bestehende Abhängigkeiten

- **`framer-motion ^11.3.31`** ist bereits installiert und bietet
  `Reorder.Group`/`Reorder.Item` (Maus **und** Touch, animiert) — Grundlage der
  geplanten Liste-DnD ohne neue Abhängigkeit.
- **Firebase Client SDK** (`writeBatch`/`updateDoc`, `serverTimestamp`,
  `onSnapshot`) — `writeBatch` wird bereits in `moveTodoToSpace` genutzt; das
  Update-Muster mit `modifiedBy: uid` ist etabliert.
- **Live-Subscription (`onSnapshot`, #72):** order-Änderungen propagieren ohne
  Zusatzaufwand an alle Mitglieder.
- **Board-DnD** basiert heute auf nativem HTML5-Drag&Drop (eigene
  `dragId`/`dragOver`-State in `BoardView`) — ein zweites, paralleles
  Drag-System zur geplanten framer-motion-Liste.

## 4. Bekannte Einschränkungen

- **HTML5-DnD ≠ Touch:** Das bestehende Board-Drag funktioniert nicht auf Touch.
  Für eine touch-fähige Reihenfolge in der Liste ist framer-motion `Reorder` (oder
  ein pointer-basiertes Verfahren) erforderlich.
- **Zwei Drag-Welten im Board:** Inter-Spalten-Move (HTML5-DnD, ändert Status/
  Person) und der gewünschte Intra-Spalten-Reorder (Reihenfolge) müssen koexistieren,
  ohne sich gegenseitig zu stören — die zentrale Designaufgabe des Board-Teils.
- **`order` ist heute ganzzahlig** (`maxOrder+1`). Fractional/Midpoint führt
  gebrochene Werte ein; mehrfaches Halbieren zwischen zwei festen Nachbarn stößt
  irgendwann an die **Float-Präzision** → Normalisierungsstrategie nötig.
- **Tag-Filter zeigt nur Teilmenge:** Beim Umsortieren im gefilterten Zustand sind
  nicht alle Nachbarn sichtbar; die gewählte Midpoint-Variante ordnet nur die
  sichtbaren relativ zueinander (unsichtbare behalten ihre `order`).
- **Keine serverseitige Transaktion über mehrere Docs nötig** für Midpoint (1
  Doc-Write/Move) — aber eine spätere Normalisierung betrifft mehrere Docs (Batch).

## 5. Risiken bei Änderung

- **Float-Präzisionsverlust:** Ohne Normalisierung kann nach vielen Moves zwischen
  denselben Nachbarn `(a+b)/2 == a` werden → zwei gleiche `order`-Werte, instabile
  Sortierung. Mitigation: bei zu kleinem Nachbarabstand Liste neu normalisieren
  (Batch mit sauberen Ganzzahlen).
- **Gleichstände/`order`-Kollisionen:** Schon heute können zwei Todos `order==0`
  haben (Legacy/`?? 0`). `orderBy` ist dann nicht deterministisch → beim ersten
  Reorder bzugleich normalisieren, um Altbestände zu heilen.
- **Nebenläufige Reorder (Kollaboration):** Zwei Mitglieder ziehen gleichzeitig →
  Last-Write-Wins pro Doc; bei Midpoint betrifft jeder Move nur ein Doc, das
  Risiko sichtbarer „Sprünge" ist klein, aber nicht null (via `onSnapshot` heilt
  sich die Ansicht).
- **Regression Board-DnD:** Das Einführen eines zweiten Drag-Systems darf den
  bestehenden Spaltenwechsel (Status/Person) nicht brechen.
- **Optimistisches UI vs. Snapshot:** Springt die Liste zwischen lokalem Drop und
  Firestore-Echo, wirkt es ruckelig → optimistische lokale Sortierung bis zum
  Snapshot-Echo.
- **Falsche Felder im Update:** Ein order-Update muss `modifiedBy` mitschreiben und
  `createdBy`/`spaceId` unangetastet lassen, sonst greift die Regel nicht
  (`isValidModifiedBy`, `createdBy == resource.createdBy`).
