import { createContext, forwardRef, memo, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { applyNodeChanges } from '@xyflow/system';
import dagre from '@dagrejs/dagre';
import { AlertTriangle, Check, Copy, GripVertical, Info, KeyRound, Link2, Network, Plus, Search, StickyNote, Table2, Trash2, Unlink, X } from 'lucide-react';
import { useTheme } from '../../state/Theme.jsx';
import { engineOf, shortName } from '../../lib/engines.js';
import { compact } from '../../lib/format.js';
import { objectFindings, relationFindings, severityOf, typesFor } from '../../lib/schema.js';
import { Badge, Input, Kbd, Spinner } from '../ui.jsx';
import { cn } from '../../lib/cn.js';

const MAX_COLS_LIVE = 14;
const ROW_H = 26;
const HEAD_H = 40;
const WIDTH = 280;
const NOTE_W = 228;

const SEV_STROKE = { error: 'var(--danger)', warn: 'var(--warn)', info: 'var(--info)' };
const SEV_RING = {
  error: '0 0 0 3px color-mix(in oklab, var(--danger) 35%, transparent)',
  warn: '0 0 0 3px color-mix(in oklab, var(--warn) 35%, transparent)',
  info: '0 0 0 3px color-mix(in oklab, var(--info) 28%, transparent)',
};

const inputish =
  'nodrag nowheel bg-transparent px-0.5 text-inherit outline-none placeholder:text-subtle focus:bg-surface-2/80';

function DirectInput({ value, onCommit, className, placeholder, list, ariaLabel, mono }) {
  const [v, setV] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value ?? '');
  }, [value]);
  return (
    <input
      value={v}
      list={list}
      aria-label={ariaLabel}
      placeholder={placeholder}
      className={cn(inputish, mono && 'font-mono', className)}
      onChange={(e) => setV(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        const next = v.trim();
        if (next !== (value ?? '')) onCommit?.(next);
        else setV(value ?? '');
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setV(value ?? '');
          e.currentTarget.blur();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

function DirectArea({ value, onCommit, className, placeholder, ariaLabel, autoFocus }) {
  const [v, setV] = useState(value ?? '');
  const focused = useRef(false);
  const elRef = useRef(null);
  const grow = (el) => {
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(112, el.scrollHeight)}px`;
  };
  useEffect(() => {
    if (!focused.current) setV(value ?? '');
  }, [value]);
  useEffect(() => {
    grow(elRef.current);
  }, [v]);
  return (
    <textarea
      ref={(el) => {
        elRef.current = el;
        if (el) grow(el);
      }}
      value={v}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoFocus={autoFocus}
      rows={4}
      className={cn(inputish, 'w-full resize-none leading-5', className)}
      onChange={(e) => {
        setV(e.target.value);
        grow(e.currentTarget);
      }}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (v !== (value ?? '')) onCommit?.(v);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

const CanvasUi = createContext({ picked: null, linkedByTable: new Map(), openMenu: null });

function SchemaMenu({ menu, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    let x = menu.x;
    let y = menu.y;
    if (x + box.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - box.width - 8);
    if (y + box.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - box.height - 8);
    setPos({ x, y });
  }, [menu]);
  useEffect(() => {
    const onDown = (e) => {
      if (e.button === 2) return;
      if (!ref.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[80] min-w-[12rem] overflow-hidden rounded-md border border-line bg-surface py-1 shadow-card"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.label ? <div className="truncate px-2.5 pb-1 pt-0.5 font-mono text-[10.5px] text-subtle">{menu.label}</div> : null}
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={`sep-${i}`} className="my-1 border-t border-line" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={cn(
              'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px]',
              item.danger ? 'text-danger hover:bg-danger/10' : 'text-fg hover:bg-surface-2',
            )}
            onClick={() => {
              item.run();
              onClose();
            }}
          >
            {item.icon ? <item.icon size={13} className="shrink-0" /> : <span className="w-[13px]" />}
            <span className="min-w-0 flex-1">{item.label}</span>
            {item.checked ? <Check size={12} className="shrink-0 text-primary" /> : null}
          </button>
        ),
      )}
    </div>
  );
}

function TableNodeInner({ data, selected }) {
  const { picked, linkedByTable, openMenu } = useContext(CanvasUi);
  const editable = data.editable;
  const cols = data.columns.slice(0, data.maxCols);
  const linkedCols = linkedByTable.get(data.table);
  const sev = data.severity;
  const types = data.types || [];
  const listId = `types-${data.table}`;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[12px] border bg-surface shadow-[var(--shadow)]',
        selected ? 'border-primary' : sev === 'error' ? 'border-danger' : sev === 'warn' ? 'border-warn' : 'border-line',
      )}
      style={{
        width: WIDTH,
        boxShadow: selected ? '0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent)' : sev ? SEV_RING[sev] : undefined,
      }}
      onContextMenu={(e) => {
        if (!editable) return;
        e.preventDefault();
        e.stopPropagation();
        openMenu?.({ kind: 'table', table: data.table, x: e.clientX, y: e.clientY });
      }}
    >
      {types.length ? (
        <datalist id={listId}>
          {types.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      ) : null}
      <div className="flex h-10 cursor-grab items-center gap-1.5 border-b border-line bg-surface-2 px-2 active:cursor-grabbing">
        <GripVertical size={14} className="shrink-0 text-subtle" aria-hidden />
        {editable ? (
          <DirectInput
            value={data.label}
            ariaLabel="Name"
            className="min-w-0 flex-1 text-[12.5px] font-semibold"
            onCommit={(name) => data.onRename?.(name.replace(/\s+/g, '_'))}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{data.label}</span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          {data.findCount ? (
            <span className={cn('num text-[10.5px] font-medium', sev === 'error' ? 'text-danger' : sev === 'warn' ? 'text-warn' : 'text-info')}>
              {data.findCount}
            </span>
          ) : null}
          {data.rows != null ? <span className="num text-[10.5px] text-subtle">{compact(data.rows)}</span> : null}
          {editable ? (
            <>
              <button
                type="button"
                className="nodrag grid h-6 w-6 place-items-center rounded-sm text-muted hover:bg-surface hover:text-fg"
                title="Add field"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onAddField?.();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                className="nodrag grid h-6 w-6 place-items-center rounded-sm text-muted hover:bg-danger/10 hover:text-danger"
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onRemoveObject?.();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X size={12} />
              </button>
            </>
          ) : null}
        </span>
      </div>
      {editable ? (
        <DirectInput
          value={data.note || ''}
          placeholder="note"
          ariaLabel="Object note"
          className="w-full border-b border-line px-2.5 py-1 text-[11px] text-muted"
          onCommit={(note) => data.onNote?.(note)}
        />
      ) : data.note ? (
        <div className="border-b border-line px-3 py-1 text-[10.5px] leading-4 text-muted">{data.note}</div>
      ) : null}
      {cols.map((c) => {
        const active = picked?.table === data.table && picked?.column === c.name;
        const linked = linkedCols?.has(c.name);
        const colSev = data.columnSeverity?.[c.name];
        return (
          <div
            key={c.name}
            className={cn(
              'relative flex w-full items-center gap-1 px-2 text-[11.5px]',
              active ? 'bg-primary/16 text-fg' : linked ? 'bg-primary/8' : colSev === 'error' ? 'bg-danger/10' : colSev === 'warn' ? 'bg-warn/10' : editable ? '' : 'hover:bg-surface-2/80',
            )}
            style={{ height: ROW_H, boxShadow: colSev ? `inset 3px 0 0 ${SEV_STROKE[colSev]}` : undefined }}
            onClick={() => data.onPick?.({ table: data.table, column: c.name })}
            onContextMenu={(e) => {
              if (!editable) return;
              e.preventDefault();
              e.stopPropagation();
              openMenu?.({
                kind: 'field',
                table: data.table,
                column: c.name,
                pk: c.pk,
                unique: c.unique,
                required: c.required,
                x: e.clientX,
                y: e.clientY,
              });
            }}
          >
            <Handle
              type="target"
              id={`${c.name}-t`}
              position={Position.Left}
              className={cn('!border-0', editable ? '!h-2.5 !w-2.5 !bg-primary' : '!h-1.5 !w-1.5 !bg-transparent')}
            />
            <button
              type="button"
              className="nodrag grid w-4 shrink-0 place-items-center text-subtle hover:text-fg"
              title={c.pk ? 'primary key' : 'Mark primary key'}
              onClick={(e) => {
                e.stopPropagation();
                if (editable) data.onTogglePk?.(c.name);
                else data.onPick?.({ table: data.table, column: c.name });
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {c.pk ? <KeyRound size={11} className="text-warn" /> : c.fk ? <Link2 size={11} className="text-primary" /> : <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />}
            </button>
            {editable ? (
              <>
                <DirectInput
                  value={c.name}
                  ariaLabel="Field name"
                  className={cn('min-w-0 flex-1', c.pk && 'font-medium')}
                  onCommit={(name) => data.onRenameField?.(c.name, name.replace(/\s+/g, '_'))}
                />
                <DirectInput
                  value={c.type}
                  ariaLabel="Field type"
                  list={listId}
                  mono
                  className="w-[92px] shrink-0 text-right text-[10.5px] text-subtle"
                  onCommit={(type) => data.onType?.(c.name, type)}
                />
                <button
                  type="button"
                  className="nodrag grid h-5 w-5 shrink-0 place-items-center text-subtle hover:text-danger"
                  title="Remove field"
                  onClick={(e) => {
                    e.stopPropagation();
                    data.onRemoveField?.(c.name);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <X size={10} />
                </button>
              </>
            ) : (
              <>
                <span className={cn('min-w-0 flex-1 truncate', c.pk && 'font-medium')}>{c.name}</span>
                <span className="ml-auto max-w-[110px] truncate font-mono text-[10.5px] text-subtle">{c.type}</span>
              </>
            )}
            <Handle
              type="source"
              id={`${c.name}-s`}
              position={Position.Right}
              className={cn('!border-0', editable ? '!h-2.5 !w-2.5 !bg-primary' : '!h-1.5 !w-1.5 !bg-transparent')}
            />
          </div>
        );
      })}
      {data.columns.length > data.maxCols ? <div className="px-3 py-1 text-[10.5px] text-subtle">+{data.columns.length - data.maxCols} more</div> : null}
    </div>
  );
}

function NoteNodeInner({ data, selected }) {
  const { openMenu } = useContext(CanvasUi);
  return (
    <div
      data-note-id={data.noteId}
      className={cn('rounded-md border border-line bg-surface-2 shadow-[var(--shadow)]', selected && 'ring-2 ring-primary/30')}
      style={{ width: NOTE_W }}
      onContextMenu={(e) => {
        if (!data.editable) return;
        e.preventDefault();
        e.stopPropagation();
        openMenu?.({ kind: 'note', noteId: data.noteId, x: e.clientX, y: e.clientY });
      }}
    >
      <div className="flex cursor-grab items-center justify-between gap-2 border-b border-line px-2 py-1.5 text-[10.5px] uppercase tracking-wide text-subtle active:cursor-grabbing">
        <span className="inline-flex items-center gap-1">
          <GripVertical size={12} />
          <StickyNote size={11} /> Note
        </span>
        {data.editable ? (
          <button
            type="button"
            className="nodrag grid h-5 w-5 place-items-center rounded-sm hover:bg-danger/10 hover:text-danger"
            onClick={(e) => {
              e.stopPropagation();
              data.onRemove?.();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <X size={11} />
          </button>
        ) : null}
      </div>
      {data.editable ? (
        <DirectArea
          value={data.text}
          placeholder="Write here"
          ariaLabel="Note"
          autoFocus={data.autoFocus}
          className="min-h-[7rem] px-2.5 py-2 text-[12.5px] leading-5"
          onCommit={(text) => data.onText?.(text)}
        />
      ) : (
        <p className="whitespace-pre-wrap px-2.5 py-2 text-[12px] leading-4 text-fg">{data.text}</p>
      )}
    </div>
  );
}

const nodeEq = (a, b) => a.data === b.data && a.selected === b.selected;
const TableNode = memo(TableNodeInner, nodeEq);
const NoteNode = memo(NoteNodeInner, nodeEq);
const nodeTypes = { table: TableNode, note: NoteNode };
const EMPTY_LINKED = new Map();

function tableHeight(t, maxCols, editable) {
  const note = t.note || editable ? 22 : 0;
  return HEAD_H + note + Math.min(t.columns.length, maxCols) * ROW_H + (t.columns.length > maxCols ? 22 : 0) + 4;
}

function dagrePositions(schema, maxCols, editable) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 120, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  const objects = schema.objects || [];
  for (const t of objects) g.setNode(t.name, { width: WIDTH, height: tableHeight(t, maxCols, editable) });
  for (const r of schema.relations || []) if (g.hasNode(r.from) && g.hasNode(r.to)) g.setEdge(r.from, r.to);
  dagre.layout(g);
  const map = new Map();
  for (const t of objects) {
    const p = g.node(t.name);
    if (p) map.set(t.name, { x: p.x - WIDTH / 2, y: p.y - tableHeight(t, maxCols, editable) / 2 });
  }
  return map;
}

function pkName(obj) {
  return obj?.columns?.find((c) => c.pk)?.name || obj?.columns?.[0]?.name || '';
}

function defaultPk(engine) {
  return engine === 'mongodb' || engine === 'any'
    ? { name: '_id', type: 'objectId', pk: true, unique: true, required: true, fk: false, note: '' }
    : { name: 'id', type: 'uuid', pk: true, unique: true, required: true, fk: false, note: '' };
}

function uniqueName(objects, base) {
  let n = (objects?.length || 0) + 1;
  let name = `${base}_${n}`;
  while ((objects || []).some((o) => o.name === name)) {
    n += 1;
    name = `${base}_${n}`;
  }
  return name;
}

function matchesPick(rel, picked) {
  if (!picked?.column) return false;
  return (rel.from === picked.table && rel.fromColumn === picked.column) || (rel.to === picked.table && rel.toColumn === picked.column);
}

function searchHits(schema, engine, q) {
  const term = q.trim().toLowerCase();
  if (!term || !schema) return [];
  const out = [];
  for (const t of schema.objects || []) {
    const label = shortName(t.name, engine);
    if (`${t.name} ${label} ${t.note || ''}`.toLowerCase().includes(term)) {
      out.push({ id: `t:${t.name}`, kind: 'collection', table: t.name, column: null, title: label, hint: t.kind });
    }
    for (const c of t.columns || []) {
      if (`${c.name} ${label}.${c.name} ${c.type || ''} ${c.note || ''}`.toLowerCase().includes(term)) {
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
  for (const f of schema.findings || []) {
    if (`${f.title} ${f.detail} ${f.object} ${f.column || ''}`.toLowerCase().includes(term)) {
      out.push({
        id: `f:${f.id}`,
        kind: 'finding',
        table: f.object,
        column: f.column || null,
        findingId: f.id,
        title: f.title,
        hint: f.severity,
      });
    }
  }
  return out.slice(0, 48);
}

export const SchemaCanvas = forwardRef(function SchemaCanvas(props, ref) {
  return (
    <ReactFlowProvider>
      <SchemaCanvasInner {...props} apiRef={ref} />
    </ReactFlowProvider>
  );
});

function SchemaCanvasInner({
  schema,
  engine = 'any',
  focus,
  onOpen,
  onChange,
  onSelect,
  editable,
  className,
  toolbar,
  error,
  emptyTitle = 'Nothing to draw',
  emptyBody = 'Add a collection or table, or ask the assistant to draft a schema.',
  apiRef,
}) {
  const { scheme } = useTheme();
  const { fitView, getNode, screenToFlowPosition } = useReactFlow();
  const searchRef = useRef(null);
  const nodesRef = useRef([]);
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const pendingNoteRef = useRef(null);
  const seededPosRef = useRef('');
  const h = useRef({});
  const [nodes, setNodes] = useState([]);
  const [picked, setPicked] = useState(null);
  const [focusId, setFocusId] = useState(focus || null);
  const [findingId, setFindingId] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState(null);
  const maxCols = editable ? 40 : MAX_COLS_LIVE;

  useEffect(() => {
    setFocusId(focus || null);
  }, [focus]);

  const patchSchema = useCallback(
    (fn) => {
      const current = schemaRef.current;
      if (!current || !onChange) return;
      const next = fn(current);
      schemaRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  h.current = { patch: patchSchema, setFocusId, setPicked, setFindingId, onSelect };

  const addObjectAt = useCallback(
    (pos) => {
      const current = schemaRef.current;
      if (!current) return;
      const base = engineOf(current.engine).object === 'table' ? 'table' : 'collection';
      const name = uniqueName(current.objects, base);
      let point = pos;
      if (!point) {
        const tables = nodesRef.current.filter((n) => n.type === 'table');
        const last = tables[tables.length - 1];
        point = last
          ? { x: last.position.x + WIDTH + 56, y: last.position.y }
          : screenToFlowPosition({ x: window.innerWidth * 0.38, y: window.innerHeight * 0.32 });
      }
      patchSchema((s) => ({
        ...s,
        objects: [...(s.objects || []), { id: name, name, kind: base, note: '', columns: [defaultPk(s.engine)], x: point.x, y: point.y }],
      }));
      setFocusId(name);
    },
    [patchSchema, screenToFlowPosition],
  );

  const addNoteAt = useCallback(
    (pos) => {
      let point = pos;
      if (!point) {
        const tables = nodesRef.current.filter((n) => n.type === 'table');
        const notes = nodesRef.current.filter((n) => n.type === 'note');
        if (notes.length) {
          const last = notes[notes.length - 1];
          point = { x: last.position.x, y: last.position.y + 200 };
        } else if (tables.length) {
          const right = Math.max(...tables.map((n) => n.position.x));
          point = { x: right + WIDTH + 56, y: tables[0].position.y };
        } else {
          point = screenToFlowPosition({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.3 });
        }
      }
      const id = `note_${Date.now()}`;
      pendingNoteRef.current = id;
      patchSchema((s) => ({
        ...s,
        notes: [...(s.notes || []), { id, text: '', x: point.x, y: point.y }],
      }));
    },
    [patchSchema, screenToFlowPosition],
  );

  useImperativeHandle(apiRef, () => ({ addObject: addObjectAt, addNote: addNoteAt }), [addObjectAt, addNoteAt]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((next) => {
    if (!editable) return;
    setMenu(next);
  }, [editable]);

  const addFieldTo = useCallback(
    (table, after) => {
      patchSchema((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (o.name !== table) return o;
          const field = {
            name: uniqueName(o.columns, 'field'),
            type: typesFor(s.engine)[1] || 'string',
            pk: false,
            fk: false,
            unique: false,
            required: false,
            note: '',
          };
          const columns = [...o.columns];
          const i = after ? columns.findIndex((c) => c.name === after) : -1;
          if (i >= 0) columns.splice(i + 1, 0, field);
          else columns.push(field);
          return { ...o, columns };
        }),
      }));
    },
    [patchSchema],
  );

  const removeObject = useCallback(
    (table) => {
      patchSchema((s) => ({
        ...s,
        objects: s.objects.filter((o) => o.name !== table),
        relations: s.relations.filter((r) => r.from !== table && r.to !== table),
      }));
    },
    [patchSchema],
  );

  const duplicateObject = useCallback(
    (table) => {
      const current = schemaRef.current;
      const src = current?.objects?.find((o) => o.name === table);
      if (!src) return;
      const name = uniqueName(current.objects, src.name.replace(/_\d+$/, '') || src.name);
      const node = nodesRef.current.find((n) => n.id === table);
      const x = (node?.position?.x ?? src.x ?? 40) + 40;
      const y = (node?.position?.y ?? src.y ?? 40) + 40;
      patchSchema((s) => {
        const live = s.objects.find((o) => o.name === table);
        if (!live) return s;
        return {
          ...s,
          objects: [...s.objects, { ...live, id: name, name, columns: live.columns.map((c) => ({ ...c })), x, y }],
        };
      });
      setFocusId(name);
    },
    [patchSchema],
  );

  const toggleColumn = useCallback(
    (table, col, key) => {
      patchSchema((s) => ({
        ...s,
        objects: s.objects.map((o) =>
          o.name !== table
            ? o
            : {
                ...o,
                columns: o.columns.map((c) => {
                  if (c.name !== col) return c;
                  const on = !c[key];
                  return { ...c, [key]: on, ...(key === 'pk' && on ? { required: true } : {}) };
                }),
              },
        ),
      }));
    },
    [patchSchema],
  );

  const removeField = useCallback(
    (table, col) => {
      patchSchema((s) => ({
        ...s,
        objects: s.objects.map((o) => (o.name !== table ? o : { ...o, columns: o.columns.filter((c) => c.name !== col) })),
        relations: s.relations.filter((r) => !((r.from === table && r.fromColumn === col) || (r.to === table && r.toColumn === col))),
      }));
    },
    [patchSchema],
  );

  const removeNote = useCallback(
    (noteId) => {
      patchSchema((s) => ({ ...s, notes: (s.notes || []).filter((n) => n.id !== noteId) }));
    },
    [patchSchema],
  );

  const removeEdge = useCallback(
    (edgeId) => {
      patchSchema((s) => ({ ...s, relations: s.relations.filter((r, i) => r.id !== edgeId && `rel-${i}` !== edgeId) }));
    },
    [patchSchema],
  );

  const laidEdges = useMemo(() => {
    if (!schema) return [];
    const names = new Set((schema.objects || []).map((o) => o.name));
    const visible = (table, col) => {
      const t = (schema.objects || []).find((x) => x.name === table);
      const idx = t ? t.columns.findIndex((c) => c.name === col) : -1;
      return idx >= 0 && idx < maxCols;
    };
    return (schema.relations || [])
      .filter((r) => names.has(r.from) && names.has(r.to))
      .map((r, i) => {
        const hits = relationFindings(schema, r);
        const sev = severityOf(hits);
        const stroke = sev ? SEV_STROKE[sev] : r.inferred ? 'var(--subtle)' : 'var(--primary)';
        return {
          id: r.id || `rel-${i}`,
          source: r.from,
          target: r.to,
          sourceHandle: visible(r.from, r.fromColumn) ? `${r.fromColumn}-s` : undefined,
          targetHandle: visible(r.to, r.toColumn) ? `${r.toColumn}-t` : undefined,
          type: 'smoothstep',
          deletable: Boolean(editable),
          label: sev ? hits[0]?.title : r.inferred ? 'inferred' : undefined,
          labelStyle: { fontSize: 10, fill: sev ? SEV_STROKE[sev] : 'var(--subtle)' },
          labelBgStyle: { fill: 'var(--surface)' },
          style: { stroke, strokeWidth: sev === 'error' ? 2.2 : 1.6, strokeDasharray: r.inferred ? '4 4' : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 12, height: 12 },
          data: { ...r, findings: hits, severity: sev },
        };
      });
  }, [schema, maxCols, editable]);

  const contentKey = useMemo(() => {
    if (!schema) return '';
    return JSON.stringify({
      engine,
      e: editable,
      o: (schema.objects || []).map((o) => [o.name, o.note, o.columns.map((c) => [c.name, c.type, c.pk, c.fk, c.unique, c.required])]),
      r: (schema.relations || []).map((r) => [r.from, r.fromColumn, r.to, r.toColumn, r.inferred]),
      n: (schema.notes || []).map((n) => [n.id, n.text]),
      f: (schema.findings || []).map((f) => [f.id, f.object, f.column, f.severity]),
    });
  }, [schema, engine, editable]);

  useEffect(() => {
    if (!schema) {
      setNodes([]);
      nodesRef.current = [];
      return;
    }
    const auto = dagrePositions(schema, maxCols, editable);
    const prev = new Map(nodesRef.current.map((n) => [n.id, n.position]));
    const types = typesFor(engine);
    const nextNodes = (schema.objects || []).map((t) => {
      const of = objectFindings(schema, t.name);
      const columnSeverity = {};
      for (const f of of) if (f.column) columnSeverity[f.column] = severityOf(of.filter((x) => x.column === f.column)) || columnSeverity[f.column];
      const pos = prev.get(t.name) || (t.x != null && t.y != null ? { x: t.x, y: t.y } : auto.get(t.name)) || { x: 40, y: 40 };
      const id = t.name;
      return {
        id,
        type: 'table',
        position: pos,
        draggable: Boolean(editable),
        selected: id === focusId,
        data: {
          table: id,
          label: shortName(t.name, engine),
          columns: t.columns,
          rows: t.rows,
          note: t.note,
          severity: severityOf(of),
          findCount: of.length,
          columnSeverity,
          editable,
          types,
          maxCols,
          onPick: (next) => {
            h.current.setFindingId(null);
            h.current.setPicked((prevPick) => {
              const same = prevPick?.table === next.table && prevPick?.column === next.column;
              const value = same ? null : next;
              h.current.onSelect?.(value);
              return value;
            });
            h.current.setFocusId(next.table);
          },
          onRename: (name) => {
            if (!name) return;
            h.current.patch((s) => ({
              ...s,
              objects: s.objects.map((o) => (o.name === id ? { ...o, name, id: name } : o)),
              relations: s.relations.map((r) => ({
                ...r,
                from: r.from === id ? name : r.from,
                to: r.to === id ? name : r.to,
              })),
              notes: (s.notes || []).map((note) => (note.object === id ? { ...note, object: name } : note)),
            }));
            h.current.setFocusId(name);
          },
          onNote: (note) => h.current.patch((s) => ({ ...s, objects: s.objects.map((o) => (o.name === id ? { ...o, note } : o)) })),
          onAddField: () =>
            h.current.patch((s) => ({
              ...s,
              objects: s.objects.map((o) =>
                o.name === id
                  ? { ...o, columns: [...o.columns, { name: `field_${o.columns.length + 1}`, type: typesFor(s.engine)[1] || 'string', pk: false, fk: false, unique: false, required: false, note: '' }] }
                  : o,
              ),
            })),
          onRemoveObject: () =>
            h.current.patch((s) => ({
              ...s,
              objects: s.objects.filter((o) => o.name !== id),
              relations: s.relations.filter((r) => r.from !== id && r.to !== id),
            })),
          onTogglePk: (col) =>
            h.current.patch((s) => ({
              ...s,
              objects: s.objects.map((o) =>
                o.name !== id ? o : { ...o, columns: o.columns.map((c) => ({ ...c, pk: c.name === col ? !c.pk : c.pk })) },
              ),
            })),
          onRenameField: (from, to) => {
            if (!to) return;
            h.current.patch((s) => ({
              ...s,
              objects: s.objects.map((o) =>
                o.name !== id ? o : { ...o, columns: o.columns.map((c) => (c.name === from ? { ...c, name: to } : c)) },
              ),
              relations: s.relations.map((r) => ({
                ...r,
                fromColumn: r.from === id && r.fromColumn === from ? to : r.fromColumn,
                toColumn: r.to === id && r.toColumn === from ? to : r.toColumn,
              })),
            }));
          },
          onType: (col, type) =>
            h.current.patch((s) => ({
              ...s,
              objects: s.objects.map((o) =>
                o.name !== id ? o : { ...o, columns: o.columns.map((c) => (c.name === col ? { ...c, type } : c)) },
              ),
            })),
          onRemoveField: (col) =>
            h.current.patch((s) => ({
              ...s,
              objects: s.objects.map((o) => (o.name !== id ? o : { ...o, columns: o.columns.filter((c) => c.name !== col) })),
              relations: s.relations.filter((r) => !((r.from === id && r.fromColumn === col) || (r.to === id && r.toColumn === col))),
            })),
        },
      };
    });
    let maxX = 40;
    for (const n of nextNodes) maxX = Math.max(maxX, n.position.x + WIDTH + 24);
    const focusNote = pendingNoteRef.current;
    (schema.notes || []).forEach((note, i) => {
      const nid = `note:${note.id}`;
      const pos = prev.get(nid) || (note.x != null && note.y != null ? { x: note.x, y: note.y } : { x: maxX, y: 40 + i * 36 });
      nextNodes.push({
        id: nid,
        type: 'note',
        position: pos,
        draggable: Boolean(editable),
        selected: focusNote === note.id,
        zIndex: 8,
        data: {
          text: note.text,
          object: note.object,
          editable,
          noteId: note.id,
          autoFocus: focusNote === note.id,
          onText: (text) =>
            h.current.patch((s) => ({
              ...s,
              notes: (s.notes || []).map((n) => (n.id === note.id ? { ...n, text } : n)),
            })),
          onRemove: () => h.current.patch((s) => ({ ...s, notes: (s.notes || []).filter((n) => n.id !== note.id) })),
        },
      });
    });
    pendingNoteRef.current = null;
    nodesRef.current = nextNodes;
    setNodes(nextNodes);

    if (editable && onChange) {
      const missing = (schema.objects || []).some((o) => o.x == null || o.y == null);
      if (missing && seededPosRef.current !== contentKey) {
        seededPosRef.current = contentKey;
        onChange({
          ...schema,
          objects: schema.objects.map((o) => {
            const p = nextNodes.find((n) => n.id === o.name)?.position;
            return p ? { ...o, x: p.x, y: p.y } : o;
          }),
        });
      }
    }
  }, [contentKey]);

  const related = useMemo(() => {
    if (!schema || !picked) return [];
    return (schema.relations || []).filter((r) => matchesPick(r, picked));
  }, [schema, picked]);
  const hits = useMemo(() => searchHits(schema, engine, q), [schema, engine, q]);
  const pickedFindings = useMemo(() => {
    if (!schema) return [];
    if (findingId) return (schema.findings || []).filter((f) => f.id === findingId);
    if (!picked) return [];
    return (schema.findings || []).filter((f) => f.object === picked.table && (!f.column || f.column === picked.column));
  }, [schema, picked, findingId]);

  const canvasUi = useMemo(() => {
    const linkedByTable = new Map();
    for (const r of related) {
      if (!linkedByTable.has(r.from)) linkedByTable.set(r.from, new Set());
      if (!linkedByTable.has(r.to)) linkedByTable.set(r.to, new Set());
      linkedByTable.get(r.from).add(r.fromColumn);
      linkedByTable.get(r.to).add(r.toColumn);
    }
    return { picked, linkedByTable: linkedByTable.size ? linkedByTable : EMPTY_LINKED, openMenu };
  }, [related, picked, openMenu]);

  const noun = engineOf(engine).object;
  const menuItems = useMemo(() => {
    if (!menu || !editable) return [];
    if (menu.kind === 'pane') {
      return [
        { id: 'add-object', icon: Plus, label: `Add ${noun}`, run: () => addObjectAt(screenToFlowPosition({ x: menu.x, y: menu.y })) },
        { id: 'add-note', icon: StickyNote, label: 'Add note', run: () => addNoteAt(screenToFlowPosition({ x: menu.x, y: menu.y })) },
      ];
    }
    if (menu.kind === 'table') {
      return [
        { id: 'add-field', icon: Plus, label: 'Add field', run: () => addFieldTo(menu.table) },
        { id: 'duplicate', icon: Copy, label: `Duplicate ${noun}`, run: () => duplicateObject(menu.table) },
        'sep',
        { id: 'delete', icon: Trash2, label: `Delete ${noun}`, danger: true, run: () => removeObject(menu.table) },
      ];
    }
    if (menu.kind === 'field') {
      return [
        { id: 'add-field', icon: Plus, label: 'Add field', run: () => addFieldTo(menu.table, menu.column) },
        { id: 'pk', icon: KeyRound, label: 'Primary key', checked: menu.pk, run: () => toggleColumn(menu.table, menu.column, 'pk') },
        { id: 'unique', label: 'Unique', checked: menu.unique, run: () => toggleColumn(menu.table, menu.column, 'unique') },
        { id: 'required', label: 'Required', checked: menu.required, run: () => toggleColumn(menu.table, menu.column, 'required') },
        'sep',
        { id: 'delete-field', icon: Trash2, label: 'Delete field', danger: true, run: () => removeField(menu.table, menu.column) },
        { id: 'delete-object', icon: Trash2, label: `Delete ${noun}`, danger: true, run: () => removeObject(menu.table) },
      ];
    }
    if (menu.kind === 'note') {
      return [{ id: 'delete-note', icon: Trash2, label: 'Delete note', danger: true, run: () => removeNote(menu.noteId) }];
    }
    if (menu.kind === 'edge') {
      return [{ id: 'delete-edge', icon: Unlink, label: 'Delete connection', danger: true, run: () => removeEdge(menu.edgeId) }];
    }
    return [];
  }, [
    menu,
    editable,
    noun,
    addObjectAt,
    addNoteAt,
    addFieldTo,
    duplicateObject,
    removeObject,
    toggleColumn,
    removeField,
    removeNote,
    removeEdge,
    screenToFlowPosition,
  ]);

  const viewEdges = useMemo(
    () =>
      laidEdges.map((e) => {
        const on = picked && matchesPick(e.data || {}, picked);
        const dim = Boolean(picked) && !on;
        const stroke = on ? 'var(--primary)' : e.style?.stroke;
        return {
          ...e,
          animated: on || e.data?.severity === 'error',
          style: { ...e.style, stroke, strokeWidth: on ? 2.6 : e.style?.strokeWidth || 1.6, opacity: dim ? 0.16 : 1 },
          markerEnd: { ...e.markerEnd, color: stroke, width: on ? 14 : 12, height: on ? 14 : 12 },
        };
      }),
    [laidEdges, picked],
  );

  const goTo = useCallback(
    (hit) => {
      if (!hit?.table) return;
      setFocusId(hit.table);
      setPicked(hit.column ? { table: hit.table, column: hit.column } : { table: hit.table, column: null });
      if (hit.findingId) setFindingId(hit.findingId);
      setSearchOpen(false);
      setQ('');
      setActive(0);
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === hit.table })));
      requestAnimationFrame(() => {
        const node = getNode(hit.table);
        if (node) fitView({ nodes: [node], padding: 0.42, duration: 280, maxZoom: 1.15 });
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
        } else {
          setPicked(null);
          setFindingId(null);
        }
        return;
      }
      if (!searchOpen || typing) return;
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
  }, [searchOpen, hits, active, goTo, openSearch]);

  const onNodesChange = useCallback((changes) => {
    setNodes((nds) => {
      const next = applyNodeChanges(nds, changes);
      nodesRef.current = next;
      return next;
    });
  }, []);

  const persistPositions = useCallback(() => {
    if (!editable || !onChange) return;
    const pos = new Map(nodesRef.current.map((n) => [n.id, n.position]));
    patchSchema((s) => ({
      ...s,
      objects: s.objects.map((o) => {
        const p = pos.get(o.name);
        return p ? { ...o, x: p.x, y: p.y } : o;
      }),
      notes: (s.notes || []).map((n) => {
        const p = pos.get(`note:${n.id}`);
        return p ? { ...n, x: p.x, y: p.y } : n;
      }),
    }));
  }, [editable, onChange, patchSchema]);

  const onConnect = useCallback(
    (params) => {
      if (!editable) return;
      const current = schemaRef.current;
      if (!current) return;
      const fromCol = String(params.sourceHandle || '').replace(/-s$/, '');
      const toCol = String(params.targetHandle || '').replace(/-t$/, '');
      const source = current.objects.find((o) => o.name === params.source);
      const target = current.objects.find((o) => o.name === params.target);
      const fromColumn = fromCol || source?.columns?.[source.columns.length - 1]?.name || '';
      const toColumn = toCol || pkName(target);
      if (!params.source || !params.target || params.source === params.target || !fromColumn || !toColumn) return;
      const exists = (current.relations || []).some(
        (r) => r.from === params.source && r.fromColumn === fromColumn && r.to === params.target && r.toColumn === toColumn,
      );
      if (exists) return;
      patchSchema((s) => ({
        ...s,
        relations: [...(s.relations || []), { from: params.source, fromColumn, to: params.target, toColumn, kind: 'many-to-one', required: false, inferred: false, note: '' }],
        objects: s.objects.map((o) =>
          o.name !== params.source ? o : { ...o, columns: o.columns.map((c) => (c.name === fromColumn ? { ...c, fk: true } : c)) },
        ),
      }));
    },
    [editable, patchSchema],
  );

  const onEdgesDelete = useCallback(
    (gone) => {
      if (!editable) return;
      const ids = new Set(gone.map((e) => e.id));
      patchSchema((s) => ({ ...s, relations: s.relations.filter((r, i) => !ids.has(r.id) && !ids.has(`rel-${i}`)) }));
    },
    [editable, patchSchema],
  );

  const counts = useMemo(() => {
    const findings = schema?.findings || [];
    return {
      error: findings.filter((f) => f.severity === 'error').length,
      warn: findings.filter((f) => f.severity === 'warn').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };
  }, [schema]);

  if (error) return <div className="grid h-full place-items-center p-6 text-[13px] text-muted">{error}</div>;
  if (!schema)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );

  const empty = !nodes.length && !editable;

  return (
    <div className={cn('relative h-full', className)}>
      {empty ? (
        <div className="grid h-full place-items-center p-6 text-center">
          <div>
            <Network size={22} className="mx-auto mb-2 text-subtle" />
            <p className="text-[14px] font-medium">{emptyTitle}</p>
            <p className="mt-1 max-w-sm text-[12.5px] text-muted">{emptyBody}</p>
          </div>
        </div>
      ) : (
        <CanvasUi.Provider value={canvasUi}>
          <ReactFlow
            nodes={nodes}
            edges={viewEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onNodeDragStop={persistPositions}
            onNodesDelete={(gone) => {
              if (!editable) return;
              const tables = gone.filter((n) => n.type === 'table').map((n) => n.id);
              const noteIds = gone.filter((n) => n.type === 'note').map((n) => n.data?.noteId);
              if (!tables.length && !noteIds.length) return;
              patchSchema((s) => ({
                ...s,
                objects: s.objects.filter((o) => !tables.includes(o.name)),
                relations: s.relations.filter((r) => !tables.includes(r.from) && !tables.includes(r.to)),
                notes: (s.notes || []).filter((n) => !noteIds.includes(n.id)),
              }));
            }}
            fitView={!editable}
            fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
            minZoom={0.15}
            maxZoom={1.8}
            nodesConnectable={Boolean(editable)}
            nodesDraggable={Boolean(editable)}
            elementsSelectable
            selectNodesOnDrag={false}
            nodeDragThreshold={8}
            connectionMode={editable ? ConnectionMode.Loose : ConnectionMode.Strict}
            connectionRadius={48}
            connectionLineStyle={{ stroke: 'var(--primary)', strokeWidth: 2 }}
            deleteKeyCode={editable ? ['Backspace', 'Delete'] : []}
            onPaneClick={() => {
              setMenu(null);
              setPicked(null);
              setFindingId(null);
              onSelect?.(null);
            }}
            onPaneContextMenu={(e) => {
              if (!editable) return;
              e.preventDefault();
              openMenu({ kind: 'pane', x: e.clientX, y: e.clientY });
            }}
            onEdgeContextMenu={(e, edge) => {
              if (!editable) return;
              e.preventDefault();
              openMenu({
                kind: 'edge',
                edgeId: edge.id,
                label: `${edge.source} → ${edge.target}`,
                x: e.clientX,
                y: e.clientY,
              });
            }}
            onNodeContextMenu={(e, n) => {
              if (!editable) return;
              e.preventDefault();
              if (n.type === 'note') openMenu({ kind: 'note', noteId: n.data?.noteId, x: e.clientX, y: e.clientY });
              else if (n.type === 'table') openMenu({ kind: 'table', table: n.id, x: e.clientX, y: e.clientY });
            }}
            onPaneDoubleClick={(e) => {
              if (!editable) return;
              addObjectAt(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
            }}
            onNodeClick={(_e, n) => {
              setMenu(null);
              if (n.type === 'table') {
                setFocusId(n.id);
                onSelect?.({ table: n.id, column: null });
              }
            }}
            onMoveStart={closeMenu}
            onNodeDoubleClick={(_e, n) => n.type === 'table' && onOpen?.(n.id)}
            colorMode={scheme}
            proOptions={{ hideAttribution: true }}
            onlyRenderVisibleElements={nodes.length > 24}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line-strong)" />
            <Controls showInteractive={false} />
            {nodes.length > 14 ? <MiniMap pannable zoomable nodeColor="var(--surface-3)" /> : null}
          </ReactFlow>
        </CanvasUi.Provider>
      )}
      {editable && !nodes.length ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="text-[13px] text-muted">Right-click the canvas to add a {noun}, or use + {noun}.</p>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
        <div className="flex min-w-0 max-w-[min(100%-1.5rem,24rem)] flex-1 flex-col gap-2">
          <div className="pointer-events-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-md border border-line bg-surface/90 px-2.5 py-1.5 text-[11px] text-muted backdrop-blur">
            <span className="inline-flex items-center gap-1">
              <KeyRound size={11} className="text-warn" /> pk
            </span>
            <span className="inline-flex items-center gap-1">
              <Link2 size={11} className="text-primary" /> fk
            </span>
            {counts.error ? <Badge tone="danger">{counts.error} error</Badge> : null}
            {counts.warn ? <Badge tone="warn">{counts.warn} warn</Badge> : null}
            {counts.info ? <Badge tone="info">{counts.info} note</Badge> : null}
            <button
              type="button"
              onClick={() => (searchOpen ? (setSearchOpen(false), setQ('')) : openSearch())}
              className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-muted hover:bg-surface-2 hover:text-fg"
              title="Search collections, fields and findings"
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
                  placeholder="Find a collection, field or finding"
                  className="h-9 border-0 bg-transparent px-0 shadow-none focus:ring-0"
                  autoComplete="off"
                />
                <button type="button" className="shrink-0 text-subtle hover:text-fg" onClick={() => (setSearchOpen(false), setQ(''))} aria-label="Close search">
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
                      {hit.kind === 'finding' ? (
                        <AlertTriangle size={13} className="shrink-0 text-warn" />
                      ) : hit.kind === 'collection' ? (
                        <Table2 size={13} className="shrink-0 text-primary" />
                      ) : (
                        <Link2 size={13} className="shrink-0 text-subtle" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono">{hit.title}</span>
                      <span className="shrink-0 text-[10.5px] text-subtle">{hit.hint}</span>
                    </button>
                  </li>
                ))}
                {q.trim() && !hits.length ? <li className="px-2.5 py-3 text-[12px] text-subtle">No matches.</li> : null}
                {!q.trim() ? <li className="px-2.5 py-3 text-[12px] text-subtle">Type a collection or field name.</li> : null}
              </ul>
            </div>
          ) : null}
          {pickedFindings.length ? (
            <div className="pointer-events-auto max-h-[min(42vh,22rem)] overflow-y-auto rounded-md border border-line bg-surface shadow-card">
              <div className="sticky top-0 z-[1] border-b border-line bg-surface px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-subtle">On the canvas</div>
                <div className="mt-0.5 truncate font-mono text-[13px] font-semibold">
                  {picked?.column ? `${shortName(picked.table, engine)}.${picked.column}` : shortName(picked?.table || pickedFindings[0]?.object, engine)}
                </div>
              </div>
              <ul className="space-y-1 px-2 py-2">
                {pickedFindings.map((f) => (
                  <li key={f.id} className={cn('rounded-md border px-2.5 py-2', f.severity === 'error' ? 'border-danger/40' : f.severity === 'warn' ? 'border-warn/40' : 'border-line')}>
                    <div className="flex items-start gap-2">
                      {f.severity === 'info' ? <Info size={13} className="mt-0.5 shrink-0 text-info" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />}
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium">{f.title}</p>
                        <p className="mt-0.5 text-[12px] leading-4 text-muted">{f.detail}</p>
                        {f.fix ? <p className="mt-1 text-[12px] text-fg">Fix: {f.fix}</p> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {toolbar ? (
          <div className="pointer-events-auto flex shrink-0 flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface/90 px-2 py-1.5 backdrop-blur">
            {toolbar}
          </div>
        ) : null}
      </div>
      {menu && menuItems.length ? (
        <SchemaMenu
          menu={{
            ...menu,
            label:
              menu.label ||
              (menu.kind === 'field'
                ? `${shortName(menu.table, engine)}.${menu.column}`
                : menu.kind === 'table'
                  ? shortName(menu.table, engine)
                  : menu.kind === 'note'
                    ? 'Note'
                    : null),
          }}
          items={menuItems}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
