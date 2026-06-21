# Konzept: Todos manuell nach Reihenfolge ordnen

## 1. Zusammenfassung

Nutzer sollen die Reihenfolge der Todos in der **Liste** selbst bestimmen können,
indem sie ein Todo per Drag & Drop (bzw. „nach oben/unten") an eine andere
Position ziehen. Das Datenmodell trägt bereits ein `order`-Feld, nach dem die
Liste sortiert wird — es fehlt bislang nur die **UI zum Umsortieren** und die
Schreiblogik, die die neuen `order`-Werte persistiert.

## 2. Problemstellung

Heute ergibt sich die Reihenfolge der Todos ausschließlich aus dem **Anlege-
Zeitpunkt**: Beim Erstellen bekommt jedes Todo `order = maxOrder + 1`, und die
Liste sortiert per `orderBy("order","asc")`. Der Typ-Kommentar in `src/lib/types.ts`
hält das ausdrücklich fest: *„There is no manual reordering UI."*

Damit kann ein Nutzer ein wichtiges Todo nicht nach oben holen oder eine logische
Abarbeitungsreihenfolge herstellen. Die einzige Möglichkeit, etwas „nach oben" zu
bekommen, wäre es zu löschen und neu anzulegen — mit Verlust von Body, Tags,
„Wartet auf" und Erstelldatum. Das ist unbrauchbar.

## 3. Zielsetzung

- Ein Todo kann mit Drag & Drop an eine beliebige andere Position innerhalb der
  offenen Liste gezogen werden; die neue Reihenfolge wird **sofort persistiert**
  und ist für alle Space-Mitglieder live sichtbar (`onSnapshot`).
- Die Aktion funktioniert auf **Desktop und Mobile** (Touch).
- Die Reihenfolge ist **stabil** und **kollisionsfrei** — keine doppelten oder
  „springenden" Positionen, auch bei realer Zusammenarbeit.
- Neue Todos landen weiterhin **am Ende** der Liste (unverändertes Verhalten).
- Keine Regression: bestehende Sortierung, Filter, „Erledigt"-Sektion und Board
  funktionieren unverändert weiter.

## 4. Lösungsidee

**Datenseite (bereits vorhanden, wird genutzt):**
- Das Feld `order: number` und die `orderBy("order","asc")`-Abfragen bleiben die
  Quelle der Sortierung. Es ist **kein** neues Feld und **keine** Migration nötig.
- Die Firestore-Regeln erlauben Mitgliedern bereits, `order` zu ändern (sie
  validieren nur `order is number` zusammen mit `modifiedBy == caller` und
  unveränderlichem `createdBy`) → voraussichtlich **keine** Regeländerung.

**Persistierung der neuen Reihenfolge:** Beim Loslassen werden die betroffenen
Todos in einem **`writeBatch`** mit neuen, sauberen ganzzahligen `order`-Werten
neu durchnummeriert (die Listen sind klein — typischerweise wenige bis einige
Dutzend Todos pro Space). Das ist robust und kollisionsfrei; eine alternative
Fractional-/Midpoint-Indizierung (nur ein Doc-Write pro Move, aber
Float-Präzisionsgrenzen) wird in den offenen Fragen abgewogen.

**UI / Interaktion:** Drag & Drop in der Liste (`shell/list`). Als Bibliothek
bietet sich **`framer-motion`** mit der `Reorder`-Komponente an — sie ist
**bereits Dependency**, unterstützt **Touch und Maus** und bringt flüssige
Animationen mit (das handgebaute HTML5-DnD des Boards funktioniert nicht auf
Touch). Ergänzend bzw. als Barrierefreiheits-Fallback können „Nach oben"/„Nach
unten"-Einträge im bestehenden Aktionsmenü (`TodoActions`) angeboten werden.

**Geltungsbereich:** Umsortiert wird die **offene** Liste. Die „Erledigt"-Sektion
bleibt nach `order` sortiert, ist aber selbst nicht umsortierbar. Bei aktivem
**Tag-Filter** sieht der Nutzer nur eine Teilmenge — hier wird das Umsortieren
deaktiviert (oder bewusst gehandhabt, siehe offene Fragen), um keine unsichtbaren
Positionen zu zerstören.

## 5. Betroffene Komponenten

| Bereich | Datei(en) | Art der Änderung |
|---|---|---|
| Firestore-Schreiblogik | `src/lib/firebase/firebaseUtils.ts` | Neue Funktion `reorderTodos(spaceId, orderedIds, uid)` (Batch: neue `order`-Werte für die betroffenen Todos) |
| Todos-State | `src/lib/contexts/TodosContext.tsx` | Neue Context-Methode `reorder(orderedIds)`; ggf. optimistisches lokales Update |
| Listen-UI | `src/components/shell/list/TodoSections.tsx`, `TodoRow.tsx`, `ListView.tsx`, `MobileTodos.tsx` | Drag & Drop / `Reorder.Group`+`Reorder.Item`, Drag-Handle, Touch-Support |
| Aktionsmenü (optional) | `src/components/shell/list/TodoActions.tsx` | „Nach oben"/„Nach unten" als Fallback (A11y/Mobile) |
| Typen | `src/lib/types.ts` | Kommentar zu `order` aktualisieren (es gibt nun eine Reorder-UI) |
| Tests | `tests/firestore-rules.test.mjs` | Regeltest: Mitglied darf `order` ändern; Nicht-Mitglied nicht |

## 6. Abgrenzung

Nicht Teil dieser Anforderung:

- **Umsortieren der „Erledigt"-Sektion** — erledigte Todos bleiben order-sortiert,
  werden aber nicht per Hand umsortiert.
- **Umsortieren über Spaces hinweg** — das ist „Verschieben" (Feature
  `todo-verschieben`), nicht „Reihenfolge".
- **Umsortieren von „Heute"/Daily-Items** — nur strukturierte Todos.
- **Sortier-Modi** (nach Fälligkeit, Alphabet, Priorität …) — hier geht es rein um
  die **manuelle** Reihenfolge.
- **Reordering via MCP/Agent-Tools** — kein neues MCP-Tool in diesem Feature.

## 7. Offene Fragen (entschieden)

1. **Interaktionsmodell:** → **Drag & Drop mit `framer-motion` `Reorder`** (Touch +
   Maus, bereits Dependency, animiert). Kein handgebautes HTML5-DnD für die Liste.
2. **Persistenz-Schema:** → **Fractional/Midpoint-`order`** — beim Move bekommt das
   verschobene Todo den Mittelwert der `order`-Werte seiner neuen Nachbarn; nur
   **ein** Doc-Write pro Move. Die Float-Präzisionsgrenze wird durch eine
   **Normalisierung/Neuvergabe** abgefangen, wenn der Abstand zweier Nachbarn zu
   klein wird (siehe Spezifikation).
3. **Verhalten bei aktivem Tag-Filter:** → **Gefiltert umordnen erlauben.** Beim
   Drop im gefilterten Zustand werden nur die **sichtbaren** Todos relativ
   zueinander geordnet (Midpoint zwischen den sichtbaren Nachbarn); unsichtbare
   Todos behalten ihre `order` und ordnen sich global mit ein.
4. **Mobile-Bedienung:** → **Touch-Drag** über `framer-motion` (langes Drücken/Ziehen
   am Handle). „Nach oben/unten"-Buttons sind **optional** als A11y-Ergänzung, kein
   harter Bestandteil.
5. **Board-Reordering:** → **Board macht mit.** Auch *innerhalb* einer Board-Spalte
   ist die Reihenfolge per Hand änderbar (zusätzlich zum bestehenden Spaltenwechsel
   = Status/Person). Das Zusammenspiel von Intra-Spalten-Reorder und
   Inter-Spalten-Move wird in der Spezifikation entworfen.
