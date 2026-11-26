import { Database, Settings } from 'lucide-react';
import { BarChart3, FolderArchive, KeyRound, LayoutDashboard, Sprout, Workflow } from 'lucide-react';
import { connectionTools } from './paths.js';

export const GLOBAL_NAV = [
  { to: '/', label: 'Connections', icon: Database, end: true },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const TOOL_ICONS = {
  overview: LayoutDashboard,
  explore: Database,
  backups: FolderArchive,
  analytics: BarChart3,
  seeds: Sprout,
  flow: Workflow,
  rotate: KeyRound,
};

export function toolsFor(conn) {
  return connectionTools(conn).map((item) => ({ ...item, icon: TOOL_ICONS[item.id] }));
}

export const MOBILE_HOME = GLOBAL_NAV.filter((n) => n.to === '/');

export const MOBILE_TOOLS = ['overview', 'explore', 'backups', 'analytics', 'seeds'];
