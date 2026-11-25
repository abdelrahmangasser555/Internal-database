import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Columns3,
  Database,
  FolderArchive,
  KeyRound,
  Network,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  Terminal,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Empty, Input, Select, Sheet, Skeleton, StatusDot, Tabs } from '../components/ui.jsx';
import { EngineLogo } from '../components/EngineLogo.jsx';
import { DataGrid, JsonView, documentsToGrid } from '../components/DataGrid.jsx';
import { ErDiagram } from '../components/explore/ErDiagram.jsx';
import { QueryPanel } from '../components/explore/QueryPanel.jsx';
import { bytes, compact } from '../lib/format.js';
import { engineOf, shortName } from '../lib/engines.js';
import { cn } from '../lib/cn.js';

const SYSTEM_DBS = ['admin', 'config', 'local'];

export function BrowsePage() {
  const { connectionId, db, col } = useParams();
  const object = col ? decodeURIComponent(col) : null;
  const navigate = useNavigate();
  const location = useLocation();
  const { connections, health, openSheet, openAssistant } = useApp();
  const [expanded, setExpanded] = useState({});
  const [dbs, setDbs] = useState({});
  const [objects, setObjects] = useState({});
  const [search, setSearch] = useState('');
  const conn = connections.find((c) => c.id === connectionId);
  const engine = conn?.engine || 'mongodb';

  const loadDbs = useCallback(async (id, force) => {
    if (!force && dbs[id]) return;
    try {
      const list = await API.connections.databases(id);
      setDbs((p) => ({ ...p, [id]: list }));
    } catch (err) {
      setDbs((p) => ({ ...p, [id]: { error: err.message } }));
    }
  }, [dbs]);

  const loadObjects = useCallback(async (id, name, force) => {
    const key = `${id}:${name}`;
    if (!force && objects[key]) return;
    try {
      const list = await API.connections.objects(id, name);
      setObjects((p) => ({ ...p, [key]: list }));
    } catch (err) {
      setObjects((p) => ({ ...p, [key]: { error: err.message } }));
    }
  }, [objects]);

  useEffect(() => {
    if (!connectionId) return;
    setExpanded((p) => ({ ...p, [connectionId]: true }));
    loadDbs(connectionId);
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !db) return;
    setExpanded((p) => ({ ...p, [`${connectionId}:${db}`]: true }));
    loadObjects(connectionId, db);
  }, [connectionId, db]);

  const go = (...parts) => navigate(`/browse/${parts.filter(Boolean).map(encodeURIComponent).join('/')}`);
  const term = search.trim().toLowerCase();

  return (
    <div className="flex h-full min-h-0">
      {/* Tree */}
      <aside className="hidden w-[272px] shrink-0 flex-col border-r border-line bg-bg-2/40 lg:flex">
        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="relative flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter tables…" className="h-8 pl-8 text-[12.5px]" />
          </div>
          <Button size="icon" variant="ghost" onClick={() => openSheet({ type: 'connection' })} title="New connection">
            <Plus size={15} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {connections.map((c) => {
            const open = expanded[c.id];
            const list = dbs[c.id];
            const h = health[c.id];
            return (
              <div key={c.id} className="mb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setExpanded((p) => ({ ...p, [c.id]: !open }));
                    loadDbs(c.id);
                    if (!open) go(c.id);
                  }}
                  className={cn('flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-[13px] hover:bg-surface-2', c.id === connectionId && !db && 'bg-surface-2')}
                >
                  <ChevronRight size={13} className={cn('shrink-0 text-subtle transition', open && 'rotate-90')} />
                  <EngineLogo engine={c.engine} size={15} />
                  <span className="truncate font-medium">{c.name}</span>
                  {h ? <StatusDot tone={h.ok ? 'ok' : 'fail'} className="ml-auto" /> : null}
                </button>
                {open ? (
                  <div className="ml-3.5 border-l border-line pl-1.5">
                    {!list ? <Skeleton className="my-1.5 ml-2 h-3 w-28" /> : null}
                    {list?.error ? <p className="px-2 py-1 text-[11.5px] text-danger">{list.error}</p> : null}
                    {Array.isArray(list)
                      ? list
                          .filter((d) => !SYSTEM_DBS.includes(d.name) || c.engine !== 'mongodb')
                          .map((d) => {
                            const key = `${c.id}:${d.name}`;
                            const dOpen = expanded[key];
                            const objs = objects[key];
                            const visible = Array.isArray(objs) ? objs.filter((o) => !term || o.name.toLowerCase().includes(term)) : objs;
                            return (
                              <div key={d.name}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpanded((p) => ({ ...p, [key]: !dOpen }));
                                    loadObjects(c.id, d.name);
                                    go(c.id, d.name);
                                  }}
                                  className={cn(
                                    'flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[12.5px] hover:bg-surface-2',
                                    c.id === connectionId && d.name === db && !object && 'bg-surface-2 text-fg',
                                  )}
                                >
                                  <ChevronRight size={12} className={cn('shrink-0 text-subtle transition', dOpen && 'rotate-90')} />
                                  <Database size={13} className="shrink-0 text-muted" />
                                  <span className="truncate">{d.name}</span>
                                  {d.primary ? <span className="ml-auto text-[10px] text-primary">default</span> : null}
                                </button>
                                {dOpen ? (
                                  <div className="ml-3 border-l border-line pl-1">
                                    {!objs ? <Skeleton className="my-1.5 ml-2 h-3 w-24" /> : null}
                                    {objs?.error ? <p className="px-2 py-1 text-[11.5px] text-danger">{objs.error}</p> : null}
                                    {Array.isArray(visible)
                                      ? visible.map((o) => (
                                          <button
                                            key={o.name}
                                            type="button"
                                            onClick={() => go(c.id, d.name, o.name)}
                                            className={cn(
                                              'flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[12.5px] text-muted hover:bg-surface-2 hover:text-fg',
                                              c.id === connectionId && d.name === db && o.name === object && 'bg-primary/12 text-fg',
                                            )}
                                          >
                                            <Table2 size={12.5} className={cn('shrink-0', o.type === 'view' ? 'text-info' : 'text-subtle')} />
                                            <span className="truncate">{shortName(o.name, c.engine)}</span>
                                            <span className="num ml-auto text-[10.5px] text-subtle">{o.rows != null ? compact(o.rows) : ''}</span>
                                          </button>
                                        ))
                                      : null}
                                    {Array.isArray(visible) && !visible.length ? <p className="px-2 py-1 text-[11.5px] text-subtle">{term ? 'No match' : 'Empty'}</p> : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })
                      : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!connections.length ? <p className="p-3 text-[12.5px] text-subtle">No connections yet.</p> : null}
        </div>
      </aside>

      {/* Main */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!conn ? (
          <ConnectionPicker />
        ) : !db ? (
          <DatabaseList conn={conn} list={dbs[conn.id]} onOpen={(name) => go(conn.id, name)} onRefresh={() => loadDbs(conn.id, true)} />
        ) : !object ? (
          <DatabaseView
            conn={conn}
            db={db}
            objects={objects[`${conn.id}:${db}`]}
            onOpen={(name) => go(conn.id, db, name)}
            onRefresh={() => loadObjects(conn.id, db, true)}
            initialTab={location.state?.tab}
            initialQuery={location.state?.query}
          />
        ) : (
          <ObjectView key={`${conn.id}:${db}:${object}`} conn={conn} db={db} object={object} engine={engine} onOpen={(name) => go(conn.id, db, name)} initialTab={location.state?.tab} />
        )}
      </section>
    </div>
  );
}

function Crumbs({ conn, db, object, actions }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <EngineLogo engine={conn.engine} size={18} tile />
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[12px] text-muted">
            <button type="button" className="hover:text-fg" onClick={() => navigate(`/browse/${conn.id}`)}>
              {conn.name}
            </button>
            {db ? (
              <>
                <ChevronRight size={12} />
                <button type="button" className="hover:text-fg" onClick={() => navigate(`/browse/${conn.id}/${encodeURIComponent(db)}`)}>
                  {db}
                </button>
              </>
            ) : null}
          </div>
          <h1 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{object ? shortName(object, conn.engine) : db || conn.name}</h1>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
    </div>
  );
}

function ConnectionPicker() {
  const { connections, health, openSheet } = useApp();
  const navigate = useNavigate();
  return (
    <div className="overflow-auto p-6 md:p-8">
      <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Explore</h1>
      <p className="mt-1 text-[13px] text-muted">Browse tables and collections, run read-only queries and see how your data connects.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {connections.map((c) => {
          const h = health[c.id];
          return (
            <button key={c.id} type="button" onClick={() => navigate(`/browse/${c.id}`)} className="card flex items-center gap-3 p-4 text-left transition hover:border-line-strong">
              <EngineLogo engine={c.engine} size={20} tile />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">{c.name}</div>
                <div className="truncate text-[11.5px] text-subtle">
                  {engineOf(c.engine).label} · {c.environment || 'production'}
                </div>
              </div>
              {h ? <StatusDot tone={h.ok ? 'ok' : 'fail'} /> : null}
            </button>
          );
        })}
        <button type="button" onClick={() => openSheet({ type: 'connection' })} className="flex items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-strong p-4 text-[13px] text-muted hover:border-primary hover:text-primary">
          <Plus size={15} /> New connection
        </button>
      </div>
    </div>
  );
}

function DatabaseList({ conn, list, onOpen, onRefresh }) {
  const { openSheet } = useApp();
  return (
    <>
      <Crumbs
        conn={conn}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={onRefresh}>
              <RefreshCw size={13} /> Refresh
            </Button>
            <Button size="sm" onClick={() => openSheet({ type: 'connection', connection: conn })}>
              Edit connection
            </Button>
          </>
        }
      />
      <div className="overflow-auto p-5">
        {!list ? <Skeleton className="h-20 w-full" /> : null}
        {list?.error ? <Empty icon={Database} title="Could not list databases" body={list.error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.isArray(list)
            ? list.map((d) => (
                <button key={d.name} type="button" onClick={() => onOpen(d.name)} className="card flex items-center gap-3 p-4 text-left hover:border-line-strong">
                  <span className="grid h-9 w-9 place-items-center rounded-md bg-primary/12 text-primary">
                    <Database size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{d.name}</span>
                    <span className="block text-[11.5px] text-subtle">{d.sizeOnDisk ? bytes(d.sizeOnDisk) : '—'}</span>
                  </span>
                  {d.primary ? <Badge tone="primary">default</Badge> : null}
                  <ArrowRight size={14} className="text-subtle" />
                </button>
              ))
            : null}
        </div>
      </div>
    </>
  );
}

function BackupHere({ conn, db, objects }) {
  const { openSheet } = useApp();
  return (
    <Button
      size="sm"
      onClick={() =>
        openSheet({
          type: 'job',
          job: { connectionId: conn.id, database: db, allCollections: !objects, collections: objects || [], name: `${conn.name} · ${db}` },
        })
      }
    >
      <FolderArchive size={13} /> Back up
    </Button>
  );
}

function DatabaseView({ conn, db, objects, onOpen, onRefresh, initialTab, initialQuery }) {
  const { openAssistant } = useApp();
  const [tab, setTab] = useState(initialTab || 'objects');
  const info = engineOf(conn.engine);
  const list = Array.isArray(objects) ? objects : [];
  const totalRows = list.reduce((s, o) => s + (o.rows || 0), 0);
  const totalSize = list.reduce((s, o) => s + (o.size || 0), 0);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, initialQuery]);

  return (
    <>
      <Crumbs
        conn={conn}
        db={db}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={onRefresh}>
              <RefreshCw size={13} />
            </Button>
            <Button size="sm" onClick={() => openAssistant({ connectionId: conn.id, db, mode: 'explain' })}>
              <Sparkles size={13} className="text-primary" /> Explain
            </Button>
            <BackupHere conn={conn} db={db} />
          </>
        }
      />
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2">
        <Tabs
          size="sm"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'objects', label: info.objects[0].toUpperCase() + info.objects.slice(1), icon: Table2, count: list.length },
            { id: 'diagram', label: 'Diagram', icon: Network },
            { id: 'query', label: 'Query', icon: Terminal },
          ]}
        />
        <span className="hidden text-[12px] text-subtle sm:block">
          ~{compact(totalRows)} records{totalSize ? ` · ${bytes(totalSize)}` : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'objects' ? (
          <div className="h-full overflow-auto p-5">
            {objects?.error ? <Empty icon={Table2} title="Could not list objects" body={objects.error} /> : null}
            {!objects ? <Skeleton className="h-32 w-full" /> : null}
            {list.length ? (
              <div className="card overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-left text-[11.5px] text-muted">
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 text-right font-medium">Rows</th>
                      <th className="px-4 py-2 text-right font-medium">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((o) => (
                      <tr key={o.name} onClick={() => onOpen(o.name)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2/60">
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2 font-medium">
                            <Table2 size={14} className="text-subtle" />
                            {shortName(o.name, conn.engine)}
                          </span>
                          {o.schema && o.schema !== 'public' && o.schema !== 'main' && o.schema !== 'dbo' ? <span className="ml-2 text-[11px] text-subtle">{o.schema}</span> : null}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={o.type === 'view' ? 'info' : 'muted'}>{o.type}</Badge>
                        </td>
                        <td className="num px-4 py-2.5 text-right text-muted">{o.rows != null ? o.rows.toLocaleString() : '—'}</td>
                        <td className="num px-4 py-2.5 text-right text-muted">{o.size ? bytes(o.size) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : objects && !objects.error ? (
              <Empty icon={Table2} title={`No ${info.objects} yet`} body="This database is empty." />
            ) : null}
          </div>
        ) : tab === 'diagram' ? (
          <ErDiagram connectionId={conn.id} db={db} engine={conn.engine} onOpen={onOpen} />
        ) : (
          <QueryPanel connectionId={conn.id} db={db} engine={conn.engine} object={list[0]?.name} initial={initialQuery} />
        )}
      </div>
    </>
  );
}

const OPS = [
  ['contains', 'contains'],
  ['eq', '='],
  ['neq', '≠'],
  ['gt', '>'],
  ['lt', '<'],
  ['null', 'is null'],
  ['notnull', 'is not null'],
];

function ObjectView({ conn, db, object, engine, onOpen, initialTab }) {
  const { openAssistant } = useApp();
  const navigate = useNavigate();
  const info = engineOf(engine);
  const isMongo = engine === 'mongodb';
  const [tab, setTab] = useState(initialTab || 'data');
  const [meta, setMeta] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState(null);
  const [draftFilter, setDraftFilter] = useState({ column: '', op: 'contains', value: '' });
  const [filter, setFilter] = useState(null);
  const [jsonFilter, setJsonFilter] = useState('');
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    API.connections
      .describe(conn.id, db, object)
      .then((m) => {
        setMeta(m);
        setDraftFilter((f) => ({ ...f, column: f.column || m.columns?.[1]?.name || m.columns?.[0]?.name || '' }));
      })
      .catch((err) => setMeta({ error: err.message }));
  }, [conn.id, db, object]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip, limit, sort: sort?.column, dir: sort?.dir };
      if (isMongo && jsonFilter.trim()) {
        JSON.parse(jsonFilter);
        params.filter = jsonFilter.trim();
      } else if (!isMongo && filter) params.filter = filter;
      setData(await API.connections.rows(conn.id, db, object, params));
    } catch (err) {
      toast.error(err instanceof SyntaxError ? 'Filter must be valid JSON' : err.message);
    } finally {
      setLoading(false);
    }
  }, [conn.id, db, object, skip, limit, sort, filter, isMongo, jsonFilter]);

  useEffect(() => {
    if (tab === 'data') load();
  }, [tab, skip, limit, sort, filter]);

  const grid = useMemo(() => {
    if (!data) return null;
    if (data.documents) return documentsToGrid(data.documents);
    return { columns: data.columns, rows: data.rows };
  }, [data]);

  const total = data?.total ?? data?.estimatedCount;
  const shown = grid?.rows.length || 0;

  return (
    <>
      <Crumbs
        conn={conn}
        db={db}
        object={object}
        actions={
          <>
            <Button size="sm" onClick={() => openAssistant({ connectionId: conn.id, db, focus: object, mode: 'query' })}>
              <Sparkles size={13} className="text-primary" /> Ask
            </Button>
            {isMongo ? (
              <Button size="sm" variant="ghost" onClick={() => navigate('/rotate', { state: { connectionId: conn.id, db, col: object } })}>
                <KeyRound size={13} /> Rotate
              </Button>
            ) : null}
            <BackupHere conn={conn} db={db} objects={[object]} />
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-2">
        <Tabs
          size="sm"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'data', label: isMongo ? 'Documents' : 'Data', icon: Table2 },
            { id: 'structure', label: isMongo ? 'Schema' : 'Structure', icon: Columns3, count: meta?.columns?.length },
            { id: 'query', label: 'Query', icon: Terminal },
            { id: 'diagram', label: 'Diagram', icon: Network },
          ]}
        />
        {tab === 'data' ? (
          isMongo ? (
            <form
              className="flex min-w-[280px] flex-1 items-center gap-1.5 md:max-w-xl"
              onSubmit={(e) => {
                e.preventDefault();
                setSkip(0);
                load();
              }}
            >
              <Input value={jsonFilter} onChange={(e) => setJsonFilter(e.target.value)} placeholder='{ "role": "admin" }' className="h-8 font-mono text-[12px]" />
              <Button size="sm" type="submit">
                Filter
              </Button>
            </form>
          ) : (
            <form
              className="flex flex-wrap items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                setSkip(0);
                setFilter(draftFilter.column ? { ...draftFilter } : null);
              }}
            >
              <Select value={draftFilter.column} onChange={(e) => setDraftFilter({ ...draftFilter, column: e.target.value })} className="h-8 w-40 text-[12.5px]">
                {(meta?.columns || []).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select value={draftFilter.op} onChange={(e) => setDraftFilter({ ...draftFilter, op: e.target.value })} className="h-8 w-28 text-[12.5px]">
                {OPS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              {!['null', 'notnull'].includes(draftFilter.op) ? (
                <Input value={draftFilter.value} onChange={(e) => setDraftFilter({ ...draftFilter, value: e.target.value })} placeholder="value" className="h-8 w-40 text-[12.5px]" />
              ) : null}
              <Button size="sm" type="submit">
                Filter
              </Button>
              {filter ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setFilter(null);
                    setSkip(0);
                  }}
                >
                  <X size={13} /> Clear
                </Button>
              ) : null}
            </form>
          )
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'data' ? (
          <div className="flex h-full flex-col">
            <div className="relative min-h-0 flex-1">
              {loading && !grid ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : grid ? (
                <DataGrid
                  className={cn('h-full', loading && 'opacity-60')}
                  columns={grid.columns}
                  rows={grid.rows}
                  primaryKey={data.primaryKey || (isMongo ? ['_id'] : [])}
                  sort={sort}
                  onSort={(c) => setSort((s) => (s?.column === c ? (s.dir === 'asc' ? { column: c, dir: 'desc' } : null) : { column: c, dir: 'asc' }))}
                  onRowClick={(row, i) => setPicked(data.documents ? data.documents[i] : Object.fromEntries(grid.columns.map((c, ci) => [c.name, row[ci]])))}
                />
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[12px] text-muted">
              <span className="num">
                {shown ? `${(skip + 1).toLocaleString()}–${(skip + shown).toLocaleString()}` : '0'} of {total != null ? total.toLocaleString() : '—'}
                {data && data.exact === false ? ' (estimate)' : ''}
              </span>
              <div className="flex items-center gap-1.5">
                <Select value={limit} onChange={(e) => (setSkip(0), setLimit(Number(e.target.value)))} className="h-7 w-28 text-[12px]">
                  {[25, 50, 100, 250].map((n) => (
                    <option key={n} value={n}>
                      {n} / page
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - limit))}>
                  <ArrowLeft size={13} />
                </Button>
                <Button size="sm" variant="ghost" disabled={shown < limit || (total != null && skip + shown >= total)} onClick={() => setSkip(skip + limit)}>
                  <ArrowRight size={13} />
                </Button>
              </div>
            </div>
          </div>
        ) : tab === 'structure' ? (
          <Structure meta={meta} engine={engine} onOpen={onOpen} />
        ) : tab === 'query' ? (
          <QueryPanel connectionId={conn.id} db={db} engine={engine} object={object} />
        ) : (
          <ErDiagram connectionId={conn.id} db={db} engine={engine} focus={object} onOpen={onOpen} />
        )}
      </div>

      <Sheet open={Boolean(picked)} title={isMongo ? 'Document' : 'Row'} subtitle={`${shortName(object, engine)} · read-only`} wide onClose={() => setPicked(null)}>
        {picked ? <JsonView value={picked} /> : null}
      </Sheet>
    </>
  );
}

function Structure({ meta, engine, onOpen }) {
  if (!meta) return <Skeleton className="m-5 h-40" />;
  if (meta.error) return <Empty icon={Columns3} title="Could not read the structure" body={meta.error} />;
  const isMongo = engine === 'mongodb';
  return (
    <div className="h-full space-y-5 overflow-auto p-5">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-[13px] font-semibold">{isMongo ? 'Fields' : 'Columns'}</h3>
          {isMongo ? <span className="text-[11.5px] text-subtle">Inferred from a sample of {meta.sampleSize} documents</span> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[11.5px] text-muted">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">{isMongo ? 'Present in' : 'Nullable'}</th>
                <th className="px-4 py-2 font-medium">{isMongo ? 'Example' : 'Default'}</th>
                <th className="px-4 py-2 font-medium">Keys</th>
              </tr>
            </thead>
            <tbody>
              {meta.columns.map((c) => {
                const fk = meta.foreignKeys?.find((f) => f.column === c.name);
                return (
                  <tr key={c.name} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">{c.name}</td>
                    <td className="px-4 py-2 font-mono text-[11.5px] text-muted">{c.type}</td>
                    <td className="px-4 py-2 text-muted">{isMongo ? `${c.presence}%` : c.nullable ? 'yes' : 'no'}</td>
                    <td className="max-w-[260px] truncate px-4 py-2 font-mono text-[11.5px] text-subtle">
                      {isMongo ? JSON.stringify(c.sample) : c.default ?? ''}
                      {c.identity ? 'identity' : ''}
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex flex-wrap gap-1">
                        {c.pk ? <Badge tone="warn">PK</Badge> : null}
                        {fk ? (
                          <button type="button" onClick={() => onOpen(fk.refTable)}>
                            <Badge tone="primary">
                              → {shortName(fk.refTable, engine)}.{fk.refColumn}
                            </Badge>
                          </button>
                        ) : c.fk ? (
                          <Badge tone="primary">FK</Badge>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-[13px] font-semibold">Indexes</h3>
        </div>
        <div className="divide-y divide-line">
          {(meta.indexes || []).map((i) => (
            <div key={i.name} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="text-[12.5px] font-medium">{i.name}</span>
              {i.primary ? <Badge tone="warn">primary</Badge> : i.unique ? <Badge tone="info">unique</Badge> : null}
              <code className="ml-auto max-w-full truncate font-mono text-[11px] text-subtle">{i.definition}</code>
            </div>
          ))}
          {!meta.indexes?.length ? <p className="px-4 py-3 text-[12.5px] text-subtle">No indexes.</p> : null}
        </div>
      </div>
    </div>
  );
}
