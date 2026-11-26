import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.jsx';
import { OverviewPage } from './pages/Overview.jsx';
import { FlowMapPage } from './pages/FlowMap.jsx';
import { BrowsePage } from './pages/Browse.jsx';
import { BackupsPage } from './pages/Backups.jsx';
import { RotatePage } from './pages/Rotate.jsx';
import { SettingsPage } from './pages/Settings.jsx';
import { SeedsPage } from './pages/Seeds.jsx';
import { AnalyticsPage } from './pages/Analytics.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="flow" element={<FlowMapPage />} />
        <Route path="browse" element={<BrowsePage />} />
        <Route path="browse/:connectionId" element={<BrowsePage />} />
        <Route path="browse/:connectionId/:db" element={<BrowsePage />} />
        <Route path="browse/:connectionId/:db/:col" element={<BrowsePage />} />
        <Route path="seeds" element={<SeedsPage />} />
        <Route path="seeds/:seedId" element={<SeedsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="analytics/:dashboardId" element={<AnalyticsPage />} />
        <Route path="backups" element={<BackupsPage />} />
        <Route path="rotate" element={<RotatePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
