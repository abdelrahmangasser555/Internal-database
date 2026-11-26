/** Full brand kits. Colour, type, radius, stroke and shadow live in index.css under the same ids. */
export const THEMES = [
  {
    id: 'dark',
    label: 'Graphite',
    note: 'Segoe UI · square · dashed',
    scheme: 'dark',
    swatch: { bg: '#1a1a1a', surface: '#2e2e2e', fg: '#f4f4f4' },
  },
  {
    id: 'ink',
    label: 'Ink',
    note: 'IBM Plex · sharp · hairline',
    scheme: 'dark',
    swatch: { bg: '#000000', surface: '#1a1a1a', fg: '#ffffff' },
  },
  {
    id: 'slate',
    label: 'Slate',
    note: 'Inter · 8px · lifted',
    scheme: 'dark',
    swatch: { bg: '#0e1520', surface: '#1d2a40', fg: '#f2f7ff' },
  },
  {
    id: 'light',
    label: 'Paper',
    note: 'Source Serif · 4px · paper',
    scheme: 'light',
    swatch: { bg: '#f3f3f3', surface: '#ffffff', fg: '#1e1e1e' },
  },
  {
    id: 'sand',
    label: 'Sand',
    note: 'Figtree · pill · warm',
    scheme: 'light',
    swatch: { bg: '#f4efe6', surface: '#fffdf8', fg: '#1c1612' },
  },
];

export const THEME_CHOICES = [
  ...THEMES,
  {
    id: 'system',
    label: 'System',
    note: 'Follow Windows',
    scheme: 'dark',
    swatch: { bg: '#1a1a1a', surface: '#f3f3f3', fg: '#1e1e1e' },
  },
];

export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) || null;
}
