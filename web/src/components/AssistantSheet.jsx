import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, KeyRound, Play, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Empty, Field, Select, Sheet, Tabs, Textarea } from './ui.jsx';
import { DataGrid, Markdown, documentsToGrid } from './DataGrid.jsx';
import { engineOf, shortName } from '../lib/engines.js';

const SUGGEST = {
  sql: ['Top 10 customers by total order value', 'Orders per status this month', 'Tables with the most rows', 'Rows added in the last 7 days'],
  document: ['Latest 20 documents', 'Count documents per status', 'Users created this week', 'Find documents missing an email'],
};

export function AssistantSheet() {
  const { assistant, closeAssistant, connections, meta } = useApp();
  const navigate = useNavigate();
  const open = Boolean(assistant);
  const [status, setStatus] = useState(null);
  const [connectionId, setConnectionId] = useState('');
  const [db, setDb] = useState('');
  const [dbs, setDbs] = useState([]);
  const [focus, setFocus] = useState('');
  const [objects, setObjects] = useState([]);
  const [mode, setMode] = useState('query');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [explain, setExplain] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    API.ai.status().then(setStatus).catch(() => setStatus({ hasKey: false }));
    setConnectionId(assistant.connectionId || connections[0]?.id || '');
    setDb(assistant.db || '');
    setFocus(assistant.focus || '');
    setMode(assistant.mode || 'query');
    setQuestion(assistant.question || '');
    setDraft(null);
    setExplain(null);
    setResult(null);
  }, [open]);

  const conn = connections.find((c) => c.id === connectionId);
  const info = engineOf(conn?.engine);

  useEffect(() => {
    if (!open || !connectionId) return;
    API.connections
      .databases(connectionId)
      .then((list) => {
        setDbs(list);
        setDb((cur) => (cur && list.some((d) => d.name === cur) ? cur : (list.find((d) => d.primary) || list.find((d) => !['admin', 'config'].includes(d.name)) || list[0])?.name || ''));
      })
      .catch(() => setDbs([]));
  }, [open, connectionId]);

  useEffect(() => {
    if (!open || !connectionId || !db) return;
    API.connections.objects(connectionId, db).then(setObjects).catch(() => setObjects([]));
  }, [open, connectionId, db]);

  const suggestions = useMemo(() => SUGGEST[info.family === 'sql' ? 'sql' : 'document'], [info.family]);

  const ask = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (mode === 'query') {
        setDraft(await API.ai.query({ connectionId, database: db, question, focus: focus || undefined }));
      } else {
        setExplain(await API.ai.explain({ connectionId, database: db, focus: focus || undefined }));
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setRunning(true);
    try {
      setResult(await API.connections.query(connectionId, db, draft.query, 200));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const grid = result ? (result.documents ? documentsToGrid(result.documents) : { columns: result.columns, rows: result.rows }) : null;
  const noKey = status && !status.hasKey;

  return (
    <Sheet
      open={open}
      wide
      title="Assistant"
      subtitle={status?.model ? `${status.provider || 'OpenRouter'} · ${status.model} · drafts read-only queries, never runs writes` : 'Drafts read-only queries and explains schemas'}
      icon={
        <span className="grid h-[34px] w-[34px] place-items-center rounded-md border border-line bg-primary/12 text-primary">
          <Sparkles size={16} />
        </span>
      }
      onClose={closeAssistant}
    >
      {noKey ? (
        <Empty
          icon={KeyRound}
          title="Add an OpenRouter key to turn the assistant on"
          body="Everything else works without it. The key is read from OPENROUTER_API_KEY in .env, or saved encrypted on this device from Settings. The default model is DeepSeek V4.1 Flash, which costs a fraction of a cent per question."
          action={
            <Button
              variant="primary"
              onClick={() => {
                closeAssistant();
                navigate('/settings#assistant');
              }}
            >
              Open settings
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Connection">
              <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Database">
              <Select value={db} onChange={(e) => setDb(e.target.value)}>
                {dbs.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Focus ${info.object}`}>
              <Select value={focus} onChange={(e) => setFocus(e.target.value)}>
                <option value="">Whole database</option>
                {objects.map((o) => (
                  <option key={o.name} value={o.name}>
                    {shortName(o.name, conn?.engine)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              { id: 'query', label: 'Draft a query' },
              { id: 'explain', label: 'Explain schema' },
            ]}
          />

          {mode === 'query' ? (
            <div className="space-y-2">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={`Ask in plain language, e.g. “${suggestions[0]}”`}
                className="min-h-20 font-sans text-[13px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
                }}
              />
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => setQuestion(s)} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] text-muted hover:border-line-strong hover:text-fg">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-muted">Get a plain-language tour of {focus ? <b>{shortName(focus, conn?.engine)}</b> : 'this database'}: what it stores, how things connect, and backup risks.</p>
          )}

          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-subtle">
              <ShieldCheck size={13} className="text-ok" /> Only schema names and types are sent. Row data stays on this device.
            </span>
            <Button variant="primary" loading={busy} disabled={!db || (mode === 'query' && !question.trim())} onClick={ask}>
              <Sparkles size={14} /> {mode === 'query' ? 'Draft query' : 'Explain'}
            </Button>
          </div>

          {mode === 'query' && draft ? (
            <div className="space-y-3 rounded-lg border border-line bg-surface-2/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={draft.valid ? 'ok' : 'fail'} dot>
                    {draft.valid ? 'read-only check passed' : 'blocked'}
                  </Badge>
                  <span className="text-[11.5px] text-subtle">{draft.language === 'mongo' ? 'MongoDB query' : `${info.label} SQL`}</span>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard?.writeText(draft.query);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />} Copy
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      closeAssistant();
                      navigate(`/browse/${connectionId}/${encodeURIComponent(db)}`, { state: { tab: 'query', query: draft.query } });
                    }}
                  >
                    Open in editor
                  </Button>
                  <Button size="sm" variant="primary" disabled={!draft.valid} loading={running} onClick={run}>
                    <Play size={13} /> Run read-only
                  </Button>
                </div>
              </div>
              {draft.explanation ? <p className="text-[13px] leading-5 text-fg">{draft.explanation}</p> : null}
              <pre className="code max-h-64 overflow-auto rounded-md border border-line bg-bg-2 p-3 text-fg">{draft.query}</pre>
              {!draft.valid ? (
                <p className="flex items-center gap-1.5 text-[12px] text-danger">
                  <TriangleAlert size={13} /> {draft.error}
                </p>
              ) : null}
              {grid ? (
                <div className="overflow-hidden rounded-md border border-line">
                  <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-1.5 text-[11.5px] text-subtle">
                    <span>
                      {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
                      {result.truncated ? ' (capped)' : ''}
                    </span>
                    <span>{result.durationMs} ms</span>
                  </div>
                  <DataGrid columns={grid.columns} rows={grid.rows} className="max-h-72" />
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === 'explain' && explain ? (
            <div className="rounded-lg border border-line bg-surface-2/40 p-4">
              <Markdown text={explain.markdown} />
              <p className="mt-3 text-[11px] text-subtle">{explain.model}</p>
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
