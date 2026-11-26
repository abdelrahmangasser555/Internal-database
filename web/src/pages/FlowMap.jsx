import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import { Archive, BarChart3, Plus, Sprout, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { useTheme } from '../state/Theme.jsx';
import { nodeTypes } from '../components/flow/nodes.jsx';
import { buildPipeline } from '../lib/flow.js';
import { Button, Empty, Field, Input, Select } from '../components/ui.jsx';

function FitView({ count }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const handle = setTimeout(() => fitView({ padding: 0.18, maxZoom: 1 }), 60);
    return () => clearTimeout(handle);
  }, [count, fitView]);
  return null;
}

export function FlowMapPage() {
  const { connections, jobs, records, openSheet } = useApp();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
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
    (conn) => navigate(`/analytics?connectionId=${encodeURIComponent(conn.id)}`),
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
      if (node.type === 'dashboard') navigate(`/analytics/${d.dashboard.id}`);
      if (node.type === 'seedlink') navigate(`/seeds/${d.seed.id}`, { state: { connectionId: d.binding.connectionId, database: d.binding.database } });
    },
    [openSheet, navigate],
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
    <div className="relative flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-dashed border-line px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-[17px] font-semibold tracking-[-0.01em]">Pipeline</h1>
          <p className="text-[12.5px] text-muted">
            {live} of {jobs.length} jobs live. Each source has Backup, Chart and Seed. Click a pinned node to open it again.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-52 text-[12.5px]">
            <option value="">All connections</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => openSheet({ type: 'job', job: {} })}>
            <Archive size={14} /> Backup
          </Button>
          <Button size="sm" onClick={() => navigate('/analytics')}>
            <BarChart3 size={14} /> Chart
          </Button>
          <Button size="sm" variant="primary" onClick={() => navigate('/seeds')}>
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
            colorMode={theme}
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
        <div className="absolute bottom-4 left-4 z-10 w-[340px] border border-dashed border-line-strong bg-surface p-3">
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
  );
}
