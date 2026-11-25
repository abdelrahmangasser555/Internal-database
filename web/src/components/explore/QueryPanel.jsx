import { useEffect, useRef, useState } from 'react';
import { History, Play, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { API } from '../../api.js';
import { useApp } from '../../state/AppState.jsx';
import { Button, Kbd, Select } from '../ui.jsx';
import { DataGrid, documentsToGrid } from '../DataGrid.jsx';
import { engineOf, shortName } from '../../lib/engines.js';

function q(engine, name) {
  if (engine === 'mysql' || engine === 'mariadb') return name.split('.').map((p) => `\`${p}\``).join('.');
  if (engine === 'mssql') return name.split('.').map((p) => `[${p}]`).join('.');
  return name.split('.').map((p) => `"${p}"`).join('.');
}

export function starterQuery(engine, object) {
  if (engine === 'mongodb') return JSON.stringify({ collection: object || 'collection', filter: {}, sort: { _id: -1 }, limit: 50 }, null, 2);
  const target = object ? q(engine, object) : 'table_name';
  if (engine === 'mssql') return `SELECT TOP 50 *\nFROM ${target};`;
  return `SELECT *\nFROM ${target}\nLIMIT 50;`;
}

const HISTORY_KEY = 'bs-query-history';

export function QueryPanel({ connectionId, db, engine, object, initial }) {
  const { openAssistant } = useApp();
  const [text, setText] = useState(initial || starterQuery(engine, object));
  const [limit, setLimit] = useState(200);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const ref = useRef(null);
  const info = engineOf(engine);

  useEffect(() => {
    if (initial) setText(initial);
  }, [initial]);

  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}')[`${connectionId}:${db}`] || [];

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await API.connections.query(connectionId, db, text, limit);
      setResult(r);
      const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
      const key = `${connectionId}:${db}`;
      all[key] = [text, ...(all[key] || []).filter((x) => x !== text)].slice(0, 12);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const grid = result ? (result.documents ? documentsToGrid(result.documents) : { columns: result.columns, rows: result.rows }) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-4">
        <div className="overflow-hidden rounded-lg border border-line bg-bg-2 focus-within:border-primary/60">
          <textarea
            ref={ref}
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                run();
              }
              if (e.key === 'Tab') {
                e.preventDefault();
                const el = e.currentTarget;
                const s = el.selectionStart;
                setText(text.slice(0, s) + '  ' + text.slice(el.selectionEnd));
                requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
              }
            }}
            className="code block min-h-36 w-full resize-y bg-transparent p-3.5 text-fg outline-none"
            placeholder={info.family === 'sql' ? 'SELECT …' : '{ "collection": "users", "filter": {} }'}
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface/60 px-2.5 py-2">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-subtle">
              <ShieldCheck size={13} className="text-ok" />
              {info.family === 'sql' ? 'Single read-only statement, run inside a read-only transaction' : 'find or aggregate only; $out, $merge, $where are blocked'}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <div className="relative">
                <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)} disabled={!history.length}>
                  <History size={13} /> History
                </Button>
                {showHistory ? (
                  <div className="absolute bottom-9 right-0 z-20 w-96 overflow-hidden rounded-lg border border-line bg-surface shadow-2xl">
                    {history.map((h, i) => (
                      <button
                        key={i}
                        type="button"
                        className="block w-full truncate border-b border-line px-3 py-2 text-left font-mono text-[11.5px] text-muted last:border-0 hover:bg-surface-2 hover:text-fg"
                        onClick={() => {
                          setText(h);
                          setShowHistory(false);
                        }}
                      >
                        {h.replace(/\s+/g, ' ')}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Button size="sm" variant="ghost" onClick={() => openAssistant({ connectionId, db, focus: object, mode: 'query' })}>
                <Sparkles size={13} className="text-primary" /> Ask
              </Button>
              <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-7 w-24 text-[12px]">
                {[50, 200, 500, 1000].map((n) => (
                  <option key={n} value={n}>
                    {n} rows
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="primary" loading={busy} onClick={run}>
                <Play size={13} /> Run <Kbd className="ml-1 border-primary-fg/20 bg-transparent text-primary-fg/80">Ctrl ↵</Kbd>
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="m-4 flex gap-2 rounded-lg border border-danger/25 bg-danger/8 p-3 text-[13px] text-danger">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        ) : grid ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-line px-4 py-1.5 text-[11.5px] text-subtle">
              <span>
                {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
                {result.truncated ? ` · capped at ${limit}` : ''}
              </span>
              <span>{result.durationMs} ms</span>
            </div>
            <DataGrid columns={grid.columns} rows={grid.rows} className="min-h-0 flex-1" />
          </div>
        ) : (
          <p className="p-6 text-center text-[13px] text-subtle">
            Run a query to see results{object ? ` from ${shortName(object, engine)}` : ''}.
          </p>
        )}
      </div>
    </div>
  );
}
