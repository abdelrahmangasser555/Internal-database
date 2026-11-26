import { BarChart3, Database, FolderArchive, KeyRound, LayoutDashboard, Settings, Sprout, Workflow } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/browse', label: 'Explore', icon: Database },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/seeds', label: 'Seeds', icon: Sprout },
  { to: '/backups', label: 'Backups', icon: FolderArchive },
  { to: '/flow', label: 'Flow', icon: Workflow },
  { to: '/rotate', label: 'Rotate', icon: KeyRound },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const MOBILE_NAV = NAV.filter((n) => ['/', '/browse', '/seeds', '/analytics', '/backups'].includes(n.to));
