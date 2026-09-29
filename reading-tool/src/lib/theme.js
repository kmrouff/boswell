// Theme system: 4 palettes applied as CSS custom properties on the document
// root, so `rgb(var(--fg) / <alpha>)` works anywhere for translucent text/bg.
// Capture's camera-chrome intentionally stays outside this system (parchment
// on black scrims regardless of theme, per the handoff spec) — it keeps using
// the static ink/parchment Tailwind colors, untouched.

export const THEMES = {
  'Ink & Gold': {
    bg: '#100F0D', surface: '#16140F', raised: '#1A1814',
    fg: '232 213 176', acc: '232 177 76',
    fill: '232 213 176', onFill: '16 15 13', onAcc: '16 15 13',
  },
  'Warm Paper': {
    bg: '#ECE3D1', surface: '#F7F1E3', raised: '#F7F1E3',
    fg: '58 50 38', acc: '150 96 58',
    fill: '58 50 38', onFill: '247 241 227', onAcc: '247 241 227',
  },
  'Sage Study': {
    bg: '#161A15', surface: '#1D221B', raised: '#22271F',
    fg: '221 226 209', acc: '138 158 106',
    fill: '221 226 209', onFill: '22 26 21', onAcc: '22 26 21',
  },
  'Faded Linen': {
    bg: '#E9E3D6', surface: '#F3EEE2', raised: '#F3EEE2',
    fg: '70 62 54', acc: '124 106 140',
    fill: '70 62 54', onFill: '243 238 226', onAcc: '243 238 226',
  },
};

export const THEME_NAMES = Object.keys(THEMES);
export const DEFAULT_THEME = 'Warm Paper';
export const DEFAULT_RADIUS = 16;
export const ACCENT_SWATCHES = ['#96603A', '#8A9E6A', '#7C6A8C', '#B0785A', '#4E6E5D', '#E8B14C'];

const THEME_KEY = 'app_theme';
const ACCENT_KEY = 'app_accent';
const RADIUS_KEY = 'app_radius';

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const getStoredTheme = () => localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
export const setStoredTheme = (name) => localStorage.setItem(THEME_KEY, name);

export const getStoredAccent = () => localStorage.getItem(ACCENT_KEY) || null;
export const setStoredAccent = (hex) => {
  if (hex) localStorage.setItem(ACCENT_KEY, hex);
  else localStorage.removeItem(ACCENT_KEY);
};

export const getStoredRadius = () => {
  const v = localStorage.getItem(RADIUS_KEY);
  return v ? Number(v) : DEFAULT_RADIUS;
};
export const setStoredRadius = (n) => localStorage.setItem(RADIUS_KEY, String(n));

// Resolves the full token set for a theme name + optional accent override.
// When the accent is overridden, onAcc is recomputed from luminance so text
// on the accent color stays legible.
export const resolveTheme = (name, accentHex, radius) => {
  const t = { ...(THEMES[name] || THEMES[DEFAULT_THEME]) };
  if (accentHex) {
    const rgb = hexToRgb(accentHex);
    if (rgb) {
      t.acc = rgb.join(' ');
      const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      t.onAcc = lum > 150 ? '20 18 14' : '247 243 233';
    }
  }
  t.radius = `${radius ?? DEFAULT_RADIUS}px`;
  return t;
};

// Applies a resolved theme's tokens as CSS custom properties (defaults to
// document root) so `rgb(var(--fg) / .5)` etc. work anywhere in the app.
export const applyThemeVars = (t, el = document.documentElement) => {
  el.style.setProperty('--bg', t.bg);
  el.style.setProperty('--surface', t.surface);
  el.style.setProperty('--raised', t.raised);
  el.style.setProperty('--fg', t.fg);
  el.style.setProperty('--acc', t.acc);
  el.style.setProperty('--fill', t.fill);
  el.style.setProperty('--on-fill', t.onFill);
  el.style.setProperty('--on-acc', t.onAcc);
  el.style.setProperty('--radius', t.radius);
  // Themes are written straight onto the document root, so React never
  // re-renders on a theme change. Anything that has to *read* a token back
  // (rather than just referencing it in CSS) needs telling.
  window.dispatchEvent(new CustomEvent('theme-changed'));
};
