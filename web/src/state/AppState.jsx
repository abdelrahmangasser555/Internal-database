import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { API } from '../api.js';

const AppState = createContext(null);

export function AppProvider({ children }) {
  const [meta, setMeta] = useState({});
  const [connections, setConnections] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [records, setRecords] = useState([]);
  const [health, setHealth] = useState({});
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(null);
  const [assistant, setAssistant] = useState(null); // { connectionId, db, focus, mode, question }

  const refresh = useCallback(async () => {
    const [m, c, j, r] = await Promise.all([API.meta(), API.connections.list(), API.jobs.list(), API.records.list()]);
    setMeta(m);
    setConnections(c);
    setJobs(j);
    setRecords(r);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const rows = await API.connections.health();
      setHealth(Object.fromEntries(rows.map((r) => [r.id, r])));
    } catch {
      // keep last known
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
    checkHealth();
    const fast = setInterval(() => {
      API.jobs.list().then(setJobs).catch(() => {});
      API.records.list().then(setRecords).catch(() => {});
    }, 8000);
    const slow = setInterval(checkHealth, 90_000);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [refresh, checkHealth]);

  const openSheet = useCallback((next) => setSheet(next), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const openAssistant = useCallback((ctx = {}) => setAssistant({ mode: 'query', ...ctx }), []);
  const closeAssistant = useCallback(() => setAssistant(null), []);

  const value = useMemo(
    () => ({
      meta,
      connections,
      jobs,
      records,
      health,
      loading,
      sheet,
      openSheet,
      closeSheet,
      assistant,
      openAssistant,
      closeAssistant,
      refresh,
      checkHealth,
      setConnections,
      setJobs,
      setRecords,
    }),
    [meta, connections, jobs, records, health, loading, sheet, openSheet, closeSheet, assistant, openAssistant, closeAssistant, refresh, checkHealth],
  );

  return <AppState.Provider value={value}>{children}</AppState.Provider>;
}

export function useApp() {
  const ctx = useContext(AppState);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
