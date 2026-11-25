import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, useEdgesState, useNodesState } from '@xyflow/react';
import { Plus, Workflow } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useTheme } from '../state/Theme.jsx';
import { nodeTypes } from '../components/flow/nodes.jsx';
import { buildPipeline } from '../lib/flow.js';
import { Button, Empty, Select } from '../components/ui.jsx';

export function FlowMapPage() {
  const { connections, jobs, records, openSheet } = useApp();
  const { theme } = useTheme();
  const [filter, setFilter] = useState('');
  const built = useMemo(() => buildPipeline({ connections, jobs, records, filterConnection: filter || null }), [connections, jobs, records, filter]);
  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);

  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_e, node) => {
      const d = node.data;
      if (node.type === 'source') openSheet({ type: 'connection', connection: d.conn });
      if (node.type === 'ghost') openSheet({ type: 'job', job: { connectionId: d.conn.id } });
      if (node.type === 'snapshot' || node.type === 'retention') openSheet({ type: 'job', job: d.job });
      if (node.type === 'storage') d.latest ? openSheet({ type: 'record', record: d.latest }) : openSheet({ type: 'job', job: d.job });
    },
    [openSheet],
  );

  const live = jobs.filter((j) => j.enabled).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-[-0.01em]">Backup pipeline</h1>
          <p className="text-[12.5px] text-muted">
            Source → snapshot → storage → retention. {live} of {jobs.length} jobs live. Click any step to edit it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-52 text-[12.5px]">
            <option value="">All connections</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="primary" onClick={() => openSheet({ type: 'job', job: {} })}>
            <Plus size={14} /> Add job
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
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.1} color="var(--line-strong)" />
            {nodes.length > 16 ? <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'source' ? n.data.conn.color : 'var(--surface-3)')} /> : null}
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : (
          <Empty
            className="mt-20"
            icon={Workflow}
            title="Nothing to draw yet"
            body="Add a connection and a backup job, and the pipeline appears here."
            action={
              <Button variant="primary" onClick={() => openSheet({ type: 'connection' })}>
                New connection
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
