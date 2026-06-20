# Spezifikation: Todos in einen anderen Space verschieben

## 1. Übersicht

Implementiert das Verschieben eines einzelnen Todos aus seinem Space in einen
anderen Space des Nutzers. Technisch: atomares Anlegen im Ziel + Löschen in der
Quelle (`writeBatch`). Begleitend wird ein Feld **`modifiedBy`** eingeführt, das
den zuletzt schreibenden Nutzer festhält und auf das die Firestore-Regeln den
„wer schreibt"-Check umstellen — so bleibt der ursprüngliche `createdBy` beim
Verschieben erhalten, während die Regeln fälschungssicher bleiben. Basis:
[Konzept](01-konzept-todo-verschieben.md),
[Ist-Analyse](02-ist-analyse-todo-verschieben.md),
[Anforderungsanalyse](03-anforderungsanalyse-todo-verschieben.md).

## 2. Technisches Design

### 2.1 Architektur

Drei Schichten, von unten nach oben:

1. **Datenmodell + Regeln** — `modifiedBy`-Feld; Firestore-Regeln keyen auf
   `modifiedBy == auth.uid` und `createdBy in Ziel-Mitglieder`.
2. **Datenschicht** (`firebaseUtils.ts`) — alle Schreibpfade setzen `modifiedBy`;
   neue `moveTodoToSpace`-Funktion (Batch).
3. **State + UI** — `TodosContext.moveTodo(id, targetSpaceId)`; Eintrag
   „Verschieben →" in `TodoActions` (Desktop-Popover + Mobile-Sheet).

### 2.2 Datenmodell

**`src/lib/types.ts` — `Todo` erweitern:**

```ts
export interface Todo {
  // … bestehende Felder …
  createdBy: string;
  /** userId des zuletzt Schreibenden; rules erzwingen == auth.uid auf jedem Write. */
  modifiedBy: string;
  createdAt: Timestamp | null;
  order: number;
}
```

**`mapTodo` (firebaseUtils.ts)** — mit Legacy-Fallback auf `createdBy`:

```ts
modifiedBy:
  typeof data.modifiedBy === "string" ? data.modifiedBy
  : (typeof data.createdBy === "string" ? data.createdBy : ""),
```

Keine Schemaänderung an `Daily`/`Space`. Keine zwingende Datenmigration
(NFA-04): Bestand bekommt `modifiedBy` beim ersten Schreibvorgang.

### 2.3 Schnittstellen

**`firestore.rules` — `spaces/{spaceId}/todos/{todoId}` (Diff):**

```
// neu
function isValidModifiedBy() {
  return request.resource.data.modifiedBy == request.auth.uid;
}

allow create: if isMemberOfThisSpace()
  && isValidModifiedBy()
  && request.resource.data.createdBy in thisSpaceMembers()   // war: createdBy == auth.uid
  && hasValidTodoLists()
  && hasValidTodoFields()
  && hasValidWaitingOn();

allow update: if isMemberOfThisSpace()
  && request.resource.data.createdBy == resource.data.createdBy
  && isValidModifiedBy()                                      // neu
  && hasValidTodoLists()
  && hasValidTodoFields()
  && hasValidWaitingOn();
```

`thisSpaceMembers()` nutzt ein bereits gecachtes `get()` — kein Mehraufwand.

**`firebaseUtils.ts` — Schreibpfade (`modifiedBy` ergänzen, Signaturen um `uid`):**

```ts
// create: modifiedBy = uid mitschreiben
addDoc(todosCol(spaceId), { … , createdBy: uid, modifiedBy: uid, … });

// Updates erhalten den schreibenden uid und setzen modifiedBy mit:
editTodoContent(spaceId, todoId, title, body, uid, mentionMembers?)
  → updateDoc(ref, { title, body, tags, mentions, modifiedBy: uid });
setTodoCompleted(spaceId, todoId, completed, uid)
  → updateDoc(ref, { completed, modifiedBy: uid });
setTodoWaitingOn(spaceId, todoId, waitingOn, uid)
  → updateDoc(ref, { waitingOn, modifiedBy: uid });
setTodoStatus(spaceId, todoId, status, uid)
  → updateDoc(ref, { ...status, modifiedBy: uid });
```

**`firebaseUtils.ts` — neue Funktion `moveTodoToSpace`:**

```ts
export const moveTodoToSpace = async (
  todo: Todo,                 // Quelle steckt in todo.spaceId / todo.id
  targetSpaceId: string,
  uid: string,
  opts?: { clearWaitingOn?: boolean }
): Promise<string> => {
  if (!todo.spaceId || !targetSpaceId || !uid) throw new Error("Missing args.");
  const last = await getDocs(
    query(todosCol(targetSpaceId), orderBy("order", "desc"), limit(1))
  );
  const maxOrder = last.empty ? 0 : (last.docs[0].data().order ?? 0);
  const target = doc(todosCol(targetSpaceId)); // neue id
  const batch = writeBatch(db);
  batch.set(target, {
    spaceId: targetSpaceId,
    title: todo.title,
    body: todo.body ?? null,
    completed: todo.completed,
    waitingOn: opts?.clearWaitingOn ? null : todo.waitingOn,
    tags: todo.tags,
    mentions: todo.mentions,
    createdBy: todo.createdBy,          // Original-Autor erhalten
    createdAt: todo.createdAt ?? serverTimestamp(),
    modifiedBy: uid,
    order: maxOrder + 1,
  });
  batch.delete(todoRef(todo.spaceId, todo.id));
  await batch.commit();
  return target.id;
};
```

**`TodosContext.tsx` — neue Methode + uid an Updates durchreichen:**

```ts
// useSpaces zusätzlich: spaces
const moveTodo = useCallback(
  async (id: string, targetSpaceId: string): Promise<boolean> => {
    if (!user) return false;
    const todo = todos.find((t) => t.id === id);
    const target = spaces.find((s) => s.id === targetSpaceId);
    if (!todo || !target) return false;
    if (!target.members.includes(todo.createdBy)) {
      showError("Verschieben nicht möglich: der Ersteller hat keinen Zugriff auf diesen Space.");
      return false;
    }
    const clearWaitingOn = !!todo.waitingOn && !target.members.includes(todo.waitingOn);
    try {
      await moveTodoToSpace(todo, targetSpaceId, user.uid, { clearWaitingOn });
      showToast(`In „${target.name}" verschoben.`);
      return true;
    } catch (e) {
      console.error("moveTodo failed", e);
      showError("Todo konnte nicht verschoben werden.");
      return false;
    }
  },
  [user, todos, spaces, showToast, showError]
);
```

Alle bestehenden Context-Mutationen (`setCompleted`/`setWaitingOn`/`setStatus`/
`editContent`) übergeben künftig `user.uid` an die Utils.

**`TodoActions.tsx` — Eintrag „Verschieben →":**

- Bezieht `spaces` aus `useSpaces`, `moveTodo` aus `useTodos`.
- `targets = spaces.filter((s) => s.id !== todo.spaceId)`. Ist `targets` leer →
  Eintrag **nicht** rendern (FA-08).
- Collapsible-Submenü analog zu „Wartet auf …" (gleiche Klassen/`item`-Styles).
- Pro Ziel-Space:
  - `creatorHasAccess = target.members.includes(todo.createdBy)` — wenn `false`:
    Button **disabled** + dezenter Hinweis „Ersteller hat keinen Zugriff" (FA-06).
  - `losesWaiting = !!todo.waitingOn && !target.members.includes(todo.waitingOn)`
    — wenn `true`: Klick öffnet **inline-Bestätigung** im Submenü
    („‚Wartet auf {nameOf(todo.waitingOn)}' geht verloren — Trotzdem
    verschieben?" mit „Verschieben"/„Abbrechen"). Bestätigung → `moveTodo` +
    `onClose`.
  - sonst: Klick → `await moveTodo(todo.id, target.id); onClose();`
- Lokaler State: `moveOpen` (Submenü auf/zu), `confirmTarget` (spaceId | null).
- Farb-Punkt je Space optional über `spaceColorFromHue(target.color)`.

### 3. Implementierungsplan

#### 3.1 Änderungen pro Komponente

| Komponente | Änderung | Aufwand |
|---|---|---|
| `src/lib/types.ts` | `modifiedBy` zu `Todo` | Klein |
| `src/lib/firebase/firebaseUtils.ts` | `mapTodo` + `createTodo` + 4 Update-Fns (Signatur/`modifiedBy`) + neue `moveTodoToSpace` | Mittel |
| `src/lib/contexts/TodosContext.tsx` | `uid` an Updates, neue `moveTodo`-Methode, `spaces` aus `useSpaces` | Mittel |
| `firestore.rules` | `isValidModifiedBy` + create/update-Regeln | Klein |
| `src/components/shell/list/TodoActions.tsx` | „Verschieben →"-Submenü + Bestätigung/Feedback | Mittel |
| `tests/firestore-rules.test.mjs` | Bestehende Todo-Writes um `modifiedBy` ergänzen + neue Move-/Spoof-Tests | Mittel |
| `src/lib/firebase/firebaseUtils.ts` (`migrateLegacyTodos`) | `modifiedBy = createdBy` beim Migrieren mitsetzen (Admin, optional) | Klein |
| MCP (`src/lib/mcp/*` add/complete/waiting) | `modifiedBy` mitsetzen (Admin-SDK umgeht Regeln; Konsistenz) — prüfen | Klein |

#### 3.2 Reihenfolge der Implementierung

1. **`modifiedBy` einführen** (App): Typ, `mapTodo`, `createTodo`, alle
   Update-Pfade in `firebaseUtils` + `TodosContext`. (Issue A)
2. **Firestore-Regeln** auf `modifiedBy`/`createdBy in Mitglieder` umstellen +
   `firestore-rules`-Tests. **Deploy nach Schritt 1** (sonst lehnt die Regel die
   Updates alter Clients ab). (Issue B)
3. **`moveTodoToSpace` + `TodosContext.moveTodo`** (Datenoperation). (Issue C)
4. **Listen-UI** „Verschieben →" in `TodoActions` inkl. `waitingOn`-Bestätigung,
   Ersteller-Feedback und Bestätigungs-Toast. (Issue D)
5. *(optional, Folge)* Board-Support; Undo im Toast. (Issue E)

## 4. Testplan

**Firestore-Regeln (`tests/firestore-rules.test.mjs`, `npm run test:rules`):**
- Bestehende Todo-Create/Update-Tests um `modifiedBy = auth.uid` ergänzen
  (sonst schlagen sie unter den neuen Regeln fehl).
- Move erlaubt: Nutzer ist Mitglied von Quelle und Ziel, `createdBy` ist
  Mitglied des Ziels, `modifiedBy == auth.uid` → create im Ziel + delete in
  Quelle erlaubt.
- Move abgelehnt: `createdBy` **nicht** Mitglied des Ziels → create denied.
- Spoofing abgelehnt: `modifiedBy != auth.uid` (create und update) → denied.
- `waitingOn` im Ziel ungültig (Nicht-Mitglied) → denied; `null` → erlaubt.
- Regression: bestehende Update-Pfade (completed/waitingOn/edit) mit
  `modifiedBy` weiterhin erlaubt; Nicht-Mitglieder weiterhin abgewiesen.

**MCP-Tool-Tests (`npm run test:mcp`):** unverändert lauffähig; falls MCP-Writes
`modifiedBy` setzen, dort abdecken.

**Manuelle Tests:**
- Eigenes Todo in anderen Space verschieben → erscheint dort am Ende, weg aus
  Quelle, Toast erscheint, aktiver Space bleibt.
- Fremdes Todo verschieben, dessen Ersteller im Ziel Mitglied ist → erfolgreich,
  `createdBy` unverändert.
- Ziel, in dem der Ersteller kein Mitglied ist → Button disabled/Feedback.
- Todo mit `waitingOn` auf Nicht-Ziel-Mitglied → Bestätigung, danach `waitingOn`
  leer im Ziel.
- Nur ein Space vorhanden → kein „Verschieben →"-Eintrag.
- Desktop-Popover und Mobile-BottomSheet beide geprüft.

## 5. Migration / Deployment

- **Reihenfolge zwingend:** Zuerst die App mit `modifiedBy`-Schreibpfaden
  (Issue A) deployen (Vercel/`main`), **danach** die Regeln
  (`npx -y firebase-tools@13 deploy --only firestore:rules`, Issue B). Sonst
  würden bereits ausgelieferte alte Clients (ohne `modifiedBy`) bei jedem
  Todo-Update von der neuen Regel abgewiesen.
- Keine Datenmigration nötig; `modifiedBy` füllt sich lazy beim ersten Write.
- Move-Feature (Issue C/D) setzt voraus, dass die Regeln (B) deployed sind,
  damit auch **fremde** Todos verschoben werden können.

## 6. Referenzen

- [Konzeptdokument](01-konzept-todo-verschieben.md)
- [Ist-Analyse](02-ist-analyse-todo-verschieben.md)
- [Anforderungsanalyse](03-anforderungsanalyse-todo-verschieben.md)
