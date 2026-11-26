import { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { THEME_CHOICES } from '../lib/themes.js';
import { useTheme } from '../state/Theme.jsx';
import { Button } from './ui.jsx';
import { cn } from '../lib/cn.js';

export function ThemeMenu() {
  const { pref, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const current = THEME_CHOICES.find((item) => item.id === pref) || THEME_CHOICES[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={root}>
      <Button variant="ghost" size="icon" aria-label="Change theme" aria-expanded={open} title={current.label} onClick={() => setOpen((value) => !value)}>
        <Palette size={15} />
      </Button>
      {open ? (
        <div className="absolute right-0 top-10 z-40 w-64 border border-dashed border-line-strong bg-surface p-1.5">
          <div className="px-2 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">Theme</div>
          {THEME_CHOICES.map((item) => {
            const active = item.id === pref;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setPref(item.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-2 py-1.5 text-left hover:bg-surface-2',
                  active ? 'text-fg' : 'text-muted',
                )}
              >
                <span className="flex h-7 w-10 shrink-0 overflow-hidden border border-dashed border-line-strong">
                  <span className="flex-1" style={{ background: item.swatch.bg }} />
                  <span className="flex-1" style={{ background: item.swatch.surface }} />
                  <span className="w-1.5" style={{ background: item.swatch.fg }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-fg">{item.label}</span>
                  <span className="block truncate text-[11px] text-subtle">{item.note}</span>
                </span>
                {active ? <Check size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
