import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './components/AppShell.jsx';
import { ConnectionLayout } from './components/ConnectionLayout.jsx';
import { ConnectionsPage } from './pages/Connections.jsx';
import { ConnectionHomePage } from './pages/ConnectionHome.jsx';
import { FlowMapPage } from './pages/FlowMap.jsx';
import { BrowsePage } from './pages/Browse.jsx';
import { BackupsPage } from './pages/Backups.jsx';
import { RotatePage } from './pages/Rotate.jsx';
import { SettingsPage } from './pages/Settings.jsx';
import { SeedsPage } from './pages/Seeds.jsx';
import { AnalyticsPage } from './pages/Analytics.jsx';
import { SchemasPage } from './pages/Schemas.jsx';
import { analyticsPath, backupsPath, connectionPath, explorePath, lastConnectionId, rotatePath, seedsPath } from './lib/paths.js';
import { useApp } from './state/AppState.jsx';

function fallbackConnectionId(connections) {
  return lastConnectionId() || connections[0]?.id || '';
}

function RedirectToConnection({ suffix }) {
  const { connections, loading } = useApp();
  if (loading) return null;
  const id = fallbackConnectionId(connections);
  if (!id) return <Navigate to="/" replace />;
  if (suffix === 'explore') return <Navigate to={explorePath(id)} replace />;
  if (suffix === 'backups') return <Navigate to={backupsPath(id)} replace />;
  if (suffix === 'analytics') return <Navigate to={analyticsPath(id)} replace />;
  if (suffix === 'seeds') return <Navigate to={seedsPath(id)} replace />;
  if (suffix === 'flow') return <Navigate to={connectionPath(id, 'flow')} replace />;
  if (suffix === 'rotate') {
    const mongo = connections.find((c) => c.id === id && (c.engine || 'mongodb') === 'mongodb') || connections.find((c) => (c.engine || 'mongodb') === 'mongodb');
    if (!mongo) return <Navigate to="/" replace />;
    return <Navigate to={rotatePath(mongo.id)} replace />;
  }
  return <Navigate to={connectionPath(id)} replace />;
}

function RedirectBrowse() {
  const { connectionId, db, col } = useParams();
  if (!connectionId) return <RedirectToConnection suffix="explore" />;
  return <Navigate to={explorePath(connectionId, db, col)} replace />;
}

function RedirectAnalytics() {
  const { dashboardId } = useParams();
  const { connections, loading } = useApp();
  if (loading) return null;
  const id = fallbackConnectionId(connections);
  if (!id) return <Navigate to="/" replace />;
  return <Navigate to={analyticsPath(id, dashboardId)} replace />;
}

function RedirectSeeds() {
  const { seedId } = useParams();
  const { connections, loading } = useApp();
  if (loading) return null;
  const id = fallbackConnectionId(connections);
  if (!id) return <Navigate to="/" replace />;
  return <Navigate to={seedsPath(id, seedId)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ConnectionsPage />} />
        <Route path="c/:connectionId" element={<ConnectionLayout />}>
          <Route index element={<ConnectionHomePage />} />
          <Route path="explore" element={<BrowsePage />} />
          <Route path="explore/:db" element={<BrowsePage />} />
          <Route path="explore/:db/:col" element={<BrowsePage />} />
          <Route path="backups" element={<BackupsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="analytics/:dashboardId" element={<AnalyticsPage />} />
          <Route path="seeds" element={<SeedsPage />} />
          <Route path="seeds/:seedId" element={<SeedsPage />} />
          <Route path="flow" element={<FlowMapPage />} />
          <Route path="rotate" element={<RotatePage />} />
        </Route>
        <Route path="settings" element={<SettingsPage />} />
        <Route path="schemas" element={<SchemasPage />} />
        <Route path="schemas/:schemaId" element={<SchemasPage />} />
        <Route path="browse" element={<RedirectBrowse />} />
        <Route path="browse/:connectionId" element={<RedirectBrowse />} />
        <Route path="browse/:connectionId/:db" element={<RedirectBrowse />} />
        <Route path="browse/:connectionId/:db/:col" element={<RedirectBrowse />} />
        <Route path="seeds" element={<RedirectSeeds />} />
        <Route path="seeds/:seedId" element={<RedirectSeeds />} />
        <Route path="analytics" element={<RedirectAnalytics />} />
        <Route path="analytics/:dashboardId" element={<RedirectAnalytics />} />
        <Route path="backups" element={<RedirectToConnection suffix="backups" />} />
        <Route path="flow" element={<RedirectToConnection suffix="flow" />} />
        <Route path="rotate" element={<RedirectToConnection suffix="rotate" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
