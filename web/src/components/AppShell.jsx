import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Boxes, Plus, Search, Settings, Sparkles } from 'lucide-react';
import { Toaster } from 'sonner';
import { useApp } from '../state/AppState.jsx';
import { useTheme } from '../state/Theme.jsx';
import { Button, Kbd, StatusDot } from './ui.jsx';
import { ThemeMenu } from './ThemeMenu.jsx';
import { BrandMark, EngineLogo } from './EngineLogo.jsx';
import { CommandPalette, openPalette } from './CommandPalette.jsx';
import { ConnectionSheet } from './ConnectionSheet.jsx';
import { JobSheet } from './JobSheet.jsx';
import { RecordSheet } from './RecordSheet.jsx';
import { RestoreSheet } from './RestoreSheet.jsx';
import { AssistantSheet } from './AssistantSheet.jsx';
import { cn } from '../lib/cn.js';
import { MOBILE_TOOLS, toolsFor } from '../lib/nav.js';
import { connectionIdFromPath, connectionPath, rememberConnection } from '../lib/paths.js';
import { engineOf } from '../lib/engines.js';

export function AppShell() {
  const { meta, openSheet, jobs, openAssistant, connections, health } = useApp();
  const { scheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const connectionId = params.connectionId || connectionIdFromPath(location.pathname);
  const running = jobs.filter((j) => j.running);
  const conn = connections.find((c) => c.id === connectionId);
  const section = location.pathname.split('/')[1] || '';
  const tool = location.pathname.split('/')[3] || (connectionId ? 'overview' : '');
  const schemaStudio = location.pathname.startsWith('/schemas');
  const fullBleed = Boolean(connectionId) || schemaStudio;

  const title = conn ? conn.name : section === 'settings' ? 'Settings' : schemaStudio ? 'Schema builder' : 'Connections';

  const mobileTools = conn ? toolsFor(conn).filter((item) => MOBILE_TOOLS.includes(item.id)) : [];

  return (
    <div className="app-glow flex h-full min-h-screen">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-theme border-line-strong bg-bg-2 px-3 py-4 md:flex">
        <button type="button" onClick={() => navigate('/')} className="focus-ring mb-6 flex items-center gap-2.5 rounded-md px-2 text-left">
          <BrandMark size={30} />
          <span>
            <span className="block text-[14px] font-semibold tracking-[-0.01em]">Backup Service</span>
            <span className="block text-[11px] text-subtle">Connections first</span>
          </span>
        </button>
        <button
          type="button"
          onClick={openPalette}
          className="focus-ring mb-4 flex h-9 items-center gap-2 rounded-sm border border-theme border-line-strong bg-surface px-2.5 text-[12.5px] text-subtle hover:border-fg hover:text-fg"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search or jump…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <div className="mb-1.5 px-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">Connections</div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
          {connections.map((item) => {
            const h = health[item.id];
            const runningHere = jobs.some((j) => j.connectionId === item.id && j.running);
            const active = item.id === connectionId;
            return (
              <NavLink
                key={item.id}
                to={connectionPath(item.id)}
                onClick={() => rememberConnection(item.id)}
                className={cn(
                  'focus-ring flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                  active ? 'bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--line)]' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                )}
                title={`${item.name} · ${engineOf(item.engine).label}`}
              >
                <EngineLogo engine={item.engine} size={15} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {runningHere ? <StatusDot tone="primary" pulse /> : h ? <StatusDot tone={h.ok ? 'ok' : 'fail'} /> : null}
              </NavLink>
            );
          })}
          {!connections.length ? <p className="px-2 py-2 text-[12px] text-subtle">None yet. Add one below.</p> : null}
        </nav>
        <div className="mt-auto space-y-2 pt-3">
          <Button variant="primary" className="w-full" onClick={() => openSheet({ type: 'connection' })}>
            <Plus size={15} /> New connection
          </Button>
          <NavLink
            to="/schemas"
            className={({ isActive }) =>
              cn(
                'focus-ring flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium',
                isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
              )
            }
          >
            <Boxes size={15} /> Schemas
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                'focus-ring flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium',
                isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
              )
            }
          >
            Settings
          </NavLink>
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
            {conn ? <EngineLogo engine={conn.engine} size={16} className="hidden sm:block" /> : null}
            <h2 className="truncate text-[13.5px] font-semibold">{title}</h2>
            {conn ? <span className="hidden truncate text-[12px] text-subtle sm:inline">{engineOf(conn.engine).label}</span> : null}
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} className="md:hidden" aria-label="Settings">
              <Settings size={15} />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openAssistant(conn ? { connectionId: conn.id } : {})} title="Assistant (Ctrl J)">
              <Sparkles size={14} className="text-primary" /> <span className="hidden sm:inline">Ask</span>
            </Button>
            <ThemeMenu />
          </div>
        </header>
        <main className={cn('min-h-0 flex-1 pb-16 md:pb-0', fullBleed ? 'overflow-hidden' : 'overflow-auto')}>
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-2 bottom-2 z-30 flex items-center justify-around rounded-sm border border-theme border-line-strong bg-surface px-1 py-1 md:hidden" style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}>
        {conn
          ? mobileTools.map((item) => {
              const Icon = item.icon;
              const active = item.end ? tool === 'overview' : location.pathname.startsWith(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={cn('flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10.5px] font-medium', active ? 'text-primary' : 'text-muted')}
                >
                  <Icon size={18} />
                  {item.label}
                </NavLink>
              );
            })
          : [
              { to: '/', label: 'Connections', end: true },
              { to: '/schemas', label: 'Schemas' },
              { to: '/settings', label: 'Settings' },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10.5px] font-medium', isActive ? 'text-primary' : 'text-muted')}
              >
                {item.label}
              </NavLink>
            ))}
      </nav>

      <CommandPalette />
      <ConnectionSheet />
      <JobSheet />
      <RecordSheet />
      <RestoreSheet />
      <AssistantSheet />
      <Toaster
        theme={scheme}
        position="bottom-right"
        toastOptions={{
          style: { background: 'var(--surface)', border: '1px solid var(--line-strong)', color: 'var(--fg)', fontSize: '13px' },
        }}
      />
    </div>
  );
}
