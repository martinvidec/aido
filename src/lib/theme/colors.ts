/**
 * Person/Space color palette from the design handoff (issue #39).
 * Source: docs/design_handoff_aido_redesign/README.md → "Personen-/Space-Farben".
 *
 * Spaces store a color in the data model as an oklch hue (see issue #40,
 * `Space.color (oklch-Hue)`); new spaces cycle through this palette.
 */

export interface SpaceColor {
  /** oklch hue angle — the canonical value stored on a Space. */
  hue: number;
  /** Ready-to-use oklch() color string (lightness/chroma from the handoff). */
  value: string;
  /** Human-readable label from the handoff. */
  label: string;
}

export const SPACE_COLORS: readonly SpaceColor[] = [
  { hue: 200, value: "oklch(0.72 0.15 200)", label: "Teal" },
  { hue: 40, value: "oklch(0.72 0.15 40)", label: "Koralle" },
  { hue: 300, value: "oklch(0.65 0.14 300)", label: "Violett" },
  { hue: 160, value: "oklch(0.7 0.13 160)", label: "Grün" },
];

/** Pick a palette entry by index, wrapping around (e.g. for the Nth new space). */
export function getSpaceColor(index: number): SpaceColor {
  const len = SPACE_COLORS.length;
  return SPACE_COLORS[((index % len) + len) % len];
}

/**
 * Build an oklch color string from a stored hue. Uses the palette's exact
 * lightness/chroma when the hue is a known palette entry, otherwise falls back
 * to the default lightness/chroma.
 */
export function spaceColorFromHue(hue: number): string {
  const known = SPACE_COLORS.find((c) => c.hue === hue);
  return known ? known.value : `oklch(0.72 0.15 ${hue})`;
}
