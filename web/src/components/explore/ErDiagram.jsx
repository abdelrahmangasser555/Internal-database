import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { KeyRound, Link2, Network } from 'lucide-react';
import { API } from '../../api.js';
import { useTheme } from '../../state/Theme.jsx';
import { shortName } from '../../lib/engines.js';
import { compact } from '../../lib/format.js';
import { Empty, Spinner } from '../ui.jsx';
import { cn } from '../../lib/cn.js';

const MAX_COLS = 14;
const ROW_H = 24;
const HEAD_H = 44;
const WIDTH = 260;

function TableNode({ data, selected }) {
  const cols = data.columns.slice(0, MAX_COLS);
  return (
    <div
      className={cn('overflow-hidden rounded-[12px] border bg-surface shadow-[var(--shadow)]', data.focus ? 'border-primary' : 'border-line')}
      style={{ width: WIDTH, boxShadow: selected || data.focus ? '0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent)' : undefined }}
    >
      <div className="flex h-11 items-center justify-between gap-2 border-b border-line bg-surface-2 px-3">
        <span className="truncate text-[12.5px] font-semibold">{data.label}</span>
        <span className="num shrink-0 text-[10.5px] text-subtle">{compact(data.rows)} rows</span>
      </div>
      {cols.map((c) => (
        <div key={c.name} className="relative flex items-center gap-2 px-3 text-[11.5px]" style={{ height: ROW_H }}>
          <Handle type="target" id={`${c.name}-t`} position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-transparent" />
          <span className="w-3.5 shrink-0">
            {c.pk ? <KeyRound size={11} className="text-warn" /> : c.fk ? <Link2 size={11} className="text-primary" /> : null}
          </span>
          <span className={cn('truncate', c.pk && 'font-medium')}>{c.name}</span>
          <span className="ml-auto max-w-[110px] truncate font-mono text-[10.5px] text-subtle">{c.type}</span>
          <Handle type="source" id={`${c.name}-s`} position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-transparent" />
        </div>
      ))}
      {data.columns.length > MAX_COLS ? <div className="px-3 py-1 text-[10.5px] text-subtle">+{data.columns.length - MAX_COLS} more</div> : null}
    </div>
  );
}

const nodeTypes = { table: TableNode };

function layout(graph, engine, focus) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 110, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const height = (t) => HEAD_H + Math.min(t.columns.length, MAX_COLS) * ROW_H + (t.columns.length > MAX_COLS ? 22 : 0) + 4;
  for (const t of graph.tables) g.setNode(t.name, { width: WIDTH, height: height(t) });
  for (const r of graph.relations) if (g.hasNode(r.from) && g.hasNode(r.to)) g.setEdge(r.from, r.to);
  dagre.layout(g);
  const nodes = graph.tables.map((t) => {
    const p = g.node(t.name);
    return {
      id: t.name,
      type: 'table',
      position: { x: p.x - WIDTH / 2, y: p.y - height(t) / 2 },
      data: { label: shortName(t.name, engine), columns: t.columns, rows: t.rows, focus: t.name === focus },
    };
  });
  const visible = (table, col) => {
    const t = graph.tables.find((x) => x.name === table);
    const idx = t ? t.columns.findIndex((c) => c.name === col) : -1;
    return idx >= 0 && idx < MAX_COLS;
  };
  const edges = graph.relations
    .filter((r) => g.hasNode(r.from) && g.hasNode(r.to))
    .map((r, i) => {
      const stroke = r.inferred ? 'var(--subtle)' : 'var(--primary)';
      return {
        id: `rel-${i}`,
        source: r.from,
        target: r.to,
        sourceHandle: visible(r.from, r.fromColumn) ? `${r.fromColumn}-s` : undefined,
        targetHandle: visible(r.to, r.toColumn) ? `${r.toColumn}-t` : undefined,
        type: 'smoothstep',
        animated: false,
        label: r.inferred ? 'inferred' : undefined,
        labelStyle: { fontSize: 10, fill: 'var(--subtle)' },
        labelBgStyle: { fill: 'var(--surface)' },
        style: { stroke, strokeWidth: 1.4, strokeDasharray: r.inferred ? '4 4' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 12, height: 12 },
      };
    });
  return { nodes, edges };
}

export function ErDiagram({ connectionId, db, engine, focus, onOpen, className }) {
  const { theme } = useTheme();
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setGraph(null);
    setError(null);
    API.connections
      .graph(connectionId, db)
      .then((g) => alive && setGraph(g))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [connectionId, db]);

  const laid = useMemo(() => (graph ? layout(graph, engine, focus) : null), [graph, engine, focus]);

  if (error) return <Empty icon={Network} title="Could not draw the diagram" body={error} />;
  if (!laid)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  if (!laid.nodes.length) return <Empty icon={Network} title="Nothing to draw" body="This database has no tables or collections yet." />;

  return (
    <div className={cn('relative h-full', className)}>
      <ReactFlow
        nodes={laid.nodes}
        edges={laid.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
        minZoom={0.15}
        maxZoom={1.8}
        nodesConnectable={false}
        onNodeDoubleClick={(_e, n) => onOpen?.(n.id)}
        colorMode={theme}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line-strong)" />
        <Controls showInteractive={false} />
        {laid.nodes.length > 14 ? <MiniMap pannable zoomable nodeColor="var(--surface-3)" /> : null}
      </ReactFlow>
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-3 rounded-md border border-line bg-surface/90 px-2.5 py-1.5 text-[11px] text-muted backdrop-blur">
        <span className="inline-flex items-center gap-1">
          <KeyRound size={11} className="text-warn" /> primary key
        </span>
        <span className="inline-flex items-center gap-1">
          <Link2 size={11} className="text-primary" /> foreign key
        </span>
        {graph.relations.some((r) => r.inferred) ? <span>dashed = inferred from field names</span> : null}
        <span>double-click a table to open it</span>
      </div>
    </div>
  );
}
