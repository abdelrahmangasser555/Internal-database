import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { API } from '../api.js';

const AppState = createContext(null);

export function AppProvider({ children }) {
  const [meta, setMeta] = useState({});
  const [connections, setConnections] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(null);

  const refresh = useCallback(async () => {
    const [m, c, j, r] = await Promise.all([
      API.meta(),
      API.connections.list(),
      API.jobs.list(),
      API.records.list(),
    ]);
    setMeta(m);
    setConnections(c);
    setJobs(j);
    setRecords(r);
  }, []);

  useEffect(() => {
    refresh()
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
    const timer = setInterval(() => {
      API.jobs
        .list()
        .then(setJobs)
        .catch(() => {});
      API.records
        .list()
        .then(setRecords)
        .catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openSheet = useCallback((next) => setSheet(next), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const value = useMemo(
    () => ({
      meta,
      connections,
      jobs,
      records,
      loading,
      sheet,
      openSheet,
      closeSheet,
      refresh,
      setConnections,
      setJobs,
      setRecords,
    }),
    [meta, connections, jobs, records, loading, sheet, openSheet, closeSheet, refresh],
  );

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}

export function useApp() {
  const ctx = useContext(AppState);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
