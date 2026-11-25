import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeCtx = createContext(null);

function resolve(pref) {
  if (pref === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return pref;
}

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(() => localStorage.getItem('bs-theme') || 'dark');
  const [theme, setTheme] = useState(() => resolve(localStorage.getItem('bs-theme') || 'dark'));

  useEffect(() => {
    const apply = () => {
      const next = resolve(pref);
      setTheme(next);
      document.documentElement.dataset.theme = next;
    };
    apply();
    localStorage.setItem('bs-theme', pref);
    if (pref !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);

  const toggle = useCallback(() => setPref((p) => (resolve(p) === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ pref, theme, setPref, toggle }), [pref, theme, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}
