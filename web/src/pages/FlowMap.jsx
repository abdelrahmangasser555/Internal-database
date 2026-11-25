import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { useApp } from '../state/AppState.jsx';
import { nodeTypes } from '../components/flow/nodes.jsx';
import { buildFlow } from '../lib/flow.js';
import { Button } from '../components/ui.jsx';

export function FlowMapPage() {
  const { meta, connections, jobs, records, openSheet } = useApp();
  const built = useMemo(
    () => buildFlow({ meta, connections, jobs, records, compact: false }),
    [meta, connections, jobs, records],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);

  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_e, node) => {
      if (node.type === 'connection') openSheet({ type: 'connection', connection: node.data });
      if (node.type === 'job') openSheet({ type: 'job', job: node.data });
      if (node.type === 'archive' && node.data.record) openSheet({ type: 'record', record: node.data.record });
    },
    [openSheet],
  );

  return (
    <div className="flex h-full min-h-[calc(100vh-56px)] flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Backup flow</h1>
          <p className="text-sm text-mist">Click a node to open its sheet. Drag the canvas to explore.</p>
        </div>
        <Button onClick={() => openSheet({ type: 'job', job: {} })}>Add job</Button>
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          onNodeClick={onNodeClick}
          minZoom={0.4}
          maxZoom={1.6}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.1} color="rgba(138,163,173,0.28)" />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => (n.type === 'connection' ? n.data.color || '#00ed64' : '#1c3640')}
          />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
