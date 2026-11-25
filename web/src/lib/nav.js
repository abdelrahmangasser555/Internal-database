import { Database, FolderArchive, KeyRound, LayoutDashboard, Settings, Workflow } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/browse', label: 'Explore', icon: Database },
  { to: '/backups', label: 'Backups', icon: FolderArchive },
  { to: '/flow', label: 'Flow', icon: Workflow },
  { to: '/rotate', label: 'Rotate', icon: KeyRound },
  { to: '/settings', label: 'Settings', icon: Settings },
];
