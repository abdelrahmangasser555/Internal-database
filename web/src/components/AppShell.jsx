import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Database,
  FolderArchive,
  KeyRound,
  LayoutDashboard,
  Plus,
  Settings,
  Workflow,
} from 'lucide-react';
import { Toaster } from 'sonner';
import { useApp } from '../state/AppState.jsx';
import { Button } from './ui.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { ConnectionSheet } from './ConnectionSheet.jsx';
import { JobSheet } from './JobSheet.jsx';
import { RecordSheet } from './RecordSheet.jsx';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/flow', label: 'Flow', icon: Workflow },
  { to: '/browse', label: 'Browse', icon: Database },
  { to: '/backups', label: 'Backups', icon: FolderArchive },
  { to: '/rotate', label: 'Rotate', icon: KeyRound },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  const { meta, openSheet, jobs } = useApp();
  const location = useLocation();
  const running = jobs.some((j) => j.running);

  return (
    <div className="mesh flex h-full min-h-screen">
      <aside className="flex w-[84px] flex-col items-center border-r border-line bg-ink-2/80 py-4">
        <div
          className="mb-6 grid h-11 w-11 place-items-center rounded-full shadow-[0_0_0_4px_rgba(0,237,100,0.12)]"
          style={{ background: 'radial-gradient(circle at 30% 30%, #5dff9f, #00ed64 42%, #00684a)' }}
          title="Backup Service"
        />
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.label}
                className={({ isActive }) =>
                  `flex h-12 w-12 flex-col items-center justify-center rounded-2xl text-[10px] ${
                    isActive ? 'bg-leaf/15 text-leaf' : 'text-mist hover:bg-white/5 hover:text-foam'
                  }`
                }
              >
                <Icon size={18} />
                <span className="mt-1">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <Button
          variant="primary"
          className="h-11 w-11 rounded-2xl p-0"
          title="New connection"
          onClick={() => openSheet({ type: 'connection' })}
        >
          <Plus size={18} />
        </Button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-line bg-ink/40 px-5">
          <div>
            <div className="font-display text-sm font-semibold">Backup Service</div>
            <div className="text-[11px] text-mist">
              {meta.device || 'this device'}
              {meta.platform ? ` · ${meta.platform}` : ''}
              {running ? ' · backup running' : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-mist">
            <kbd className="rounded-lg border border-line bg-panel px-2 py-1 font-mono">Ctrl K</kbd>
            <span>{location.pathname === '/' ? 'Overview' : location.pathname.slice(1)}</span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <ConnectionSheet />
      <JobSheet />
      <RecordSheet />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#12222c',
            border: '1px solid rgba(148,178,188,0.16)',
            color: '#eef8f2',
          },
        }}
      />
    </div>
  );
}
