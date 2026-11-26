import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { THEMES, themeById } from '../lib/themes.js';

const ThemeCtx = createContext(null);

function resolve(pref) {
  if (pref === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return themeById(pref) ? pref : 'dark';
}

function schemeFor(id) {
  return themeById(id)?.scheme || 'dark';
}

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(() => localStorage.getItem('bs-theme') || 'dark');
  const [theme, setTheme] = useState(() => resolve(localStorage.getItem('bs-theme') || 'dark'));

  useEffect(() => {
    const apply = () => {
      const next = resolve(pref);
      setTheme(next);
      document.documentElement.dataset.theme = next;
      document.documentElement.dataset.scheme = schemeFor(next);
    };
    apply();
    localStorage.setItem('bs-theme', pref);
    if (pref !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);

  const toggle = useCallback(() => {
    setPref((current) => {
      const ids = THEMES.map((item) => item.id);
      const index = ids.indexOf(resolve(current));
      return ids[(index + 1) % ids.length];
    });
  }, []);

  const scheme = schemeFor(theme);
  const value = useMemo(() => ({ pref, theme, scheme, setPref, toggle }), [pref, theme, scheme, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}
