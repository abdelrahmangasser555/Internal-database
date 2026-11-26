import { NavLink, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useApp } from '../state/AppState.jsx';
import { rememberConnection } from '../lib/paths.js';
import { toolsFor } from '../lib/nav.js';
import { cn } from '../lib/cn.js';

export function ConnectionLayout() {
  const { connectionId } = useParams();
  const { connections, loading } = useApp();
  const location = useLocation();
  const conn = connections.find((c) => c.id === connectionId);

  useEffect(() => {
    if (connectionId) rememberConnection(connectionId);
  }, [connectionId]);

  if (loading) return null;
  if (!connections.length) return <Navigate to="/" replace />;
  if (!conn) return <Navigate to="/" replace />;

  const tools = toolsFor(conn);
  const section = location.pathname.split('/')[3] || 'overview';
  const fullBleed = section === 'explore' || section === 'flow';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-bg/70 px-3 py-1.5 backdrop-blur md:px-4">
        {tools.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={() => {
                const isActive = item.id === section;
                return cn(
                  'focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors',
                  isActive ? 'bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--line)]' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                );
              }}
            >
              {() => {
                const isActive = item.id === section;
                return (
                  <>
                    <Icon size={14} className={isActive ? 'text-primary' : ''} />
                    {item.label}
                  </>
                );
              }}
            </NavLink>
          );
        })}
      </nav>
      <div className={cn('min-h-0 flex-1', fullBleed ? 'overflow-hidden' : 'overflow-auto')}>
        <Outlet />
      </div>
    </div>
  );
}
