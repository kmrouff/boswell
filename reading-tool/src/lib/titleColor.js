// A quiet, stable color per book title, drawn as a spine down the left edge
// of that title's group header. With every header painted in the same accent,
// a collapsed by-title list reads as a run of identical rows; a narrow band
// of color at the edge makes it read as a shelf of different books instead.
//
// The color is derived from the title string rather than stored anywhere, so
// a book keeps the same spine across devices and sessions with no column to
// add and nothing to migrate. The cost is that two titles can collide on a
// similar hue, which is acceptable here: the spine is a visual aid for
// scanning, never the thing that identifies a book.

// FNV-1a. Chosen over a naive char-sum because that would hand near-identical
// hues to titles sharing the same letters ("Emma" / "Mame"), which is exactly
// the case this is meant to tell apart.
const hashString = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

// Normalized so a title re-scanned with different casing or stray whitespace
// keeps its color, matching how the Library already groups titles.
export const titleHue = (title) => hashString(String(title || '').trim().toLowerCase()) % 360;

// Perceived brightness of an "R G B" theme-variable triple, on the same
// weighting theme.js already uses to pick legible text on an accent.
const luminanceOfTriple = (triple) => {
  const parts = String(triple).trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite)) return null;
  return 0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2];
};

// Muted rather than fully saturated: at five pixels wide a vivid hue reads as
// an alert, not as a bookbinding. The dark variant carries more saturation
// because hue is much harder to read at low lightness — matched on paper,
// the dark spines came out looking like identical dark marks.
const SPINE_SATURATION_DARK = 55;
const SPINE_SATURATION_PALE = 45;

// The spine sits on the accent-colored header, and the accent is both
// theme-dependent and user-overridable, so a single fixed lightness would
// vanish against some accents (the palette's own accents span roughly 98 to
// 182 in luminance). Picking one of two lightnesses off the accent's
// brightness keeps the spine legible against any of them.
const SPINE_LIGHTNESS_ON_LIGHT_ACCENT = 33;
const SPINE_LIGHTNESS_ON_DARK_ACCENT = 76;
const LIGHT_ACCENT_THRESHOLD = 140;

// accentTriple is the raw `--acc` custom property, e.g. "232 177 76".
export const titleSpineColor = (title, accentTriple) => {
  const lum = luminanceOfTriple(accentTriple);
  const onLightAccent = lum !== null && lum > LIGHT_ACCENT_THRESHOLD;
  const lightness = onLightAccent ? SPINE_LIGHTNESS_ON_LIGHT_ACCENT : SPINE_LIGHTNESS_ON_DARK_ACCENT;
  const saturation = onLightAccent ? SPINE_SATURATION_DARK : SPINE_SATURATION_PALE;
  return `hsl(${titleHue(title)} ${saturation}% ${lightness}%)`;
};
