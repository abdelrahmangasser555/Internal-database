import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, BarChart3, Code2, GitBranch, Pencil, Plus, RefreshCw, Sparkles, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, Empty, Field, InfoTip, Input, PageHeader, Select, Sheet, Spinner, Tabs, Textarea } from '../components/ui.jsx';
import { WidgetChart } from '../components/charts/WidgetChart.jsx';
import { engineOf } from '../lib/engines.js';
import { formatWhen, metric } from '../lib/format.js';
import { cn } from '../lib/cn.js';
import { analyticsPath, rememberConnection } from '../lib/paths.js';

const EXAMPLES = [
  'Operational overview: volume, freshness, top categories, and how the main entities join.',
  'Daily time series of the busiest collection, plus week-over-week KPIs.',
  'Funnel from tenants → users → observations, with conversion rates.',
  'Data quality: null rates, orphan foreign keys, duplicate emails, and a sample of broken rows.',
  'Stacked mix of statuses or types over the last 30 days, and a table of the latest 40 rows.',
];

const CHART_TYPES = [
  { id: 'kpi', label: 'KPI' },
  { id: 'bar', label: 'Bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
  { id: 'stacked', label: 'Stacked' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'funnel', label: 'Funnel' },
  { id: 'table', label: 'Table' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'note', label: 'Note' },
];

const SPAN_CLASS = {
  1: '',
  2: 'lg:col-span-2',
  full: 'lg:col-span-2',
};

export function AnalyticsPage() {
  const { dashboardId, connectionId: routeConnectionId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetConnection = routeConnectionId || params.get('connectionId') || '';
  const presetDatabase = params.get('database') || '';
  const { connections, meta } = useApp();
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [creating, setCreating] = useState(!dashboardId);
  const [mode, setMode] = useState('describe');
  const [prompt, setPrompt] = useState('');
  const [query, setQuery] = useState('');
  const [queryType, setQueryType] = useState('table');
  const [queryTitle, setQueryTitle] = useState('');
  const [connectionId, setConnectionId] = useState(presetConnection || connections[0]?.id || '');
  const [database, setDatabase] = useState(presetDatabase);
  const [dbs, setDbs] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (routeConnectionId) {
      rememberConnection(routeConnectionId);
      setConnectionId(routeConnectionId);
      return;
    }
    if (!connectionId && connections[0]?.id) setConnectionId(connections[0].id);
  }, [connections, connectionId, routeConnectionId]);

  const loadList = async () => {
    const rows = await API.dashboards.list();
    const scoped = routeConnectionId ? rows.filter((d) => d.connectionId === routeConnectionId) : rows;
    setList(scoped);
    return scoped;
  };

  const openDash = async (id) => {
    setBusy(true);
    try {
      const ran = await API.dashboards.run(id);
      setActive(ran);
      setCreating(false);
      navigate(routeConnectionId ? analyticsPath(routeConnectionId, id) : `/analytics/${id}`, { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadList()
      .then((rows) => {
        if (dashboardId) return openDash(dashboardId);
        if (presetConnection) {
          setCreating(true);
          setActive(null);
          return;
        }
        if (rows[0]) return openDash(rows[0].id);
        setCreating(true);
      })
      .catch((err) => toast.error(err.message));
  }, []);

  useEffect(() => {
    if (!connectionId) return;
    API.connections
      .databases(connectionId)
      .then((rows) => {
        setDbs(rows);
        setDatabase((d) => d || (rows.find((x) => x.primary) || rows[0])?.name || '');
      })
      .catch(() => setDbs([]));
  }, [connectionId]);

  const aiOn = Boolean(meta.ai?.enabled && meta.ai?.hasKey !== false);
  const conn = connections.find((c) => c.id === connectionId);
  const mongo = (conn?.engine || 'mongodb') === 'mongodb';

  const create = async () => {
    if (mode === 'describe' && !prompt.trim()) return toast.error('Describe what you want to see');
    if (mode === 'query' && !query.trim()) return toast.error('Paste a read-only query');
    if (!connectionId || !database) return toast.error('Pick a connection and database');
    setBusy(true);
    try {
      const dash = await API.dashboards.create({
        connectionId,
        database,
        prompt: mode === 'describe' ? prompt.trim() : undefined,
        query: mode === 'query' || (mode === 'describe' && query.trim()) ? query.trim() || undefined : undefined,
        type: queryType,
        title: queryTitle.trim() || undefined,
      });
      toast.success(dash.name);
      await loadList();
      setActive(dash);
      setCreating(false);
      navigate(routeConnectionId ? analyticsPath(routeConnectionId, dash.id) : `/analytics/${dash.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-5 py-6 md:px-8">
      <PageHeader
        title="Analytics"
        subtitle="Ask for any read-only view — joins, time series, funnels, quality checks — or paste a query. The assistant drafts widgets, repairs broken SQL/Mongo, and you can keep iterating."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> New dashboard
          </Button>
        }
      />

      {creating ? (
        <Card>
          <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
            <Sparkles size={16} className="text-primary" />
            Build a dashboard
            <InfoTip text="Describe the question in plain language, or paste a SELECT / Mongo JSON query. Everything stays read-only: the assistant never writes to the database." />
          </div>
          <Tabs
            size="sm"
            value={mode}
            onChange={setMode}
            tabs={[
              { id: 'describe', label: 'Describe' },
              { id: 'query', label: 'Paste query' },
            ]}
          />
          {mode === 'describe' ? (
            <>
              {!aiOn ? (
                <p className="mt-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-fg">
                  Add an OpenRouter key in Settings to generate from a description. You can still paste a query.
                </p>
              ) : null}
              <Textarea
                className="mt-3"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                placeholder="Anything from “how many active tenants?” to “cohort of users who observed this month, stacked by organization, with orphan vesselIds”."
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="rounded-md border border-line px-2 py-1 text-left text-[11.5px] text-muted hover:border-fg hover:text-fg"
                    onClick={() => setPrompt(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <Field className="mt-3" label="Title">
                <Input value={queryTitle} onChange={(e) => setQueryTitle(e.target.value)} placeholder="Latest observations" />
              </Field>
              <Field label="Chart type">
                <Select value={queryType} onChange={(e) => setQueryType(e.target.value)}>
                  {CHART_TYPES.filter((t) => t.id !== 'pipeline' && t.id !== 'note').map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Query" hint={mongo ? 'JSON with collection and filter or pipeline. Aggregations stay read-only.' : 'One read-only SELECT (or WITH … SELECT).'}>
                <Textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={8} placeholder={mongo ? '{\n  "collection": "observations",\n  "pipeline": [{ "$group": { "_id": "$status", "count": { "$sum": 1 } } }]\n}' : 'SELECT status, COUNT(*) AS n FROM observations GROUP BY status LIMIT 50'} />
              </Field>
            </>
          )}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Connection">
              <Select value={connectionId} disabled={Boolean(routeConnectionId)} onChange={(e) => setConnectionId(e.target.value)}>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {engineOf(c.engine).label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Database">
              {dbs.length ? (
                <Select value={database} onChange={(e) => setDatabase(e.target.value)}>
                  {dbs.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={database} onChange={(e) => setDatabase(e.target.value)} className="font-mono" />
              )}
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" loading={busy} disabled={!connections.length || (mode === 'describe' && !aiOn)} onClick={create}>
              <Sparkles size={14} /> {mode === 'query' ? 'Run query' : 'Generate dashboard'}
            </Button>
            {active ? (
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <Card padded={false} className="h-fit overflow-hidden">
          {list.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => openDash(d.id)}
              className={cn(
                'flex w-full items-start gap-2 border-b border-line px-3.5 py-3 text-left last:border-0 hover:bg-surface-2/70',
                active?.id === d.id && 'bg-primary/8',
              )}
            >
              <BarChart3 size={14} className="mt-0.5 text-primary" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{d.name}</span>
                <span className="block text-[11px] text-subtle">{d.database}</span>
              </span>
            </button>
          ))}
          {!list.length ? <p className="px-4 py-8 text-center text-[12px] text-subtle">No dashboards yet.</p> : null}
        </Card>

        {busy && !active ? (
          <div className="grid place-items-center py-20">
            <Spinner size={22} />
          </div>
        ) : active ? (
          <DashboardView
            dash={active}
            busy={busy}
            aiOn={aiOn}
            onRefresh={() => openDash(active.id)}
            onChange={setActive}
            onDelete={async () => {
              await API.dashboards.remove(active.id);
              toast.success('Dashboard removed');
              const rows = await loadList();
              setActive(null);
              if (rows[0]) openDash(rows[0].id);
              else {
                setCreating(true);
                navigate(routeConnectionId ? analyticsPath(routeConnectionId) : '/analytics');
              }
            }}
          />
        ) : (
          <Empty icon={BarChart3} title="No dashboard yet" body="Describe any question about the connected database, or paste a read-only query." />
        )}
      </div>
    </div>
  );
}

function DashboardView({ dash, busy, aiOn, onRefresh, onChange, onDelete }) {
  const [instruction, setInstruction] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [working, setWorking] = useState(false);
  const failed = (dash.widgets || []).filter((w) => w.ok === false);
  const pending = busy || working;

  const revise = async () => {
    if (!instruction.trim()) return toast.error('Say what to add or change');
    setWorking(true);
    try {
      const next = await API.dashboards.revise(dash.id, instruction.trim());
      setInstruction('');
      onChange(next);
      toast.success('Dashboard updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWorking(false);
    }
  };

  const repair = async () => {
    setWorking(true);
    try {
      const next = await API.dashboards.repair(dash.id);
      onChange(next);
      toast.success(next.repaired ? `Repaired ${next.repaired} widget${next.repaired === 1 ? '' : 's'}` : 'Nothing left to repair');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setWorking(false);
    }
  };

  const removeWidget = async (id) => {
    const widgets = (dash.widgets || []).filter((w) => w.id !== id).map(stripRun);
    await API.dashboards.save({ ...dash, widgets });
    const next = await API.dashboards.run(dash.id);
    onChange(next);
  };

  const kpis = (dash.widgets || []).filter((w) => w.type === 'kpi');
  const rest = (dash.widgets || []).filter((w) => w.type !== 'kpi');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold">{dash.name}</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">{dash.summary}</p>
          <p className="mt-1 text-[11.5px] text-subtle">
            {dash.database}
            {dash.lastRunAt ? ` · ran ${formatWhen(dash.lastRunAt)}` : ''}
            {` · ${(dash.widgets || []).length} widgets`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {failed.length ? (
            <Button size="sm" loading={pending} onClick={repair}>
              <Wrench size={13} /> Fix {failed.length} failed
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={13} /> Widget
          </Button>
          <Button size="sm" loading={pending} onClick={onRefresh}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      {aiOn ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Iterate: add a weekly trend, join users, drop the pie, fix the orphan count…"
            onKeyDown={(e) => e.key === 'Enter' && revise()}
          />
          <Button loading={pending} onClick={revise}>
            <Sparkles size={14} /> Apply
          </Button>
        </div>
      ) : null}

      {kpis.length ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((w) => (
            <KpiCard key={w.id} widget={w} onEdit={() => setEdit(w)} onRemove={() => removeWidget(w.id)} />
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {rest.map((w) => (
          <div key={w.id} className={cn(SPAN_CLASS[w.span] || (w.type === 'table' || w.type === 'pipeline' || w.type === 'note' ? 'lg:col-span-2' : ''))}>
            <WidgetCard widget={w} graph={dash.graph} onEdit={() => setEdit(w)} onRemove={() => removeWidget(w.id)} />
          </div>
        ))}
      </div>

      <AddWidgetSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        dash={dash}
        aiOn={aiOn}
        busy={busy}
        onSaved={(next) => {
          setAddOpen(false);
          onChange(next);
        }}
      />
      <EditWidgetSheet
        open={Boolean(edit)}
        widget={edit}
        dash={dash}
        onClose={() => setEdit(null)}
        onSaved={(next) => {
          setEdit(null);
          onChange(next);
        }}
      />
    </div>
  );
}

function stripRun(w) {
  const { rows, columns, ok, error, value, rowCount, truncated, ...rest } = w;
  return rest;
}

const WIDGET_ACCENT = {
  bar: 'from-violet-500/20 via-indigo-500/10 to-sky-500/15',
  line: 'from-rose-500/20 via-fuchsia-500/10 to-violet-500/15',
  area: 'from-emerald-500/20 via-teal-500/10 to-cyan-500/15',
  pie: 'from-amber-500/20 via-orange-500/10 to-rose-500/15',
  stacked: 'from-blue-500/20 via-indigo-500/10 to-purple-500/15',
  scatter: 'from-pink-500/20 via-purple-500/10 to-indigo-500/15',
  funnel: 'from-lime-500/20 via-green-500/10 to-teal-500/15',
  table: 'from-slate-500/15 via-zinc-500/5 to-neutral-500/10',
  pipeline: 'from-cyan-500/15 via-sky-500/10 to-blue-500/15',
  note: 'from-amber-500/10 via-yellow-500/5 to-orange-500/10',
  kpi: 'from-violet-500/25 via-fuchsia-500/10 to-emerald-500/15',
};

function KpiCard({ widget, onEdit, onRemove }) {
  return (
    <Card className={cn('dashboard-kpi-accent bg-gradient-to-br p-4 shadow-card', WIDGET_ACCENT.kpi)}>
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium text-muted">{widget.title}</p>
        <WidgetMenu onEdit={onEdit} onRemove={onRemove} />
      </div>
      <p className="relative mt-2 font-mono text-[24px] font-bold tracking-tight text-fg">
        {widget.ok ? metric(widget.value, widget.format) : '—'}
      </p>
      {widget.error ? (
        <p className="relative mt-1 text-[11px] text-danger">{widget.error}</p>
      ) : (
        <p className="relative mt-1 text-[11px] text-subtle">{widget.explanation}</p>
      )}
    </Card>
  );
}

function WidgetCard({ widget, graph, onEdit, onRemove }) {
  const [showQuery, setShowQuery] = useState(false);
  if (widget.type === 'pipeline') {
    const steps = widget.steps?.length ? widget.steps : (widget.objects || []).map((o) => ({ object: o, role: 'entity' }));
    return (
      <Card>
        <WidgetHead widget={widget} onEdit={onEdit} onRemove={onRemove} onQuery={() => setShowQuery((v) => !v)} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {steps.map((step, i, arr) => (
            <span key={`${step.object}-${i}`} className="inline-flex items-center gap-2">
              <span className="rounded-md border border-line bg-surface-2 px-2.5 py-1 font-mono text-[12px]">
                {step.object}
                {step.role ? <span className="ml-1.5 text-subtle">{step.role}</span> : null}
              </span>
              {i < arr.length - 1 ? <ArrowRight size={14} className="text-subtle" /> : null}
            </span>
          ))}
        </div>
        {graph?.relations?.length ? (
          <p className="mt-3 text-[12px] text-muted">
            {graph.relations.slice(0, 8).map((r) => `${r.from}.${r.fromColumn} → ${r.to}.${r.toColumn}`).join(' · ')}
          </p>
        ) : null}
        <QueryBlock open={showQuery} widget={widget} />
      </Card>
    );
  }
  if (widget.type === 'note') {
    return (
      <Card>
        <WidgetHead widget={widget} onEdit={onEdit} onRemove={onRemove} />
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-muted">{widget.note || widget.explanation}</p>
      </Card>
    );
  }
  if (widget.type === 'table') {
    return (
      <Card padded={false}>
        <div className="border-b border-line px-4 py-3">
          <WidgetHead widget={widget} onEdit={onEdit} onRemove={onRemove} onQuery={() => setShowQuery((v) => !v)} />
        </div>
        {widget.error ? <p className="px-4 py-3 text-[12px] text-danger">{widget.error}</p> : null}
        <div className="overflow-auto">
          <table className="min-w-full text-left text-[12.5px]">
            <thead className="bg-surface-2 text-[11px] text-muted">
              <tr>
                {(widget.columns || []).map((c) => (
                  <th key={c} className="px-4 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(widget.rows || []).slice(0, 80).map((row, i) => (
                <tr key={i} className="border-t border-line">
                  {(widget.columns || []).map((c) => (
                    <td key={c} className="max-w-[220px] truncate px-4 py-2 font-mono text-[12px]">
                      {formatCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-3">
          <QueryBlock open={showQuery} widget={widget} />
        </div>
      </Card>
    );
  }
  const accent = WIDGET_ACCENT[widget.type] || WIDGET_ACCENT.bar;
  return (
    <Card className={cn('overflow-hidden bg-gradient-to-br', accent)}>
      <div className="border-b border-line/40 bg-surface/80 px-4 py-3 backdrop-blur-sm">
        <WidgetHead widget={widget} onEdit={onEdit} onRemove={onRemove} onQuery={() => setShowQuery((v) => !v)} />
      </div>
      <div className="px-3 pb-3 pt-2">
        {widget.ok ? (
          <div className="dashboard-widget-chart">
            <div className="dashboard-widget-chart-inner">
              <WidgetChart widget={widget} />
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-danger">{widget.error}</p>
        )}
        <QueryBlock open={showQuery} widget={widget} />
      </div>
    </Card>
  );
}

function WidgetHead({ widget, onEdit, onRemove, onQuery }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {widget.type === 'pipeline' ? <GitBranch size={14} className="text-primary" /> : null}
          <p className="text-[13px] font-semibold">{widget.title}</p>
          <Badge>{widget.type}</Badge>
        </div>
        {widget.explanation ? <p className="mt-0.5 text-[12px] text-muted">{widget.explanation}</p> : null}
      </div>
      <WidgetMenu onEdit={onEdit} onRemove={onRemove} onQuery={onQuery} />
    </div>
  );
}

function WidgetMenu({ onEdit, onRemove, onQuery }) {
  return (
    <div className="flex shrink-0 gap-1">
      {onQuery ? (
        <Button size="icon" variant="ghost" onClick={onQuery} aria-label="Show query">
          <Code2 size={13} />
        </Button>
      ) : null}
      <Button size="icon" variant="ghost" onClick={onEdit} aria-label="Edit widget">
        <Pencil size={13} />
      </Button>
      <Button size="icon" variant="ghost" onClick={onRemove} aria-label="Remove widget">
        <Trash2 size={13} />
      </Button>
    </div>
  );
}

function QueryBlock({ open, widget }) {
  if (!open || !widget.query) return null;
  return <pre className="code mt-3 max-h-56 overflow-auto rounded-md border border-line bg-bg-2 p-3 text-fg">{widget.query}</pre>;
}

function AddWidgetSheet({ open, onClose, dash, aiOn, busy, onSaved }) {
  const [mode, setMode] = useState(aiOn ? 'describe' : 'query');
  const [prompt, setPrompt] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('bar');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const next = await API.dashboards.addWidget(dash.id, {
        prompt: mode === 'describe' ? prompt.trim() : undefined,
        query: mode === 'query' ? query.trim() : undefined,
        type,
        title: title.trim() || undefined,
      });
      toast.success('Widget added');
      setPrompt('');
      setQuery('');
      onSaved(next);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} title="Add a widget" subtitle="Describe it or paste a read-only query" onClose={onClose}>
      <Tabs
        size="sm"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'describe', label: 'Describe', disabled: !aiOn },
          { id: 'query', label: 'Paste query' },
        ]}
      />
      <Field className="mt-4" label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Type">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {CHART_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      {mode === 'describe' ? (
        <Field label="What should it show?">
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder="Count of observations by vessel this month, as a bar chart." />
        </Field>
      ) : (
        <Field label="Query">
          <Textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={8} className="font-mono" />
        </Field>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" loading={saving || busy} onClick={save}>
          Add widget
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

function EditWidgetSheet({ open, widget, dash, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('table');
  const [query, setQuery] = useState('');
  const [explanation, setExplanation] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!widget) return;
    setTitle(widget.title || '');
    setType(widget.type || 'table');
    setQuery(widget.query || '');
    setExplanation(widget.explanation || '');
    setPreview(null);
  }, [widget]);

  const save = async () => {
    setSaving(true);
    try {
      const widgets = (dash.widgets || []).map((w) => (w.id === widget.id ? stripRun({ ...w, title, type, query, explanation }) : stripRun(w)));
      await API.dashboards.save({ ...dash, widgets });
      const next = await API.dashboards.run(dash.id);
      toast.success('Widget saved');
      onSaved(next);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const tryPreview = async () => {
    try {
      const row = await API.dashboards.preview({ connectionId: dash.connectionId, database: dash.database, query, type });
      setPreview(row);
      if (!row.ok) toast.error(row.error);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Sheet open={open} title="Edit widget" subtitle={widget?.title} wide onClose={onClose}>
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Type">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {CHART_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Explanation">
        <Input value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </Field>
      {type !== 'note' ? (
        <Field label="Read-only query">
          <Textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={10} />
        </Field>
      ) : (
        <Field label="Note">
          <Textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={6} />
        </Field>
      )}
      {preview?.ok && preview.type !== 'table' && preview.type !== 'kpi' && preview.type !== 'note' ? (
        <div className="mt-3">
          <WidgetChart widget={{ ...preview, type }} />
        </div>
      ) : null}
      {preview?.ok && preview.rows ? (
        <p className="mt-2 text-[12px] text-subtle">
          {preview.rowCount} row{preview.rowCount === 1 ? '' : 's'}
          {preview.columns?.length ? ` · ${preview.columns.join(', ')}` : ''}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" loading={saving} onClick={save}>
          Save and run
        </Button>
        {type !== 'note' ? (
          <Button onClick={tryPreview}>
            Preview
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

function formatCell(v) {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
