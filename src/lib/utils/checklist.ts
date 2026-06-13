/** Counts task-list checkboxes in a Tiptap body → { done, total } (issues #45/#46). */
export function checklistProgress(body: unknown): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "taskItem") {
      total++;
      if (n.attrs?.checked) done++;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(body);
  return { done, total };
}
