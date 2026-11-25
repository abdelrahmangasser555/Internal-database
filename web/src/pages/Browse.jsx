import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Database, KeyRound, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, Empty, Input, Sheet } from '../components/ui.jsx';
import { bytes, cell } from '../lib/format.js';

export function BrowsePage() {
  const { connectionId, db, col } = useParams();
  const navigate = useNavigate();
  const { connections, openSheet } = useApp();
  const [expanded, setExpanded] = useState({});
  const [dbs, setDbs] = useState({});
  const [cols, setCols] = useState({});
  const [docs, setDocs] = useState(null);
  const [skip, setSkip] = useState(0);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState(null);
  const [stats, setStats] = useState(null);

  const selectedConn = connections.find((c) => c.id === connectionId);

  useEffect(() => {
    if (!connectionId) return;
    setExpanded((prev) => ({ ...prev, [connectionId]: true }));
    API.connections
      .databases(connectionId)
      .then((list) => setDbs((prev) => ({ ...prev, [connectionId]: list })))
      .catch((err) => toast.error(err.message));
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !db) return;
    const key = `${connectionId}:${db}`;
    setExpanded((prev) => ({ ...prev, [key]: true }));
    API.connections
      .collections(connectionId, db)
      .then((list) => setCols((prev) => ({ ...prev, [key]: list })))
      .catch((err) => toast.error(err.message));
  }, [connectionId, db]);

  useEffect(() => {
    if (!connectionId || !db || !col) {
      setDocs(null);
      setStats(null);
      return;
    }
    let query = `?skip=${skip}&limit=50`;
    if (filter.trim()) {
      try {
        JSON.parse(filter);
        query += `&filter=${encodeURIComponent(filter)}`;
      } catch {
        toast.error('Filter must be JSON');
        return;
      }
    }
    API.connections
      .documents(connectionId, db, col, query)
      .then(setDocs)
      .catch((err) => toast.error(err.message));
    API.connections
      .stats(connectionId, db, col)
      .then(setStats)
      .catch(() => setStats(null));
  }, [connectionId, db, col, skip, filter]);

  const keys = useMemo(() => {
    const found = [];
    for (const doc of docs?.documents || []) {
      for (const key of Object.keys(doc)) {
        if (!found.includes(key) && found.length < 8) found.push(key);
      }
    }
    return found;
  }, [docs]);

  return (
    <div className="flex h-full min-h-[calc(100vh-56px)]">
      <aside className="w-[280px] shrink-0 overflow-auto border-r border-line bg-ink-2/50 p-3">
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="text-[11px] uppercase tracking-[0.16em] text-mist">Connections</span>
          <Button variant="quiet" className="h-8 px-2" onClick={() => openSheet({ type: 'connection' })}>
            New
          </Button>
        </div>
        {!connections.length ? (
          <p className="px-2 text-sm text-mist">None yet</p>
        ) : (
          connections.map((conn) => (
            <div key={conn.id} className="mb-1">
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm ${
                  connectionId === conn.id && !db ? 'bg-white/8' : 'hover:bg-white/5'
                }`}
                onClick={async () => {
                  navigate(`/browse/${conn.id}`);
                  const next = !expanded[conn.id];
                  setExpanded((prev) => ({ ...prev, [conn.id]: next }));
                  if (next && !dbs[conn.id]) {
                    try {
                      const list = await API.connections.databases(conn.id);
                      setDbs((prev) => ({ ...prev, [conn.id]: list }));
                    } catch (err) {
                      toast.error(err.message);
                    }
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openSheet({ type: 'connection', connection: conn });
                }}
              >
                <ChevronRight size={14} className={`text-mist transition ${expanded[conn.id] ? 'rotate-90' : ''}`} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: conn.color || '#00ed64' }} />
                <span className="truncate">{conn.name}</span>
              </button>
              {expanded[conn.id]
                ? (dbs[conn.id] || []).map((database) => {
                    const key = `${conn.id}:${database.name}`;
                    return (
                      <div key={database.name} className="ml-3">
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${
                            db === database.name ? 'bg-white/8' : 'hover:bg-white/5'
                          }`}
                          onClick={async () => {
                            navigate(`/browse/${conn.id}/${encodeURIComponent(database.name)}`);
                            const next = !expanded[key];
                            setExpanded((prev) => ({ ...prev, [key]: next }));
                            if (next && !cols[key]) {
                              try {
                                const list = await API.connections.collections(conn.id, database.name);
                                setCols((prev) => ({ ...prev, [key]: list }));
                              } catch (err) {
                                toast.error(err.message);
                              }
                            }
                          }}
                        >
                          <ChevronRight
                            size={12}
                            className={`text-mist transition ${expanded[key] ? 'rotate-90' : ''}`}
                          />
                          <Database size={13} className="text-sky" />
                          <span className="truncate">{database.name}</span>
                        </button>
                        {expanded[key]
                          ? (cols[key] || []).map((collection) => (
                              <button
                                key={collection.name}
                                type="button"
                                className={`ml-7 flex w-[calc(100%-1.75rem)] items-center rounded-lg px-2 py-1 text-left text-xs ${
                                  col === collection.name ? 'bg-leaf/15 text-leaf' : 'text-mist hover:bg-white/5 hover:text-foam'
                                }`}
                                onClick={() => {
                                  setSkip(0);
                                  navigate(
                                    `/browse/${conn.id}/${encodeURIComponent(database.name)}/${encodeURIComponent(collection.name)}`,
                                  );
                                }}
                              >
                                {collection.name}
                              </button>
                            ))
                          : null}
                      </div>
                    );
                  })
                : null}
            </div>
          ))
        )}
      </aside>
      <section className="min-w-0 flex-1 overflow-auto p-5">
        {!col ? (
          <Empty
            icon={Database}
            title={selectedConn ? `Browse ${selectedConn.name}` : 'Select a collection'}
            body="This explorer is read-only. Right-click a connection to edit it. Backup and rotate live in their own modules."
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-mist">
                  {selectedConn?.name} / {db} / {col}
                </div>
                <h1 className="font-display text-2xl font-semibold">Documents</h1>
                <p className="text-sm text-mist">
                  {docs?.estimatedCount ?? '—'} estimated
                  {stats?.size ? ` · ${bytes(stats.size)}` : ''}
                  {' · read-only'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    openSheet({ type: 'job', job: { connectionId, database: db, collections: [col] } })
                  }
                >
                  Backup here
                </Button>
                <Button
                  variant="primary"
                  onClick={() =>
                    navigate('/rotate', { state: { connectionId, db, col } })
                  }
                >
                  <KeyRound size={14} /> Rotate
                </Button>
              </div>
            </div>
            <div className="mb-3 flex gap-2">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder='Filter JSON e.g. {"status":"active"}'
                className="font-mono"
              />
              <Button
                onClick={() => {
                  setSkip(0);
                  setFilter((v) => v);
                }}
              >
                <RefreshCw size={14} />
              </Button>
            </div>
            <Card className="overflow-hidden p-0">
              <div className="overflow-auto">
                <table className="min-w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-[#16303b] text-mist">
                    <tr>
                      {keys.map((k) => (
                        <th key={k} className="px-3 py-2 font-medium">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(docs?.documents || []).map((doc, i) => (
                      <tr
                        key={i}
                        className="cursor-pointer border-t border-line hover:bg-white/5"
                        onClick={() => setPicked(doc)}
                      >
                        {keys.map((k) => (
                          <td key={k} className="max-w-[240px] truncate px-3 py-2">
                            {cell(doc[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-mist">
                <Button disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - 50))}>
                  Previous
                </Button>
                <span>
                  {skip + 1}–{skip + (docs?.documents?.length || 0)} of {docs?.estimatedCount ?? '—'}
                </span>
                <Button
                  disabled={skip + (docs?.documents?.length || 0) >= (docs?.estimatedCount || 0)}
                  onClick={() => setSkip(skip + 50)}
                >
                  Next
                </Button>
              </div>
            </Card>
          </>
        )}
      </section>
      <Sheet
        open={Boolean(picked)}
        title="Document"
        subtitle="Read-only JSON"
        wide
        onClose={() => setPicked(null)}
      >
        {picked ? (
          <pre className="overflow-auto rounded-xl bg-ink-2 p-4 font-mono text-xs leading-6 text-mint">
            {JSON.stringify(picked, null, 2)}
          </pre>
        ) : null}
      </Sheet>
    </div>
  );
}
