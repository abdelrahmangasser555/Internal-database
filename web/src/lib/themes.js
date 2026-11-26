/** Flat palettes. Tokens live in index.css under the same ids. No gradients. */
export const THEMES = [
  {
    id: 'dark',
    label: 'Graphite',
    note: 'Grey panels, bright type',
    scheme: 'dark',
    swatch: { bg: '#1a1a1a', surface: '#2e2e2e', fg: '#f4f4f4' },
  },
  {
    id: 'ink',
    label: 'Ink',
    note: 'Black field, white type',
    scheme: 'dark',
    swatch: { bg: '#000000', surface: '#1a1a1a', fg: '#ffffff' },
  },
  {
    id: 'slate',
    label: 'Slate',
    note: 'Blue-grey, sharp contrast',
    scheme: 'dark',
    swatch: { bg: '#0e1520', surface: '#1d2a40', fg: '#f2f7ff' },
  },
  {
    id: 'light',
    label: 'Paper',
    note: 'White field, black type',
    scheme: 'light',
    swatch: { bg: '#f3f3f3', surface: '#ffffff', fg: '#1e1e1e' },
  },
  {
    id: 'sand',
    label: 'Sand',
    note: 'Warm paper',
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
