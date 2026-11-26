import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { analyticsPath, rememberConnection, seedsPath } from '../lib/paths.js';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { Archive, BarChart3, Plus, Search, Sprout, Workflow, X } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { useTheme } from '../state/Theme.jsx';
import { nodeTypes } from '../components/flow/nodes.jsx';
import { buildPipeline } from '../lib/flow.js';
import { Button, Empty, Field, Input, Kbd, Select } from '../components/ui.jsx';
import { cn } from '../lib/cn.js';

function FitView({ count }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const handle = setTimeout(() => fitView({ padding: 0.18, maxZoom: 1 }), 60);
    return () => clearTimeout(handle);
  }, [count, fitView]);
  return null;
}

function flowHit(node) {
  const d = node.data || {};
  switch (node.type) {
    case 'source':
      return { id: node.id, title: d.conn?.name, hint: 'connection', hay: `${d.conn?.name} ${d.conn?.uriMasked || ''} ${d.conn?.engine || ''}` };
    case 'snapshot':
      return { id: node.id, title: d.job?.name, hint: d.job?.database || 'backup', hay: `${d.job?.name} ${d.job?.database || ''}` };
    case 'storage':
      return { id: node.id, title: d.job?.name ? `${d.job.name} files` : 'storage', hint: d.job?.targetPath || 'storage', hay: `${d.job?.name || ''} ${d.job?.targetPath || ''}` };
    case 'retention':
      return { id: node.id, title: d.job?.name ? `${d.job.name} retention` : 'retention', hint: 'retention', hay: d.job?.name || '' };
    case 'dashboard':
      return { id: node.id, title: d.dashboard?.name, hint: d.dashboard?.database || 'dashboard', hay: `${d.dashboard?.name} ${d.dashboard?.database || ''}` };
    case 'seedlink':
      return { id: node.id, title: d.seed?.name, hint: d.binding?.database || 'seed', hay: `${d.seed?.name} ${d.binding?.database || ''}` };
    case 'ghost':
      return { id: node.id, title: `Add backup · ${d.conn?.name || ''}`, hint: 'job', hay: d.conn?.name || '' };
    default:
      return null;
  }
}

function FlowSearch({ nodes }) {
  const { fitView, getNode, setNodes } = useReactFlow();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return nodes
      .map(flowHit)
      .filter((hit) => hit?.title && hit.hay.toLowerCase().includes(term))
      .slice(0, 24);
  }, [nodes, q]);

  const goTo = useCallback(
    (hit) => {
      if (!hit) return;
      setNodes((current) => current.map((n) => ({ ...n, selected: n.id === hit.id })));
      setOpen(false);
      setQ('');
      setActive(0);
      requestAnimationFrame(() => {
        const node = getNode(hit.id);
        if (node) fitView({ nodes: [node], padding: 0.4, duration: 380, maxZoom: 1.1 });
      });
    },
    [fitView, getNode, setNodes],
  );

  const openSearch = useCallback(() => {
    setOpen(true);
    setActive(0);
    requestAnimationFrame(() => ref.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        setOpen(false);
        setQ('');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min((hits.length || 1) - 1, i + 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
      if (e.key === 'Enter' && hits[active]) {
        e.preventDefault();
        goTo(hits[active]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hits, active, goTo, openSearch]);

  return (
    <div className="relative">
      <Button size="sm" variant={open ? 'primary' : 'secondary'} onClick={() => (open ? (setOpen(false), setQ('')) : openSearch())} aria-label="Search the map">
        <Search size={14} />
        <span className="hidden sm:inline">Search</span>
        <Kbd className="hidden sm:inline-flex">Ctrl</Kbd>
        <Kbd className="hidden sm:inline-flex">F</Kbd>
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-[min(calc(100vw-2.5rem),22rem)] overflow-hidden rounded-md border border-line bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-2.5">
            <Search size={13} className="shrink-0 text-subtle" />
            <Input
              ref={ref}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              placeholder="Find a connection, job or seed"
              className="h-9 border-0 bg-transparent px-0 shadow-none focus:ring-0"
              autoComplete="off"
            />
            <button type="button" className="shrink-0 text-subtle hover:text-fg" onClick={() => { setOpen(false); setQ(''); }} aria-label="Close search">
              <X size={13} />
            </button>
          </div>
          <ul className="max-h-[min(40vh,18rem)] overflow-y-auto py-1">
            {hits.map((hit, i) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => goTo(hit)}
                  onMouseEnter={() => setActive(i)}
                  className={cn('flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px]', i === active ? 'bg-primary/12 text-fg' : 'hover:bg-surface-2')}
                >
                  <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                  <span className="shrink-0 text-[10.5px] text-subtle">{hit.hint}</span>
                </button>
              </li>
            ))}
            {q.trim() && !hits.length ? <li className="px-2.5 py-3 text-[12px] text-subtle">Nothing on this map matches.</li> : null}
            {!q.trim() ? <li className="px-2.5 py-3 text-[12px] text-subtle">Type a connection, job, dashboard or seed.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function FlowMapPage() {
  const { connectionId: routeConnectionId } = useParams();
  const { connections, jobs, records, openSheet } = useApp();
  const { scheme } = useTheme();
  const navigate = useNavigate();
  const [filter, setFilter] = useState(routeConnectionId || '');

  useEffect(() => {
    if (routeConnectionId) {
      rememberConnection(routeConnectionId);
      setFilter(routeConnectionId);
    }
  }, [routeConnectionId]);
  const [dashboards, setDashboards] = useState([]);
  const [seeds, setSeeds] = useState([]);
  const [pin, setPin] = useState(null);
  const [pinSeedId, setPinSeedId] = useState('');
  const [pinDb, setPinDb] = useState('');
  const [pinDbs, setPinDbs] = useState([]);
  const [pinBusy, setPinBusy] = useState(false);

  const reloadPins = useCallback(async () => {
    const [boards, seedRows] = await Promise.all([API.dashboards.list().catch(() => []), API.seeds.list().catch(() => [])]);
    setDashboards(boards);
    setSeeds(seedRows);
  }, []);

  useEffect(() => {
    reloadPins();
  }, [reloadPins]);

  const built = useMemo(
    () => buildPipeline({ connections, jobs, records, dashboards, seeds, filterConnection: filter || null }),
    [connections, jobs, records, dashboards, seeds, filter],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);

  const onAddJob = useCallback((conn) => openSheet({ type: 'job', job: { connectionId: conn.id } }), [openSheet]);
  const onAddDashboard = useCallback(
    (conn) => navigate(analyticsPath(conn.id)),
    [navigate],
  );
  const onPinSeed = useCallback((conn) => {
    setPin(conn);
    setPinSeedId('');
    setPinDb('');
  }, []);

  useEffect(() => {
    setNodes(
      built.nodes.map((node) =>
        node.type === 'source' ? { ...node, data: { ...node.data, onAddJob, onAddDashboard, onPinSeed } } : node,
      ),
    );
    setEdges(built.edges);
  }, [built, setNodes, setEdges, onAddJob, onAddDashboard, onPinSeed]);

  useEffect(() => {
    if (!pin) return;
    API.connections
      .databases(pin.id)
      .then((rows) => {
        setPinDbs(rows);
        setPinDb((current) => current || (rows.find((row) => row.primary) || rows[0])?.name || (pin.engine === 'sqlite' ? 'main' : ''));
      })
      .catch(() => setPinDbs([]));
  }, [pin]);

  const onNodeClick = useCallback(
    (_e, node) => {
      const d = node.data;
      if (node.type === 'source') openSheet({ type: 'connection', connection: d.conn });
      if (node.type === 'ghost') openSheet({ type: 'job', job: { connectionId: d.conn.id } });
      if (node.type === 'snapshot' || node.type === 'retention') openSheet({ type: 'job', job: d.job });
      if (node.type === 'storage') d.latest ? openSheet({ type: 'record', record: d.latest }) : openSheet({ type: 'job', job: d.job });
      if (node.type === 'dashboard') navigate(analyticsPath(d.dashboard.connectionId || routeConnectionId, d.dashboard.id));
      if (node.type === 'seedlink') navigate(seedsPath(d.binding.connectionId, d.seed.id), { state: { connectionId: d.binding.connectionId, database: d.binding.database } });
    },
    [openSheet, navigate, routeConnectionId],
  );

  const savePin = async () => {
    if (!pin || !pinSeedId || !pinDb) return toast.error('Pick a seed and a database');
    setPinBusy(true);
    try {
      const full = await API.seeds.get(pinSeedId);
      const bindings = [...(full.bindings || [])];
      if (!bindings.some((b) => b.connectionId === pin.id && b.database === pinDb)) bindings.push({ connectionId: pin.id, database: pinDb });
      await API.seeds.save({
        id: full.id,
        name: full.name,
        description: full.description,
        notes: full.notes,
        payload: full.payload,
        bindings,
      });
      toast.success(`Pinned to ${pinDb}. Click the seed node to rerun it.`);
      setPin(null);
      await reloadPins();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPinBusy(false);
    }
  };

  const live = jobs.filter((j) => j.enabled).length;

  return (
    <ReactFlowProvider>
    <div className="relative flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-theme border-line px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-[17px] font-semibold tracking-[-0.01em]">Pipeline</h1>
          <p className="text-[12.5px] text-muted">
            {live} of {jobs.length} jobs live. Each source has Backup, Chart and Seed. Click a pinned node to open it again.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {routeConnectionId ? null : (
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-52 text-[12.5px]">
              <option value="">All connections</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <FlowSearch nodes={nodes} />
          <Button size="sm" onClick={() => openSheet({ type: 'job', job: { connectionId: routeConnectionId || filter || undefined }, lockConnection: Boolean(routeConnectionId) })}>
            <Archive size={14} /> Backup
          </Button>
          <Button size="sm" onClick={() => navigate(routeConnectionId ? analyticsPath(routeConnectionId) : '/analytics')}>
            <BarChart3 size={14} /> Chart
          </Button>
          <Button size="sm" variant="primary" onClick={() => navigate(routeConnectionId ? seedsPath(routeConnectionId) : '/seeds')}>
            <Sprout size={14} /> Seed
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {connections.length ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
            onNodeClick={onNodeClick}
            minZoom={0.3}
            maxZoom={1.6}
            nodesConnectable={false}
            colorMode={scheme}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Cross} gap={24} size={1} color="var(--line)" />
            {nodes.length > 16 ? <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'source' ? n.data.conn.color : 'var(--surface-3)')} /> : null}
            <Controls showInteractive={false} />
            <FitView count={nodes.length} />
          </ReactFlow>
        ) : (
          <Empty
            className="mt-20"
            icon={Workflow}
            title="Nothing to draw yet"
            body="Add a connection, then pin a backup, a visual dashboard, or a seed."
            action={
              <Button variant="primary" onClick={() => openSheet({ type: 'connection' })}>
                <Plus size={14} /> New connection
              </Button>
            }
          />
        )}
      </div>
      {pin ? (
        <div className="absolute bottom-4 left-4 z-10 w-[340px] border border-theme border-line-strong bg-surface p-3 shadow-card">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em]">Pin a seed</div>
          <p className="mt-1 text-[12px] text-muted">Save {pin.name} with a database. The node stays on the map so you can open and rerun it.</p>
          <div className="mt-3 space-y-2">
            <Field label="Seed">
              <Select value={pinSeedId} onChange={(e) => setPinSeedId(e.target.value)}>
                <option value="">Choose a seed</option>
                {seeds.map((seed) => (
                  <option key={seed.id} value={seed.id}>
                    {seed.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Database">
              {pinDbs.length ? (
                <Select value={pinDb} onChange={(e) => setPinDb(e.target.value)}>
                  {pinDbs.map((db) => (
                    <option key={db.name} value={db.name}>
                      {db.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={pinDb} onChange={(e) => setPinDb(e.target.value)} className="font-mono" />
              )}
            </Field>
          </div>
          {!seeds.length ? <p className="mt-2 text-[12px] text-subtle">Import a seed first, then come back and pin it.</p> : null}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" loading={pinBusy} onClick={savePin}>
              Save pin
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPin(null)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
    </ReactFlowProvider>
  );
}
