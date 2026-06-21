/**
 * Fractional ordering for manual todo reordering (issue #235, epic #234).
 *
 * Todos are sorted by `order` (`orderBy("order","asc")`). To move a todo between
 * two neighbours we give it the midpoint of their `order` values, so a single
 * doc write repositions it. Repeatedly halving the same slot eventually exhausts
 * float precision; when two neighbours get closer than `ORDER_MIN_GAP`, callers
 * must renumber the list first (`normalizeTodoOrders`) instead of inserting.
 */

/** Spacing used when (re)numbering a list with clean integers. */
export const ORDER_STEP = 1;

/** Smallest neighbour gap we still subdivide; below this, normalize instead. */
export const ORDER_MIN_GAP = 1e-6;

/**
 * `order` for a todo inserted between `prev` and `next` — the `order` values of
 * its new neighbours, or `null` at a list edge. Returns `null` when the gap is
 * too small to subdivide safely: the caller must normalize the list and retry.
 */
export function orderBetween(prev: number | null, next: number | null): number | null {
  if (prev == null && next == null) return ORDER_STEP; // empty list
  if (prev == null) return next! - ORDER_STEP; // dropped at the top
  if (next == null) return prev + ORDER_STEP; // dropped at the end
  if (next - prev < ORDER_MIN_GAP) return null; // too tight → normalize
  return (prev + next) / 2; // between two items
}
