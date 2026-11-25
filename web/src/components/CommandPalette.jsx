import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Database, FolderArchive, KeyRound, LayoutDashboard, Settings, Share2, Workflow } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';

const LINKS = [
  { id: 'overview', label: 'Overview', to: '/', icon: LayoutDashboard },
  { id: 'flow', label: 'Flow map', to: '/flow', icon: Workflow },
  { id: 'browse', label: 'Browse', to: '/browse', icon: Database },
  { id: 'backups', label: 'Backups', to: '/backups', icon: FolderArchive },
  { id: 'rotate', label: 'Password rotate', to: '/rotate', icon: KeyRound },
  { id: 'settings', label: 'Settings', to: '/settings', icon: Settings },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const { connections, openSheet } = useApp();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQ('');
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = useMemo(() => {
    const extra = connections.map((c) => ({
      id: c.id,
      label: c.name,
      hint: 'Connection',
      to: `/browse/${c.id}`,
      icon: Share2,
    }));
    const all = [
      ...LINKS,
      { id: 'new-conn', label: 'New connection', action: () => openSheet({ type: 'connection' }), icon: Share2 },
      { id: 'new-job', label: 'New backup job', action: () => openSheet({ type: 'job', job: {} }), icon: FolderArchive },
      ...extra,
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((item) => item.label.toLowerCase().includes(needle));
  }, [connections, openSheet, q]);

  const go = (item) => {
    setOpen(false);
    if (item.action) item.action();
    else if (item.to) navigate(item.to);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-start bg-black/50 p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-[#0f1e26] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Jump to a module, connection, or action"
              className="w-full border-b border-line bg-transparent px-4 py-3 text-sm outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && items[0]) go(items[0]);
              }}
            />
            <div className="max-h-80 overflow-auto p-2">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/5"
                  >
                    <Icon size={16} className="text-leaf" />
                    <span>{item.label}</span>
                    {item.hint ? <span className="ml-auto text-xs text-mist">{item.hint}</span> : null}
                  </button>
                );
              })}
              {!items.length ? <p className="px-3 py-6 text-center text-sm text-mist">Nothing matches</p> : null}
            </div>
            <div className="border-t border-line px-4 py-2 text-[11px] text-mist">Ctrl / ⌘ K</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
