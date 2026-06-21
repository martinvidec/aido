# Spezifikation: Todos manuell nach Reihenfolge ordnen

## 1. Übersicht

Manuelle Reihenfolge der Todos per Drag & Drop. Das vorhandene `order`-Feld bleibt
die Sortierquelle; neu sind (a) eine **Midpoint-Schreiblogik** (`order` = Mittelwert
der neuen Nachbarn, ein Doc-Write pro Move), (b) eine **`Reorder`-UI** auf Basis von
`framer-motion` für die Liste (Desktop + Touch), (c) eine **Normalisierung** gegen
Float-Drift/Gleichstände und (d) **Intra-Spalten-Reorder** im Desktop-Board. Es gibt
**keine** Datenmigration und **keine** Lockerung der Firestore-Regeln.

Basis: [Konzept](01-konzept-todo-reihenfolge.md) ·
[Ist-Analyse](02-ist-analyse-todo-reihenfolge.md) ·
[Anforderungsanalyse](03-anforderungsanalyse-todo-reihenfolge.md).

## 2. Technisches Design

### 2.1 Architektur

Drei Schichten, von unten nach oben:

1. **Schreibschicht** (`firebaseUtils.ts`) — reine Pure-Function für die
   Order-Berechnung + dünne Firestore-Writes.
2. **State** (`TodosContext.tsx`) — `reorder(...)`-Methode, die aus der **sichtbaren**
   Liste die Nachbarn bestimmt, die neue `order` berechnet und persistiert; hält ein
   optimistisches lokales Abbild bis zum Snapshot-Echo.
3. **UI** — Liste über `framer-motion` `Reorder`; Desktop-Board erweitert sein
   bestehendes HTML5-DnD um kartengenaue Drop-Ziele.

### 2.2 Datenmodell

**Keine Schemaänderung.** `order: number` bleibt; künftig auch **gebrochene** Werte.
`createTodo` vergibt weiterhin `maxOrder + 1` (Ende). Der Typ-Kommentar zu `order`
in `src/lib/types.ts` wird aktualisiert (es gibt nun eine Reorder-UI).

**Order-Berechnung (Pure Function, testbar):**

```ts
// src/lib/utils/order.ts (neu)
export const ORDER_STEP = 1;          // Abstand bei Normalisierung
export const ORDER_MIN_GAP = 1e-6;    // darunter: vor dem Einfügen normalisieren

/** order für ein Todo, das zwischen prev und next einsortiert wird.
 *  null = kein Nachbar (Listenrand). Gibt `null` zurück, wenn der Abstand
 *  zu klein ist und vorher normalisiert werden muss. */
export function orderBetween(prev: number | null, next: number | null): number | null {
  if (prev == null && next == null) return ORDER_STEP;   // leere Liste
  if (prev == null) return next! - ORDER_STEP;           // an den Anfang
  if (next == null) return prev + ORDER_STEP;            // ans Ende
  if (next - prev < ORDER_MIN_GAP) return null;          // zu eng → normalisieren
  return (prev + next) / 2;                              // dazwischen
}
```

**Normalisierung:** Liefert `orderBetween` `null` (zu enger Spalt) **oder** liegen
Gleichstände im Bestand vor (z. B. Legacy-`order==0`), wird die betroffene Liste in
einem `writeBatch` mit `order = (index+1) * ORDER_STEP` neu vergeben, danach der Move
auf der frischen Verteilung berechnet.

### 2.3 Schnittstellen

**`firebaseUtils.ts` (neu):**

```ts
// Ein Doc-Write: order + modifiedBy (Regel verlangt modifiedBy == caller).
export const setTodoOrder = (spaceId, todoId, order: number, uid) =>
  updateDoc(todoDocRef(spaceId, todoId), { order, modifiedBy: uid });

// writeBatch: vergibt sauber verteilte Ganzzahlen für die übergebene Reihenfolge.
export const normalizeTodoOrders = (spaceId, orderedIds: string[], uid) => {
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) =>
    batch.update(todoDocRef(spaceId, id), { order: (i + 1) * ORDER_STEP, modifiedBy: uid }));
  return batch.commit();
};
```

**`TodosContext.tsx` (neu im Context-Typ):**

```ts
/** Verschiebt `movedId` an seine neue Position. `visibleOrderedIds` ist die
 *  bereits neu sortierte, SICHTBARE Liste (berücksichtigt den Tag-Filter, FA-07). */
reorder: (movedId: string, visibleOrderedIds: string[]) => Promise<void>;
```

Ablauf von `reorder`:
1. Index von `movedId` in `visibleOrderedIds` bestimmen; sichtbare Nachbarn
   `prevId`/`nextId` (oder `null` am Rand) ablesen.
2. Deren globale `order` aus dem `todos`-State holen → `orderBetween(prev, next)`.
3. Ergebnis `≠ null` → `setTodoOrder(...)`. Ergebnis `= null` →
   `normalizeTodoOrders(...)` über die neue sichtbare Reihenfolge, fertig.
4. Fehler → `showError(...)`; `onSnapshot` korrigiert die Ansicht ohnehin.

### 2.4 Liste: framer-motion `Reorder`

- `TodoSections` umschließt die **offene** Sektion mit `Reorder.Group axis="y"
  values={items} onReorder={setItems}`; jede Row wird `Reorder.Item value={todo}`.
  `items` ist lokaler State, initialisiert aus `open` und via `useEffect` bei
  Änderungen von `open` (Snapshot) nachgezogen → **optimistisch** (FA-10).
- `onReorder` aktualisiert nur den lokalen State; **persistiert** wird im
  `onDragEnd`/`Reorder.Item`-Abschluss durch `reorder(todo.id, items.map(t => t.id))`
  (so entsteht genau ein Write pro abgeschlossenem Move statt pro Zwischenfrequenz).
- **Drag-Handle** (`≡`) in `TodoRow`: `Reorder.Item` mit
  `dragListener={false}` + `useDragControls()`, das Handle ruft `controls.start(e)`.
  So lösen Checkbox, Inline-Edit und Scrollen **kein** Ziehen aus (FA-02, NFA-03).
- Die **„Erledigt"-Sektion** bleibt eine normale Liste (kein `Reorder`).

### 2.5 Board: Intra-Spalten-Reorder (Desktop)

Beibehalten wird das bestehende **HTML5-DnD** (kein zweites Drag-System im Board).
Erweiterung: jede `TodoCard` wird **zusätzlich** Drop-Ziel.

- Beim `onDrop` auf eine **Karte derselben Spalte**: `order` per `orderBetween`
  zwischen Zielkarte und deren Nachbar berechnen (Einfügen ober-/unterhalb je nach
  Cursor-Y relativ zur Kartenmitte) → `reorder(...)`. Status/Person bleiben.
- Beim `onDrop` auf die **Spaltenfläche** (heutiges Verhalten) bzw. eine Karte einer
  **anderen** Spalte: weiterhin `col.apply(id)` (Status/Person ändern).
- Unterscheidung über die Quell-/Ziel-Spalte des gezogenen Todos (`dragId` →
  dessen aktuelle Spaltenzugehörigkeit vs. Zielspalte).
- **Mobile-Board** (gestapelte Sektionen ohne DnD) bleibt unverändert; das
  Umsortieren auf Mobile erfolgt in der Liste/Todos-Tab.

### 2.6 Firestore-Regeln

**Keine Änderung.** Die `allow update`-Regel deckt order-Updates bereits ab
(`order is number`, `modifiedBy == caller`, `createdBy`/`spaceId` unverändert). Ein
**neuer Regeltest** verifiziert das positiv (Mitglied darf) und negativ
(Nicht-Mitglied darf nicht; `order: "x"` wird abgelehnt).

## 3. Implementierungsplan

### 3.1 Änderungen pro Komponente

| Komponente | Änderung | Aufwand |
|---|---|---|
| `src/lib/utils/order.ts` (neu) | `orderBetween`, `ORDER_STEP`, `ORDER_MIN_GAP` (pure) | Klein |
| `src/lib/firebase/firebaseUtils.ts` | `setTodoOrder`, `normalizeTodoOrders` | Klein |
| `src/lib/contexts/TodosContext.tsx` | `reorder(...)` im Typ + Impl (Nachbarn → order → persist/normalize) | Mittel |
| `src/lib/types.ts` | Kommentar zu `order` aktualisieren | Klein |
| `src/components/shell/list/TodoSections.tsx` | offene Sektion als `Reorder.Group`, lokaler `items`-State | Mittel |
| `src/components/shell/list/TodoRow.tsx` | `Reorder.Item` + `useDragControls` + Drag-Handle | Mittel |
| `src/components/shell/list/{ListView,MobileTodos}.tsx` | Einbindung/Props der Reorder-Sektion | Klein |
| `src/components/shell/list/TodoActions.tsx` | „Nach oben/unten" (A11y-Fallback, Kann) | Klein |
| `src/components/shell/board/{BoardView,TodoCard}.tsx`, `columns.ts` | kartengenaue Drop-Ziele + Intra-Spalten-Reorder | Mittel |
| `tests/firestore-rules.test.mjs` | Regeltest order-Update (+/−) | Klein |

### 3.2 Reihenfolge der Implementierung

1. **Schreib-/State-Schicht** (`order.ts`, `setTodoOrder`/`normalizeTodoOrders`,
   `TodosContext.reorder`, Typ-Kommentar) + **Regeltest**. → Issue A.
2. **Liste Drag & Drop** (framer-motion `Reorder`, Handle, optimistisch,
   gefiltertes Umordnen). → Issue B. *(hängt an A)*
3. **Board Intra-Spalten-Reorder** (Desktop). → Issue C. *(hängt an A)*
4. **A11y-Fallback „Nach oben/unten"**. → Issue D. *(hängt an A, optional)*

## 4. Testplan

- **Unit (pure):** `orderBetween` — leere Liste, Anfang, Ende, Mitte, zu enger
  Spalt (→ `null`). Klein und schnell; ggf. als `.mjs`/`tsx`-Test analog zu
  bestehenden Suites oder inline-Assertions.
- **Firestore-Regeln** (`tests/firestore-rules.test.mjs`, `npm run test:rules`):
  Mitglied darf `order` (Zahl) ändern; Nicht-Mitglied wird abgelehnt; `order: "x"`
  wird abgelehnt; `createdBy`/`spaceId` bleiben geprüft.
- **Manuell (Desktop):** Liste umsortieren, Reload → Reihenfolge bleibt. Mit zweitem
  Browser/Account: Live-Update sichtbar. Tag-Filter aktiv → relative Reihenfolge der
  sichtbaren Todos korrekt, unsichtbare bleiben erhalten. Board: innerhalb Spalte
  umsortieren; zwischen Spalten weiter Status/Person.
- **Manuell (Touch/Mobile):** Ziehen am Handle, kein versehentliches Scroll-Ziehen.
- **Robustheit:** wiederholt in denselben Slot droppen → Normalisierung greift,
  keine doppelten/instabilen Positionen.
- **Build/Typen:** `npm run build`, `npm run lint`, `npx tsc --noEmit`.

## 5. Migration / Deployment

- **Keine Datenmigration**, **kein** neues Firestore-Feld.
- **Keine Regeländerung** → kein `firestore:rules`-Deploy nötig (nur ein Test wird
  ergänzt). Falls sich im Test wider Erwarten doch eine Lücke zeigt, würde die Regel
  **nach** der App deployt (CLAUDE.md-Reihenfolge).
- **Keine neue Dependency** (`framer-motion` ist vorhanden).
- App-Deploy wie üblich über Vercel beim Merge nach `main`.

## 6. Referenzen

- [Konzeptdokument](01-konzept-todo-reihenfolge.md)
- [Ist-Analyse](02-ist-analyse-todo-reihenfolge.md)
- [Anforderungsanalyse](03-anforderungsanalyse-todo-reihenfolge.md)
