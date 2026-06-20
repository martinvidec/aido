# Ist-Analyse: Todos in einen anderen Space verschieben

## 1. Aktueller Zustand

Todos sind heute fest an den Space gebunden, in dem sie erstellt wurden. Sie
liegen unter `spaces/{spaceId}/todos/{id}`; die `spaceId` ist sowohl als Feld
gespeichert als auch Teil des Firestore-Pfads. Es gibt keine Funktion zum
Verschieben — weder in den Firestore-Utils, im `TodosContext`, noch in der UI.

Die `TodosContext`-Subscription lädt ausschließlich die Todos des **aktiven**
Spaces (`subscribeTodosForSpace(activeSpaceId, …)`). Andere Spaces sind dem
Context nur über `useSpaces().spaces` als Metadaten (id, name, color, members)
bekannt — deren Todos sind nicht geladen.

Das Aktionsmenü pro Todo (`TodoActions`) bietet aktuell: **Bearbeiten**,
**Wartet auf …** (Mitglieder-Picker + „Niemand"), **Löschen**. Es wird sowohl
im Desktop-Popover (`TodoRow`) als auch im Mobile-BottomSheet (`MobileTodos`)
mit derselben Komponente gerendert.

## 2. Relevante Dateien und Komponenten

| Datei/Komponente | Beschreibung | Relevanz |
|---|---|---|
| `src/lib/firebase/firebaseUtils.ts` | Firestore-CRUD. `createTodo` (Z. 168–195), `deleteTodo` (Z. 262–263), `todosCol`/`todoRef` (Z. 146–149), `removeSpaceMember` (Z. 127–135, Batch-Vorbild) | **Hoch** — neue Funktion `moveTodoToSpace` hier ergänzen |
| `src/lib/contexts/TodosContext.tsx` | State + CRUD des aktiven Spaces. `createTodo` berechnet `order` als `maxOrder+1` (Z. 164) | **Hoch** — neue Methode `moveTodo(id, targetSpaceId)` |
| `src/lib/contexts/SpacesContext.tsx` | Liefert `spaces[]` (inkl. `members`), `activeSpace`, `activeSpaceId` | **Mittel** — Quelle der Ziel-Space-Liste; `members` zur `waitingOn`-Prüfung |
| `src/components/shell/list/TodoActions.tsx` | Aktionsmenü pro Todo (Desktop + Mobile) | **Hoch** — neuer Eintrag „Verschieben →" mit Space-Picker-Submenü |
| `src/components/shell/list/TodoRow.tsx` | Desktop-Zeile, rendert `TodoActions` im Popover (w-52) | **Niedrig** — ggf. nur Props-Durchreichung |
| `src/components/shell/list/MobileTodos.tsx` | Rendert `TodoActions` im BottomSheet | **Niedrig** — funktioniert automatisch mit, da gleiche Komponente |
| `src/lib/contexts/ToastContext.tsx` | `showToast(msg, action?)` (info, optional Undo-Button), `showError(msg)` | **Mittel** — Bestätigungs-Toast nach dem Verschieben |
| `src/lib/types.ts` | `Todo`- und `Space`-Interface | **Niedrig** — keine Schemaänderung nötig |
| `firestore.rules` | create/update/delete-Regeln für `spaces/{id}/todos/{id}` (Z. 117–156) | **Hoch** — bestimmt, was beim Verschieben erlaubt ist (siehe §4/§5) |
| `tests/firestore-rules.test.mjs` | Regel-Tests für Todos | **Mittel** — Move-Verhalten (create im Ziel + delete in Quelle) absichern |

## 3. Bestehende Abhängigkeiten

- **`order`-Berechnung:** Im `TodosContext` wird `order` aus den **geladenen**
  Todos des aktiven Spaces als `maxOrder+1` bestimmt. Der Ziel-Space ist nicht
  geladen — sein `maxOrder` muss separat ermittelt werden (z. B.
  `query(todosCol(target), orderBy("order","desc"), limit(1))`).
- **`waitingOn`-Validierung:** `firestore.rules`' `hasValidWaitingOn()` verlangt,
  dass `waitingOn` `null` ist **oder** ein Mitglied **des Ziel-Spaces** (per
  `get()` auf das Ziel-Space-Dokument). Die Mitgliederliste des Ziels liegt
  bereits im Client vor (`spaces[].members`) — keine Extra-Leseoperation nötig,
  um die Gültigkeit vorab zu prüfen.
- **`tags`/`mentions`:** Werden bei `createTodo` aus title/body abgeleitet
  (`deriveTags`/`deriveMentions`). Beim Verschieben können die gespeicherten
  Werte 1:1 übernommen werden (keine Space-Abhängigkeit bei `tags`; `mentions`
  sind reine UIDs).
- **Live-Updates:** Nach dem Verschieben aktualisiert sich die Quell-Liste
  automatisch über die `onSnapshot`-Subscription (das Todo verschwindet). Der
  Ziel-Space wird beim nächsten Aktivieren neu geladen / serverseitig gezählt.
- **`openCounts`:** Werden für nicht-aktive Spaces einmalig serverseitig
  gezählt (`countedRef`). Ein verschobenes Todo erhöht den Open-Count des Ziels
  erst beim nächsten Zählen/Aktivieren — leichte, vorübergehende Ungenauigkeit
  des Badges (siehe Risiken).

## 4. Bekannte Einschränkungen

- **Kein Modal/Confirm-Primitive vorhanden.** Es gibt im Code keine generische
  Dialog-/Confirm-Komponente (nur `BottomSheet` und Popover-Muster). Die
  „Wartet auf geht verloren"-Bestätigung muss daher **inline** im Picker gelöst
  werden (zweistufig: Auswahl → Warnhinweis + „Trotzdem verschieben"), nicht über
  `window.confirm` (Browser-Dialoge sind unerwünscht).
- **`createdBy` ist beim Erstellen an den Schreibenden gebunden** (siehe §5,
  Risiko 1) — der wichtigste Constraint dieses Features.
- **Pfadgebundene `spaceId`:** Verschieben ist kein `updateDoc` — es erfordert
  zwingend ein neues Dokument im Ziel + Löschen in der Quelle.
- **Keine Transaktion über Collections nötig, aber Batch:** Ein `writeBatch`
  (set Ziel + delete Quelle) ist atomar und ausreichend; die `order`-Ermittlung
  ist ein vorgelagerter Lesevorgang außerhalb des Batches.

## 5. Risiken bei Änderung

1. **`createdBy` kann bei fremden Todos nicht erhalten bleiben (zentral).**
   Die Todo-`create`-Regel (Z. 145–149) verlangt
   `request.resource.data.createdBy == request.auth.uid`. Verschiebt Nutzer A
   ein von Nutzer B erstelltes Todo, müsste das Ziel-Dokument `createdBy == B`
   tragen — das lehnt die Regel ab. Konsequenzen/Optionen:
   - **(empfohlen) `createdBy` = verschiebender Nutzer setzen, `createdAt` (Original) erhalten.**
     Regelkonform ohne Rules-Änderung. Semantik: „A hat es hierher verschoben."
     `createdAt` wird von keiner Todo-Regel beschränkt und darf den Originalwert behalten.
   - `createdBy` **und** `createdAt` neu setzen (komplett „neu hier angelegt").
   - Regeln aufweichen, um Original-`createdBy` zu erlauben — **abgelehnt**, da
     das Fälschen von `createdBy` bei normalen Creates ermöglichen würde.
   → **Gewählte Lösung (siehe Anforderungsanalyse):** Neues Feld **`modifiedBy`**
   einführen. Die Todo-Regeln keyen den „wer schreibt"-Check künftig auf
   `modifiedBy == request.auth.uid` (create *und* update); `createdBy` bleibt
   damit beim Verschieben erhalten und unveränderlich. Zusätzlich verlangt die
   create-Regel `createdBy in <Ziel-Mitglieder>`, womit ein Todo nur in Spaces
   verschoben werden darf, in denen der **Ersteller** Mitglied ist (sonst
   client-seitige Rückmeldung). Folge: **alle** Todo-Schreibpfade müssen
   `modifiedBy` mitsetzen (Merge-Updates).
2. **Atomaritäts-/Konsistenzrisiko bei nicht-atomarer Umsetzung.** Würde man
   erst erstellen und dann löschen (zwei separate Writes), könnte ein Abbruch
   ein Duplikat hinterlassen. → Zwingend `writeBatch` verwenden.
3. **`waitingOn` wird im Ziel ungültig.** Zeigt `waitingOn` auf einen
   Nicht-Mitglied des Ziels, lehnt die Regel den Create ab. → Vorab im Client
   prüfen (`targetSpace.members.includes(todo.waitingOn)`), warnen und bei
   Bestätigung `waitingOn` auf `null` setzen (Konzept-Entscheidung).
4. **Open-Count-Badge des Ziels** ist kurzzeitig zu niedrig, bis der Ziel-Space
   neu gezählt wird. Geringes, rein kosmetisches Risiko; ggf. `setOpenCount`
   optimistisch anpassen.
5. **Berechtigungen:** Verschieben erfordert Mitgliedschaft in **Quelle** (für
   `delete`) und **Ziel** (für `create`). Da der Picker nur eigene Spaces zeigt,
   ist die Ziel-Mitgliedschaft gegeben; ein Schreibfehler muss dennoch sauber
   per `showError` abgefangen werden.
