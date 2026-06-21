# Anforderungsanalyse: Todos manuell nach Reihenfolge ordnen

## 1. Funktionale Anforderungen

| ID | Anforderung | Priorität | Beschreibung |
|---|---|---|---|
| FA-01 | Drag & Drop in der Liste | Muss | In der **offenen** Liste lässt sich ein Todo per Drag & Drop an eine andere Position ziehen (Desktop **und** Mobile/Touch), umgesetzt mit `framer-motion` `Reorder`. |
| FA-02 | Drag-Handle | Muss | Jede Row hat ein klar erkennbares Handle (`≡`) als Greifpunkt, damit Ziehen nicht mit Scrollen, Tippen, Checkbox oder Inline-Edit kollidiert. |
| FA-03 | Midpoint-Persistenz | Muss | Beim Loslassen erhält das verschobene Todo `order = (orderVorher + orderNachher) / 2` (Ränder: `min−1` bzw. `max+1`); genau **ein** Doc-Write pro Move, `modifiedBy = caller`, `createdBy`/`spaceId` unverändert. |
| FA-04 | Live-Persistenz | Muss | Die neue Reihenfolge wird in Firestore gespeichert und ist über `onSnapshot` für alle Space-Mitglieder live sichtbar. |
| FA-05 | Neue Todos ans Ende | Muss | Beim Anlegen landet ein Todo weiterhin am Listenende (`maxOrder + 1`) — unverändertes Verhalten. |
| FA-06 | Normalisierung | Soll | Wird der `order`-Abstand zweier Nachbarn zu klein (Float-Präzisionsgrenze) **oder** liegen Gleichstände vor (z. B. mehrere `order==0` aus Altbestand), wird die betroffene Liste in einem `writeBatch` mit sauberen Ganzzahlen neu vergeben. |
| FA-07 | Gefiltertes Umordnen | Soll | Bei aktivem Tag-Filter ordnet ein Drop nur die **sichtbaren** Todos relativ zueinander (Midpoint zwischen den sichtbaren Nachbarn); unsichtbare behalten ihre `order` und ordnen sich global mit ein. |
| FA-08 | Board: Intra-Spalten-Reorder | Soll | Innerhalb einer Board-Spalte lässt sich die Reihenfolge per Hand ändern — **zusätzlich** zum bestehenden Spaltenwechsel (Drag zwischen Spalten = Status/Person via `apply`). |
| FA-09 | A11y-/Tasten-Fallback | Kann | „Nach oben" / „Nach unten" im Aktionsmenü (`TodoActions`) als barrierefreie Alternative zum Ziehen. |
| FA-10 | Optimistisches Update | Kann | Lokale Sortierung wird sofort beim Drop angewandt und vom Snapshot-Echo bestätigt, damit die Liste nicht ruckelt/springt. |

**Nicht gefordert (Abgrenzung):** Umsortieren der „Erledigt"-Sektion, Umsortieren
von Daily-/„Heute"-Items, Sortier-Modi (Fälligkeit/Alphabet/Priorität),
Reordering über MCP/Agent-Tools, Reorder über Space-Grenzen (= „Verschieben").

## 2. Nicht-funktionale Anforderungen

| ID | Anforderung | Kategorie | Beschreibung |
|---|---|---|---|
| NFA-01 | Wenig Schreiblast | Performance | Ein Reorder kostet **ein** Doc-Write (Midpoint); die Mehr-Doc-Normalisierung (FA-06) tritt nur selten auf. |
| NFA-02 | Keine Regelaufweichung | Sicherheit | Order-Update läuft über die bestehende `allow update`-Regel; `modifiedBy == caller`, `createdBy`/`spaceId` bleiben unangetastet. **Keine** Lockerung von `firestore.rules`. |
| NFA-03 | Touch-Bedienbarkeit | Usability | Ziehen funktioniert flüssig auf Touch ohne Konflikt mit dem Seiten-Scroll; Greifen nur am Handle. |
| NFA-04 | Stabile, eindeutige Ordnung | Konsistenz | Nach jedem Reorder sind die `order`-Werte eindeutig und deterministisch sortierbar (keine Gleichstände, keine Float-Drift bis zur Kollision). |
| NFA-05 | Barrierefreiheit | A11y | Reihenfolge auch ohne Pointer änderbar (Buttons/Tastatur, FA-09). |
| NFA-06 | Keine Migration | Wartbarkeit | Nutzt das vorhandene `order`-Feld; kein neues Feld, kein Backfill, keine Datenmigration nötig. |
| NFA-07 | Keine Board-Regression | Stabilität | Der bestehende Inter-Spalten-Move (Status/Person) bleibt voll funktionsfähig. |

## 3. Akzeptanzkriterien

- [ ] In der offenen Liste lässt sich ein Todo per Maus an eine neue Position ziehen; nach Reload bleibt die Reihenfolge erhalten.
- [ ] Dasselbe funktioniert per Touch auf Mobile (Greifen am Handle, kein versehentliches Scroll-Ziehen).
- [ ] Ein zweites, eingeloggtes Mitglied sieht die neue Reihenfolge ohne manuellen Reload (live).
- [ ] Ein einzelner Move schreibt genau **ein** Todo-Dokument (Midpoint), mit aktualisiertem `modifiedBy`.
- [ ] Neu angelegte Todos erscheinen am **Ende** der offenen Liste.
- [ ] Werden zwei Nachbarn „zu eng" (oder existieren Gleichstände), normalisiert ein Reorder die Liste auf saubere Ganzzahlen, ohne sichtbare Sprünge.
- [ ] Bei aktivem Tag-Filter bleibt die relative Reihenfolge der sichtbaren Todos nach dem Drop korrekt; unsichtbare Todos verschwinden nicht und behalten ihren Platz.
- [ ] Im Board lässt sich innerhalb einer Spalte umsortieren; das Ziehen **zwischen** Spalten ändert weiterhin Status/Person.
- [ ] Die „Erledigt"-Sektion ist nicht per Drag umsortierbar (nur lesend order-sortiert).
- [ ] Der Firestore-Regeltest bestätigt: ein Mitglied darf `order` ändern, ein Nicht-Mitglied nicht; `order` muss eine Zahl sein.
- [ ] `npm run build`, `npm run lint` und `npx tsc --noEmit` laufen sauber durch.

## 4. Abhängigkeiten zu anderen Anforderungen

- Baut auf dem vorhandenen **`order`-Feld** und der **Live-Subscription** (`onSnapshot`, issue #72) auf.
- Nutzt **`framer-motion`** (bereits Dependency) — keine neue Abhängigkeit.
- Unabhängig vom Feature **„Todo verschieben"** (issues #200–#202), berührt aber dieselbe `order`-Logik (`moveTodoToSpace` setzt im Ziel `maxOrder+1`) — kein Konflikt, gleiche Konvention „ans Ende".
- Das Board-Teilstück (FA-08) baut auf der Liste-Reorder-Mechanik (Context-Methode + Midpoint-Helfer) auf und sollte **nach** dem Liste-Teil umgesetzt werden.

## 5. Priorisierung

1. **Muss (MVP):** FA-01..FA-05 + NFA-01..NFA-04, NFA-06 — Drag & Drop in der
   Liste (Desktop + Touch) mit Midpoint-Persistenz und Live-Sync. Damit ist das
   Kernbedürfnis („Reihenfolge selbst bestimmen") erfüllt.
2. **Soll:** FA-06 (Normalisierung/Robustheit), FA-07 (gefiltertes Umordnen),
   FA-08 (Board-Reorder, NFA-07). Erhöhen Robustheit und Vollständigkeit.
3. **Kann:** FA-09 (A11y-Buttons), FA-10 (optimistisches Update als Politur).
