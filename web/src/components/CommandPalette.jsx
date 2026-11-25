import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  CornerDownLeft,
  FolderArchive,
  KeyRound,
  Moon,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { useTheme } from '../state/Theme.jsx';
import { NAV } from '../lib/nav.js';
import { EngineLogo } from './EngineLogo.jsx';
import { Kbd } from './ui.jsx';
import { cn } from '../lib/cn.js';
import { engineOf } from '../lib/engines.js';

const EVENT = 'bs:open-palette';
export function openPalette() {
  window.dispatchEvent(new Event(EVENT));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const navigate = useNavigate();
  const { connections, jobs, openSheet, openAssistant, refresh, checkHealth } = useApp();
  const { toggle } = useTheme();

  useEffect(() => {
    const show = () => {
      setOpen(true);
      setQ('');
      setActive(0);
    };
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQ('');
        setActive(0);
      }
      if ((e.metaKey || e.ctrlKey) && k === 'j') {
        e.preventDefault();
        openAssistant({});
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(EVENT, show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(EVENT, show);
    };
  }, [openAssistant]);

  const items = useMemo(() => {
    const all = [
      ...NAV.map((n) => ({ id: `nav-${n.to}`, group: 'Go to', label: n.label, icon: n.icon, run: () => navigate(n.to) })),
      { id: 'new-conn', group: 'Actions', label: 'New connection', icon: Plus, run: () => openSheet({ type: 'connection' }) },
      { id: 'new-job', group: 'Actions', label: 'New backup job', icon: FolderArchive, run: () => openSheet({ type: 'job', job: {} }) },
      { id: 'ask', group: 'Actions', label: 'Ask the assistant', hint: 'Ctrl J', icon: Sparkles, run: () => openAssistant({}) },
      {
        id: 'health',
        group: 'Actions',
        label: 'Check all connections',
        icon: Activity,
        run: async () => {
          await checkHealth();
          toast.success('Health check finished');
        },
      },
      { id: 'theme', group: 'Actions', label: 'Toggle light / dark', icon: Moon, run: toggle },
      { id: 'rotate', group: 'Actions', label: 'Rotate passwords (MongoDB)', icon: KeyRound, run: () => navigate('/rotate') },
      ...connections.map((c) => ({
        id: `c-${c.id}`,
        group: 'Connections',
        label: c.name,
        hint: engineOf(c.engine).label,
        logo: c.engine,
        run: () => navigate(`/browse/${c.id}`),
      })),
      ...jobs.flatMap((j) => [
        {
          id: `run-${j.id}`,
          group: 'Backup jobs',
          label: `Run “${j.name}” now`,
          icon: Play,
          run: async () => {
            toast.promise(API.jobs.run(j.id).then(refresh), { loading: `Backing up ${j.name}…`, success: 'Backup finished', error: (e) => e.message });
          },
        },
        { id: `edit-${j.id}`, group: 'Backup jobs', label: `Edit “${j.name}”`, icon: Pencil, run: () => openSheet({ type: 'job', job: j }) },
      ]),
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((i) => `${i.label} ${i.hint || ''} ${i.group}`.toLowerCase().includes(needle));
  }, [connections, jobs, openSheet, openAssistant, navigate, q, toggle, refresh, checkHealth]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (item) => {
    setOpen(false);
    item?.run?.();
  };

  let lastGroup = null;
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] bg-black/45 p-4 pt-[12vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ y: 8, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search size={16} className="text-subtle" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search pages, connections, jobs, actions…"
                className="h-12 w-full bg-transparent text-[14px] outline-none placeholder:text-subtle"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(items.length - 1, a + 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  }
                  if (e.key === 'Enter') go(items[active]);
                }}
              />
              <Kbd>Esc</Kbd>
            </div>
            <div ref={listRef} className="max-h-[52vh] overflow-auto p-1.5">
              {items.map((item, idx) => {
                const Icon = item.icon;
                const header = item.group !== lastGroup ? item.group : null;
                lastGroup = item.group;
                return (
                  <div key={item.id}>
                    {header ? <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium text-subtle">{header}</div> : null}
                    <button
                      type="button"
                      data-idx={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(item)}
                      className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px]', idx === active ? 'bg-surface-2 text-fg' : 'text-muted')}
                    >
                      {item.logo ? <EngineLogo engine={item.logo} size={15} /> : Icon ? <Icon size={15} className={idx === active ? 'text-primary' : ''} /> : null}
                      <span className="truncate">{item.label}</span>
                      {item.hint ? <span className="ml-auto text-[11px] text-subtle">{item.hint}</span> : null}
                      {idx === active ? <CornerDownLeft size={13} className={cn('text-subtle', item.hint ? 'ml-2' : 'ml-auto')} /> : null}
                    </button>
                  </div>
                );
              })}
              {!items.length ? <p className="px-3 py-8 text-center text-[13px] text-subtle">Nothing matches “{q}”</p> : null}
            </div>
            <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-subtle">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
              <span className="flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
              <span className="ml-auto flex items-center gap-1"><Kbd>Ctrl J</Kbd> assistant</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
