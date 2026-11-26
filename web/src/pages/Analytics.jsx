import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, BarChart3, GitBranch, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, Empty, Field, InfoTip, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui.jsx';
import { WidgetChart } from '../components/charts/WidgetChart.jsx';
import { engineOf } from '../lib/engines.js';
import { formatWhen } from '../lib/format.js';
import { cn } from '../lib/cn.js';

export function AnalyticsPage() {
  const { dashboardId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetConnection = params.get('connectionId') || '';
  const presetDatabase = params.get('database') || '';
  const { connections, meta } = useApp();
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [creating, setCreating] = useState(!dashboardId);
  const [prompt, setPrompt] = useState('');
  const [connectionId, setConnectionId] = useState(presetConnection || connections[0]?.id || '');
  const [database, setDatabase] = useState(presetDatabase);
  const [dbs, setDbs] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!connectionId && connections[0]?.id) setConnectionId(connections[0].id);
  }, [connections, connectionId]);

  const loadList = async () => {
    const rows = await API.dashboards.list();
    setList(rows);
    return rows;
  };

  const openDash = async (id) => {
    setBusy(true);
    try {
      const ran = await API.dashboards.run(id);
      setActive(ran);
      setCreating(false);
      navigate(`/analytics/${id}`, { replace: true });
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

  const create = async () => {
    if (!prompt.trim()) return toast.error('Describe what you want to see');
    if (!connectionId || !database) return toast.error('Pick a connection and database');
    setBusy(true);
    try {
      const dash = await API.dashboards.create({ connectionId, database, prompt: prompt.trim() });
      toast.success(dash.name);
      await loadList();
      setActive(dash);
      setCreating(false);
      navigate(`/analytics/${dash.id}`);
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
        subtitle="Describe the exploration you want. The assistant drafts read-only widgets and a data pipeline against the connection you pick."
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
            What should this dashboard show?
            <InfoTip text="The assistant only sees table and column names, then writes read-only queries. You can refresh the dashboard later without changing the layout." />
          </div>
          {!aiOn ? (
            <p className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-fg">
              Add an OpenRouter key in Settings first. Analytics uses the same assistant as Explore.
            </p>
          ) : null}
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Show how patients, observations and visits connect, with counts by day and the top observation types."
          />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Connection">
              <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
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
            <Button variant="primary" loading={busy} disabled={!aiOn || !connections.length} onClick={create}>
              <Sparkles size={14} /> Generate dashboard
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
            onRefresh={() => openDash(active.id)}
            onDelete={async () => {
              await API.dashboards.remove(active.id);
              toast.success('Dashboard removed');
              const rows = await loadList();
              setActive(null);
              if (rows[0]) openDash(rows[0].id);
              else {
                setCreating(true);
                navigate('/analytics');
              }
            }}
          />
        ) : (
          <Empty icon={BarChart3} title="No dashboard yet" body="Describe a question about any connected database and the assistant will lay out KPIs, charts and a pipeline." />
        )}
      </div>
    </div>
  );
}

function DashboardView({ dash, busy, onRefresh, onDelete }) {
  const kpis = (dash.widgets || []).filter((w) => w.type === 'kpi');
  const charts = (dash.widgets || []).filter((w) => ['bar', 'line', 'pie'].includes(w.type));
  const tables = (dash.widgets || []).filter((w) => w.type === 'table');
  const pipelines = (dash.widgets || []).filter((w) => w.type === 'pipeline');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">{dash.name}</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">{dash.summary}</p>
          <p className="mt-1 text-[11.5px] text-subtle">
            {dash.database}
            {dash.lastRunAt ? ` · ran ${formatWhen(dash.lastRunAt)}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" loading={busy} onClick={onRefresh}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      {kpis.length ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((w) => (
            <Card key={w.id} className="p-4">
              <p className="text-[12px] text-muted">{w.title}</p>
              <p className="mt-1 font-mono text-[22px] font-semibold tracking-tight">{w.ok ? w.value ?? '—' : '—'}</p>
              {w.error ? <p className="mt-1 text-[11px] text-danger">{w.error}</p> : <p className="mt-1 text-[11px] text-subtle">{w.explanation}</p>}
            </Card>
          ))}
        </div>
      ) : null}

      {pipelines.map((w) => (
        <Card key={w.id}>
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
            <GitBranch size={14} className="text-primary" />
            {w.title}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(w.steps?.length ? w.steps : (w.objects || []).map((o) => ({ object: o, role: 'entity' }))).map((step, i, arr) => (
              <span key={`${step.object}-${i}`} className="inline-flex items-center gap-2">
                <span className="rounded-md border border-line bg-surface-2 px-2.5 py-1 font-mono text-[12px]">
                  {step.object}
                  {step.role ? <span className="ml-1.5 text-subtle">{step.role}</span> : null}
                </span>
                {i < arr.length - 1 ? <ArrowRight size={14} className="text-subtle" /> : null}
              </span>
            ))}
          </div>
          {dash.graph?.relations?.length ? (
            <p className="mt-3 text-[12px] text-muted">
              {dash.graph.relations.slice(0, 8).map((r) => `${r.from}.${r.fromColumn} → ${r.to}.${r.toColumn}`).join(' · ')}
            </p>
          ) : null}
        </Card>
      ))}

      {charts.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {charts.map((w) => (
            <Card key={w.id}>
              <p className="text-[13px] font-semibold">{w.title}</p>
              <p className="mt-0.5 text-[12px] text-muted">{w.explanation}</p>
              {w.ok ? <WidgetChart widget={w} /> : <p className="mt-3 text-[12px] text-danger">{w.error}</p>}
            </Card>
          ))}
        </div>
      ) : null}

      {tables.map((w) => (
        <Card key={w.id} padded={false}>
          <div className="border-b border-line px-4 py-3">
            <p className="text-[13px] font-semibold">{w.title}</p>
            <p className="text-[12px] text-muted">{w.explanation}</p>
          </div>
          {w.error ? <p className="px-4 py-3 text-[12px] text-danger">{w.error}</p> : null}
          <div className="overflow-auto">
            <table className="min-w-full text-left text-[12.5px]">
              <thead className="bg-surface-2 text-[11px] text-muted">
                <tr>
                  {(w.columns || []).map((c) => (
                    <th key={c} className="px-4 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(w.rows || []).slice(0, 40).map((row, i) => (
                  <tr key={i} className="border-t border-line">
                    {(w.columns || []).map((c) => (
                      <td key={c} className="max-w-[220px] truncate px-4 py-2 font-mono text-[12px]">
                        {formatCell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function formatCell(v) {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
