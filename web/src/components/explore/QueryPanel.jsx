import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Filter, Play, Plus, Sparkles, Terminal, X } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../../api.js';
import { useApp } from '../../state/AppState.jsx';
import { Badge, Button, Empty, Input, Select, Spinner, Tabs, Textarea } from '../ui.jsx';
import { cell } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

const OPS = [
  ['contains', 'contains'],
  ['eq', '='],
  ['neq', '≠'],
  ['gt', '>'],
  ['lt', '<'],
  ['null', 'is null'],
  ['notnull', 'is not null'],
];

function quoteIdent(engine, name) {
  const s = String(name);
  if (engine === 'mysql' || engine === 'mariadb') return `\`${s.replace(/`/g, '``')}\``;
  if (engine === 'mssql') return `[${s.replace(/]/g, ']]')}]`;
  return `"${s.replace(/"/g, '""')}"`;
}

function quoteTable(engine, name) {
  if (!name.includes('.')) return quoteIdent(engine, name);
  return name.split('.').map((p) => quoteIdent(engine, p)).join('.');
}

function sqlLit(value) {
  if (value == null || value === '') return "''";
  if (/^-?\d+(\.\d+)?$/.test(String(value))) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function coerceMongo(value) {
  if (value == null || value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return value;
}

function buildWhere(engine, filters) {
  const parts = [];
  for (const f of filters) {
    if (!f.field) continue;
    const col = quoteIdent(engine, f.field);
    if (f.op === 'null') parts.push(`${col} IS NULL`);
    else if (f.op === 'notnull') parts.push(`${col} IS NOT NULL`);
    else if (f.op === 'contains') {
      const lit = sqlLit(`%${f.value || ''}%`);
      if (engine === 'postgres') parts.push(`${col}::text ILIKE ${lit}`);
      else if (engine === 'mssql') parts.push(`CAST(${col} AS nvarchar(max)) LIKE ${lit}`);
      else if (engine === 'sqlite') parts.push(`CAST(${col} AS TEXT) LIKE ${lit}`);
      else parts.push(`CAST(${col} AS CHAR) LIKE ${lit}`);
    } else {
      const op = { eq: '=', neq: '<>', gt: '>', lt: '<' }[f.op] || '=';
      parts.push(`${col} ${op} ${sqlLit(f.value)}`);
    }
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

function buildSql({ engine, table, filters, groupBy, limit }) {
  const t = quoteTable(engine, table);
  const where = buildWhere(engine, filters);
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
  if (groupBy) {
    const g = quoteIdent(engine, groupBy);
    return `SELECT ${g} AS key, COUNT(*) AS n FROM ${t} ${where} GROUP BY ${g} ORDER BY n DESC LIMIT ${cap}`;
  }
  return `SELECT * FROM ${t} ${where} LIMIT ${cap}`;
}

function buildMongo({ collection, filters, groupBy, limit }) {
  const and = [];
  for (const f of filters) {
    if (!f.field) continue;
    if (f.op === 'null') and.push({ [f.field]: null });
    else if (f.op === 'notnull') and.push({ [f.field]: { $ne: null } });
    else if (f.op === 'contains') and.push({ [f.field]: { $regex: String(f.value || ''), $options: 'i' } });
    else if (f.op === 'eq') and.push({ [f.field]: coerceMongo(f.value) });
    else if (f.op === 'neq') and.push({ [f.field]: { $ne: coerceMongo(f.value) } });
    else if (f.op === 'gt') and.push({ [f.field]: { $gt: coerceMongo(f.value) } });
    else if (f.op === 'lt') and.push({ [f.field]: { $lt: coerceMongo(f.value) } });
  }
  const filter = and.length === 1 ? and[0] : and.length ? { $and: and } : {};
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
  if (groupBy) {
    return JSON.stringify(
      {
        collection,
        pipeline: [...(and.length ? [{ $match: filter }] : []), { $group: { _id: `$${groupBy}`, n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: cap }],
      },
      null,
      2,
    );
  }
  return JSON.stringify({ collection, filter, limit: cap }, null, 2);
}

function groupedRows(result) {
  if (!result) return [];
  if (Array.isArray(result.rows) && result.columns?.some((c) => c.name === 'key' || c.name === 'n')) {
    const keyIdx = result.columns.findIndex((c) => c.name === 'key' || c.name === '_id');
    const nIdx = result.columns.findIndex((c) => c.name === 'n');
    if (keyIdx >= 0 && nIdx >= 0) {
      return result.rows.map((r) => ({ key: r[keyIdx] == null ? '(null)' : String(r[keyIdx]), n: Number(r[nIdx]) || 0 }));
    }
  }
  if (Array.isArray(result.documents) && result.documents[0] && ('n' in result.documents[0] || result.documents[0]._id !== undefined)) {
    return result.documents.map((d) => ({
      key: d._id == null ? '(null)' : typeof d._id === 'object' ? JSON.stringify(d._id) : String(d._id),
      n: Number(d.n) || 0,
    }));
  }
  return [];
}

export function QueryPanel({ connectionId, db, engine, object, objects, initial }) {
  const { openAssistant } = useApp();
  const isMongo = engine === 'mongodb';
  const [tab, setTab] = useState('dashboard');
  const [list, setList] = useState(objects || []);
  const [table, setTable] = useState(object || objects?.[0]?.name || '');
  const [meta, setMeta] = useState(null);
  const [filters, setFilters] = useState([]);
  const [groupBy, setGroupBy] = useState('');
  const [limit, setLimit] = useState(200);
  const [text, setText] = useState(initial || (isMongo ? '{\n  "collection": "users",\n  "filter": {},\n  "limit": 20\n}' : 'SELECT 1'));
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fieldQ, setFieldQ] = useState('');

  useEffect(() => {
    if (objects?.length) {
      setList(objects);
      if (!table) setTable(objects[0].name);
      return;
    }
    API.connections
      .objects(connectionId, db)
      .then((rows) => {
        const arr = Array.isArray(rows) ? rows : [];
        setList(arr);
        setTable((t) => t || arr[0]?.name || '');
      })
      .catch(() => {});
  }, [connectionId, db, objects]);

  useEffect(() => {
    if (initial) {
      setText(initial);
      setTab('raw');
    }
  }, [initial]);

  useEffect(() => {
    if (!table) return;
    setMeta(null);
    API.connections
      .describe(connectionId, db, table)
      .then(setMeta)
      .catch((err) => setMeta({ error: err.message, columns: [] }));
  }, [connectionId, db, table]);

  const columns = meta?.columns || [];
  const visibleFields = columns.filter((c) => !fieldQ || c.name.toLowerCase().includes(fieldQ.toLowerCase()));

  const built = useMemo(() => {
    if (!table) return '';
    if (isMongo) return buildMongo({ collection: table, filters, groupBy, limit });
    return buildSql({ engine, table, filters, groupBy, limit });
  }, [isMongo, engine, table, filters, groupBy, limit]);

  const run = async (source) => {
    const q = source ?? (tab === 'raw' ? text : built);
    setBusy(true);
    setError(null);
    try {
      const data = await API.connections.query(connectionId, db, q, 500);
      setResult(data);
      if (tab !== 'raw') setText(q);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const addFilter = (field) => {
    setFilters((prev) => [...prev, { field: field || columns[0]?.name || '', op: 'contains', value: '' }]);
    setTab('dashboard');
  };

  const bars = groupedRows(groupBy ? result : null);
  const maxN = Math.max(1, ...bars.map((b) => b.n));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <Tabs
          size="sm"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
            { id: 'raw', label: 'Raw', icon: Terminal },
          ]}
        />
        <Select value={table} onChange={(e) => setTable(e.target.value)} className="h-8 w-[min(100%,16rem)] text-[12.5px]">
          {list.map((o) => (
            <option key={o.name} value={o.name}>
              {o.name}
            </option>
          ))}
        </Select>
        <Input type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} className="h-8 w-20 text-[12.5px]" title="Limit" />
        <Button size="sm" variant="primary" loading={busy} onClick={() => run()}>
          <Play size={13} /> Run
        </Button>
        <Button size="sm" variant="ghost" onClick={() => openAssistant({ connectionId, db, object: table, mode: 'query' })}>
          <Sparkles size={13} className="text-primary" /> Draft
        </Button>
        {result ? (
          <span className="ml-auto text-[11.5px] text-subtle">
            {result.rowCount ?? result.documents?.length ?? 0} rows
            {result.durationMs != null ? ` · ${result.durationMs} ms` : ''}
            {result.truncated ? ' · truncated' : ''}
          </span>
        ) : (
          <span className="ml-auto text-[11.5px] text-subtle">Read-only</span>
        )}
      </div>

      {tab === 'dashboard' ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input value={fieldQ} onChange={(e) => setFieldQ(e.target.value)} placeholder="Find a field" className="h-8 max-w-xs text-[12.5px]" />
            <span className="text-[12px] text-subtle">{columns.length} fields{groupBy ? ` · grouped by ${groupBy}` : ''}</span>
          </div>
          {meta?.error ? <p className="mb-3 text-[12.5px] text-danger">{meta.error}</p> : null}
          {!meta && table ? <Spinner className="mb-3" /> : null}
          <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {visibleFields.map((c) => {
              const activeFilter = filters.some((f) => f.field === c.name);
              const grouped = groupBy === c.name;
              return (
                <div
                  key={c.name}
                  className={cn(
                    'rounded-md border border-dashed px-3 py-2.5',
                    grouped || activeFilter ? 'border-primary/50 bg-primary/6' : 'border-line bg-surface',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[12.5px] font-medium">{c.name}</div>
                      <div className="truncate text-[11px] text-subtle">
                        {c.type || 'any'}
                        {c.pk ? ' · pk' : ''}
                        {c.fk ? ' · fk' : ''}
                        {c.presence != null ? ` · ${c.presence}%` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="xs" variant={activeFilter ? 'primary' : 'ghost'} onClick={() => addFilter(c.name)} title="Filter">
                        <Filter size={11} />
                      </Button>
                      <Button
                        size="xs"
                        variant={grouped ? 'primary' : 'ghost'}
                        title="Count by this field"
                        onClick={() => setGroupBy((g) => (g === c.name ? '' : c.name))}
                      >
                        <BarChart3 size={11} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!visibleFields.length && meta ? <p className="text-[12.5px] text-subtle">No fields match.</p> : null}
          </div>

          <div className="mb-4 space-y-2">
            {filters.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select
                  value={f.field}
                  onChange={(e) => setFilters((prev) => prev.map((x, idx) => (idx === i ? { ...x, field: e.target.value } : x)))}
                  className="h-8 w-44 text-[12.5px]"
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Select
                  value={f.op}
                  onChange={(e) => setFilters((prev) => prev.map((x, idx) => (idx === i ? { ...x, op: e.target.value } : x)))}
                  className="h-8 w-32 text-[12.5px]"
                >
                  {OPS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </Select>
                {f.op !== 'null' && f.op !== 'notnull' ? (
                  <Input
                    value={f.value}
                    onChange={(e) => setFilters((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))}
                    className="h-8 min-w-[10rem] flex-1 text-[12.5px]"
                    placeholder="value"
                  />
                ) : null}
                <Button size="icon" variant="ghost" onClick={() => setFilters((prev) => prev.filter((_, idx) => idx !== i))}>
                  <X size={13} />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => addFilter()}>
                <Plus size={13} /> Add filter
              </Button>
              {groupBy ? (
                <Badge tone="info">
                  grouped by {groupBy}
                  <button type="button" className="ml-1" onClick={() => setGroupBy('')}>
                    ×
                  </button>
                </Badge>
              ) : null}
            </div>
          </div>

          <p className="mb-3 font-mono text-[11px] leading-5 text-subtle">{built}</p>

          {error ? <p className="mb-3 text-[13px] text-danger">{error}</p> : null}

          {bars.length ? (
            <div className="mb-4 rounded-md border border-line p-3">
              <div className="mb-2 text-[12px] font-medium">Counts by {groupBy}</div>
              <div className="space-y-1.5">
                {bars.map((b) => (
                  <div key={b.key} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-[12px]">
                    <span className="truncate font-mono" title={b.key}>
                      {b.key}
                    </span>
                    <div className="h-2 overflow-hidden rounded-sm bg-surface-2">
                      <div className="h-full bg-primary" style={{ width: `${(b.n / maxN) * 100}%` }} />
                    </div>
                    <span className="num text-muted">{b.n.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <ResultTable result={result} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-line p-3">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-32 font-mono text-[12.5px]" spellCheck={false} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {error ? <p className="mb-3 text-[13px] text-danger">{error}</p> : null}
            <ResultTable result={result} />
            {!result && !error ? <Empty icon={Terminal} title="Run a read-only query" body={isMongo ? 'JSON with collection + filter or pipeline.' : 'SELECT / WITH / EXPLAIN / SHOW / PRAGMA.'} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultTable({ result }) {
  if (!result) return null;
  if (result.documents) {
    if (!result.documents.length) return <p className="text-[12.5px] text-subtle">No documents.</p>;
    const keys = [...new Set(result.documents.flatMap((d) => Object.keys(d)))].slice(0, 16);
    return (
      <div className="overflow-auto rounded-md border border-line">
        <table className="w-full min-w-max text-left text-[12.5px]">
          <thead className="bg-surface-2 text-[11px] text-muted">
            <tr>
              {keys.map((k) => (
                <th key={k} className="px-3 py-2 font-medium">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.documents.map((d, i) => (
              <tr key={i} className="border-t border-line">
                {keys.map((k) => (
                  <td key={k} className="max-w-[240px] truncate px-3 py-1.5 font-mono text-[11.5px]">
                    {cell(d[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (!result.columns) return <pre className="text-[12px]">{JSON.stringify(result, null, 2)}</pre>;
  return (
    <div className="overflow-auto rounded-md border border-line">
      <table className="w-full min-w-max text-left text-[12.5px]">
        <thead className="bg-surface-2 text-[11px] text-muted">
          <tr>
            {result.columns.map((c) => (
              <th key={c.name} className="px-3 py-2 font-medium">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(result.rows || []).map((row, i) => (
            <tr key={i} className="border-t border-line">
              {row.map((v, j) => (
                <td key={j} className="max-w-[240px] truncate px-3 py-1.5 font-mono text-[11.5px]">
                  {cell(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
