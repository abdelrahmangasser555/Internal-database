import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Moon, Plus, Search, Sparkles, Sun } from 'lucide-react';
import { Toaster } from 'sonner';
import { useApp } from '../state/AppState.jsx';
import { useTheme } from '../state/Theme.jsx';
import { Button, Kbd, StatusDot } from './ui.jsx';
import { BrandMark } from './EngineLogo.jsx';
import { CommandPalette, openPalette } from './CommandPalette.jsx';
import { ConnectionSheet } from './ConnectionSheet.jsx';
import { JobSheet } from './JobSheet.jsx';
import { RecordSheet } from './RecordSheet.jsx';
import { RestoreSheet } from './RestoreSheet.jsx';
import { AssistantSheet } from './AssistantSheet.jsx';
import { cn } from '../lib/cn.js';
import { MOBILE_NAV, NAV } from '../lib/nav.js';

export { NAV };

const TITLES = {
  '': 'Overview',
  browse: 'Explore',
  seeds: 'Import seeds',
  analytics: 'Analytics',
  backups: 'Backups',
  flow: 'Flow',
  rotate: 'Password rotate',
  settings: 'Settings',
};

export function AppShell() {
  const { meta, openSheet, jobs, openAssistant } = useApp();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const running = jobs.filter((j) => j.running);
  const section = location.pathname.split('/')[1] || '';
  const fullBleed = section === 'browse' || section === 'flow';

  return (
    <div className="app-glow flex h-full min-h-screen">
      {/* Desktop side nav */}
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-dashed border-line-strong bg-bg-2 px-3 py-4 md:flex">
        <button type="button" onClick={() => navigate('/')} className="focus-ring mb-6 flex items-center gap-2.5 rounded-md px-2 text-left">
          <BrandMark size={30} />
          <span>
            <span className="block text-[14px] font-semibold tracking-[-0.01em]">Backup Service</span>
            <span className="block text-[11px] text-subtle">Backups · Explore · Restore</span>
          </span>
        </button>
        <button
          type="button"
          onClick={openPalette}
          className="focus-ring mb-4 flex h-9 items-center gap-2 rounded-sm border border-dashed border-line-strong bg-surface px-2.5 text-[12.5px] text-subtle hover:border-fg hover:text-fg"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search or jump…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'focus-ring flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                    isActive ? 'bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--line)]' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={16} className={isActive ? 'text-primary' : ''} />
                    {item.label}
                    {item.to === '/backups' && running.length ? <StatusDot tone="primary" pulse className="ml-auto" /> : null}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2">
          <Button variant="primary" className="w-full" onClick={() => openSheet({ type: 'connection' })}>
            <Plus size={15} /> New connection
          </Button>
          <div className="flex items-center justify-between rounded-md px-2 py-1 text-[11px] text-subtle">
            <span className="truncate" title={meta.device}>
              {meta.device || 'this device'} · {meta.platform || ''}
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-line bg-bg/70 px-4 backdrop-blur md:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="md:hidden">
              <BrandMark size={24} />
            </span>
            <h2 className="truncate text-[13.5px] font-semibold">{TITLES[section] || 'Backup Service'}</h2>
            {running.length ? (
              <span className="hidden items-center gap-1.5 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary-strong sm:inline-flex">
                <StatusDot tone="primary" pulse /> {running.length} backup{running.length > 1 ? 's' : ''} running
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={openPalette} className="md:hidden" aria-label="Search">
              <Search size={15} />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openAssistant({})} title="Assistant (Ctrl J)">
              <Sparkles size={14} className="text-primary" /> <span className="hidden sm:inline">Ask</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme" title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </Button>
          </div>
        </header>
        <main className={cn('min-h-0 flex-1 pb-16 md:pb-0', fullBleed ? 'overflow-hidden' : 'overflow-auto')}>
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-2 bottom-2 z-30 flex items-center justify-around rounded-sm border border-dashed border-line-strong bg-surface px-1 py-1 md:hidden" style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}>
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10.5px] font-medium', isActive ? 'text-primary' : 'text-muted')}
            >
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <CommandPalette />
      <ConnectionSheet />
      <JobSheet />
      <RecordSheet />
      <RestoreSheet />
      <AssistantSheet />
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          style: { background: 'var(--surface)', border: '1px solid var(--line-strong)', color: 'var(--fg)', fontSize: '13px' },
        }}
      />
    </div>
  );
}
