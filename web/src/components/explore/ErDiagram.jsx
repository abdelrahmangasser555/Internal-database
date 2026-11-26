import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { KeyRound, Link2, Network, Search, Table2, X } from 'lucide-react';
import { API } from '../../api.js';
import { useTheme } from '../../state/Theme.jsx';
import { shortName } from '../../lib/engines.js';
import { compact } from '../../lib/format.js';
import { Empty, Input, Kbd, Spinner } from '../ui.jsx';
import { cn } from '../../lib/cn.js';

const MAX_COLS = 14;
const ROW_H = 24;
const HEAD_H = 44;
const WIDTH = 260;

function TableNode({ data, selected }) {
  const cols = data.columns.slice(0, MAX_COLS);
  const picked = data.picked;
  return (
    <div
      className={cn('overflow-hidden rounded-[12px] border bg-surface shadow-[var(--shadow)]', data.focus ? 'border-primary' : 'border-line')}
      style={{ width: WIDTH, boxShadow: selected || data.focus ? '0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent)' : undefined }}
    >
      <div className="flex h-11 items-center justify-between gap-2 border-b border-line bg-surface-2 px-3">
        <span className="truncate text-[12.5px] font-semibold">{data.label}</span>
        <span className="num shrink-0 text-[10.5px] text-subtle">{compact(data.rows)} rows</span>
      </div>
      {cols.map((c) => {
        const active = picked?.table === data.table && picked?.column === c.name;
        const linked = data.linked?.has(c.name);
        return (
          <button
            key={c.name}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onPick?.({ table: data.table, column: c.name });
            }}
            className={cn(
              'relative flex w-full items-center gap-2 px-3 text-left text-[11.5px] transition',
              active ? 'bg-primary/16 text-fg' : linked ? 'bg-primary/8' : 'hover:bg-surface-2/80',
            )}
            style={{ height: ROW_H }}
            title={c.name}
          >
            <Handle type="target" id={`${c.name}-t`} position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-transparent" />
            <span className="w-3.5 shrink-0">
              {c.pk ? <KeyRound size={11} className="text-warn" /> : c.fk ? <Link2 size={11} className="text-primary" /> : null}
            </span>
            <span className={cn('truncate', c.pk && 'font-medium')}>{c.name}</span>
            <span className="ml-auto max-w-[110px] truncate font-mono text-[10.5px] text-subtle">{c.type}</span>
            <Handle type="source" id={`${c.name}-s`} position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-transparent" />
          </button>
        );
      })}
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
      data: { table: t.name, label: shortName(t.name, engine), columns: t.columns, rows: t.rows, focus: t.name === focus },
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
        data: { from: r.from, fromColumn: r.fromColumn, to: r.to, toColumn: r.toColumn, inferred: Boolean(r.inferred) },
      };
    });
  return { nodes, edges };
}

function matchesPick(rel, picked) {
  if (!picked) return false;
  return (
    (rel.from === picked.table && rel.fromColumn === picked.column) || (rel.to === picked.table && rel.toColumn === picked.column)
  );
}

function searchHits(graph, engine, q) {
  const term = q.trim().toLowerCase();
  if (!term || !graph) return [];
  const out = [];
  for (const t of graph.tables) {
    const label = shortName(t.name, engine);
    const tableHay = `${t.name} ${label}`.toLowerCase();
    if (tableHay.includes(term)) {
      out.push({
        id: `t:${t.name}`,
        kind: 'collection',
        table: t.name,
        column: null,
        title: label,
        hint: `${compact(t.rows)} rows`,
      });
    }
    for (const c of t.columns) {
      const fieldHay = `${c.name} ${label}.${c.name} ${t.name}.${c.name} ${c.type || ''}`.toLowerCase();
      if (fieldHay.includes(term)) {
        out.push({
          id: `c:${t.name}.${c.name}`,
          kind: 'field',
          table: t.name,
          column: c.name,
          title: `${label}.${c.name}`,
          hint: c.pk ? 'primary key' : c.fk ? 'foreign key' : c.type || 'field',
        });
      }
    }
    if (out.length >= 48) break;
  }
  return out.slice(0, 48);
}

export function ErDiagram(props) {
  return (
    <ReactFlowProvider>
      <ErDiagramInner {...props} />
    </ReactFlowProvider>
  );
}

function ErDiagramInner({ connectionId, db, engine, focus, onOpen, className }) {
  const { scheme } = useTheme();
  const { fitView, getNode } = useReactFlow();
  const searchRef = useRef(null);
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(null);
  const [focusId, setFocusId] = useState(focus || null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    let alive = true;
    setGraph(null);
    setError(null);
    setPicked(null);
    setFocusId(focus || null);
    setSearchOpen(false);
    setQ('');
    API.connections
      .graph(connectionId, db)
      .then((g) => alive && setGraph(g))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [connectionId, db, focus]);

  const laid = useMemo(() => (graph ? layout(graph, engine, focusId || focus) : null), [graph, engine, focus, focusId]);

  const related = useMemo(() => {
    if (!graph || !picked) return [];
    return (graph.relations || []).filter((r) => matchesPick(r, picked));
  }, [graph, picked]);

  const hits = useMemo(() => searchHits(graph, engine, q), [graph, engine, q]);

  const goTo = useCallback(
    (hit) => {
      if (!hit) return;
      setFocusId(hit.table);
      setPicked(hit.column ? { table: hit.table, column: hit.column } : null);
      setSearchOpen(false);
      setQ('');
      setActive(0);
      requestAnimationFrame(() => {
        const node = getNode(hit.table);
        if (node) fitView({ nodes: [node], padding: 0.42, duration: 380, maxZoom: 1.15 });
      });
    },
    [fitView, getNode],
  );

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setActive(0);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          setQ('');
          setActive(0);
        } else setPicked(null);
        return;
      }
      if (!searchOpen) return;
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
      if (e.key === 'Escape' && typing) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, hits, active, goTo, openSearch]);

  const view = useMemo(() => {
    if (!laid) return null;
    const linkedByTable = new Map();
    for (const r of related) {
      if (!linkedByTable.has(r.from)) linkedByTable.set(r.from, new Set());
      if (!linkedByTable.has(r.to)) linkedByTable.set(r.to, new Set());
      linkedByTable.get(r.from).add(r.fromColumn);
      linkedByTable.get(r.to).add(r.toColumn);
    }
    return {
      nodes: laid.nodes.map((n) => ({
        ...n,
        selected: n.id === focusId,
        data: {
          ...n.data,
          picked,
          onPick: (next) => setPicked((prev) => (prev?.table === next.table && prev?.column === next.column ? null : next)),
          linked: linkedByTable.get(n.id) || new Set(),
        },
      })),
      edges: laid.edges.map((e) => {
        const on = picked && matchesPick(e.data || {}, picked);
        const dim = Boolean(picked) && !on;
        const stroke = on ? 'var(--primary)' : e.style?.stroke;
        return {
          ...e,
          animated: on,
          style: {
            ...e.style,
            stroke,
            strokeWidth: on ? 2.6 : 1.4,
            opacity: dim ? 0.16 : 1,
          },
          markerEnd: { ...e.markerEnd, color: stroke, width: on ? 14 : 12, height: on ? 14 : 12 },
          labelStyle: { ...e.labelStyle, fill: on ? 'var(--primary)' : 'var(--subtle)', opacity: dim ? 0.2 : 1 },
        };
      }),
    };
  }, [laid, picked, related, focusId]);

  if (error) return <Empty icon={Network} title="Could not draw the diagram" body={error} />;
  if (!view)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  if (!view.nodes.length) return <Empty icon={Network} title="Nothing to draw" body="This database has no tables or collections yet." />;

  return (
    <div className={cn('relative h-full', className)}>
      <ReactFlow
        nodes={view.nodes}
        edges={view.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
        minZoom={0.15}
        maxZoom={1.8}
        nodesConnectable={false}
        onPaneClick={() => setPicked(null)}
        onNodeDoubleClick={(_e, n) => onOpen?.(n.id)}
        colorMode={scheme}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line-strong)" />
        <Controls showInteractive={false} />
        {view.nodes.length > 14 ? <MiniMap pannable zoomable nodeColor="var(--surface-3)" /> : null}
      </ReactFlow>
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex w-[min(100%-1.5rem,22rem)] flex-col gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface/90 px-2.5 py-1.5 text-[11px] text-muted backdrop-blur">
          <span className="inline-flex items-center gap-1">
            <KeyRound size={11} className="text-warn" /> primary key
          </span>
          <span className="inline-flex items-center gap-1">
            <Link2 size={11} className="text-primary" /> foreign key
          </span>
          {graph.relations.some((r) => r.inferred) ? <span>dashed = inferred</span> : null}
          <button
            type="button"
            onClick={() => (searchOpen ? (setSearchOpen(false), setQ('')) : openSearch())}
            className="ml-auto inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-muted hover:bg-surface-2 hover:text-fg"
            title="Search collections and fields"
            aria-label="Search diagram"
          >
            <Search size={12} />
            <Kbd>Ctrl</Kbd>
            <Kbd>F</Kbd>
          </button>
        </div>
        {searchOpen ? (
          <div className="pointer-events-auto overflow-hidden rounded-md border border-line bg-surface shadow-card">
            <div className="flex items-center gap-2 border-b border-line px-2.5">
              <Search size={13} className="shrink-0 text-subtle" />
              <Input
                ref={searchRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                placeholder="Find a collection or field"
                className="h-9 border-0 bg-transparent px-0 shadow-none focus:ring-0"
                autoComplete="off"
              />
              <button
                type="button"
                className="shrink-0 text-subtle hover:text-fg"
                onClick={() => {
                  setSearchOpen(false);
                  setQ('');
                }}
                aria-label="Close search"
              >
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
                    {hit.kind === 'collection' ? <Table2 size={13} className="shrink-0 text-primary" /> : <Link2 size={13} className="shrink-0 text-subtle" />}
                    <span className="min-w-0 flex-1 truncate font-mono">{hit.title}</span>
                    <span className="shrink-0 text-[10.5px] text-subtle">{hit.hint}</span>
                  </button>
                </li>
              ))}
              {q.trim() && !hits.length ? <li className="px-2.5 py-3 text-[12px] text-subtle">No matching collections or fields.</li> : null}
              {!q.trim() ? <li className="px-2.5 py-3 text-[12px] text-subtle">Type a collection or field name.</li> : null}
            </ul>
          </div>
        ) : null}
        {picked ? (
          <div className="pointer-events-auto max-h-[min(40vh,20rem)] overflow-y-auto rounded-md border border-primary/35 bg-surface shadow-card">
            <div className="sticky top-0 z-[1] border-b border-line bg-surface px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-subtle">Connected to</div>
              <div className="mt-0.5 truncate font-mono text-[13px] font-semibold">
                {shortName(picked.table, engine)}.{picked.column}
              </div>
            </div>
            {related.length ? (
              <ul className="space-y-0.5 px-1.5 py-1.5">
                {related.map((r, i) => {
                  const outgoing = r.from === picked.table && r.fromColumn === picked.column;
                  const target = {
                    table: outgoing ? r.to : r.from,
                    column: outgoing ? r.toColumn : r.fromColumn,
                  };
                  return (
                    <li key={`${r.from}-${r.fromColumn}-${r.to}-${i}`}>
                      <button
                        type="button"
                        onClick={() => goTo(target)}
                        className="flex w-full items-start gap-2 rounded-sm px-1.5 py-1.5 text-left text-[12.5px] hover:bg-surface-2"
                      >
                        <Link2 size={13} className="mt-0.5 shrink-0 text-primary" />
                        <span className="min-w-0">
                          {outgoing ? (
                            <>
                              connects to <span className="font-mono font-medium">{shortName(r.to, engine)}.{r.toColumn}</span>
                            </>
                          ) : (
                            <>
                              referenced by <span className="font-mono font-medium">{shortName(r.from, engine)}.{r.fromColumn}</span>
                            </>
                          )}
                          <span className="text-subtle"> · {r.inferred ? 'inferred' : 'foreign key'}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-3 pb-2.5 text-[12.5px] text-muted">This field is not linked to another table.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
