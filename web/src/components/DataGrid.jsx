import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../lib/cn.js';

function renderCell(value) {
  if (value === null || value === undefined) return <span className="italic text-subtle">null</span>;
  if (typeof value === 'boolean') return <span className="text-info">{String(value)}</span>;
  if (typeof value === 'number') return <span className="num">{value}</span>;
  if (typeof value === 'object') {
    if (value.$oid) return <span className="font-mono text-[11.5px] text-primary-strong">{value.$oid}</span>;
    if (value.$date) return <span className="num">{typeof value.$date === 'string' ? value.$date : JSON.stringify(value.$date)}</span>;
    return <span className="font-mono text-[11.5px] text-muted">{JSON.stringify(value)}</span>;
  }
  return String(value);
}

const NUMERIC = /int|numeric|decimal|double|float|real|money|serial|number/i;

/**
 * Generic read-only grid. `rows` are arrays aligned with `columns` ({ name, type }).
 */
export function DataGrid({ columns, rows, sort, onSort, onRowClick, primaryKey = [], className, emptyText = 'No rows' }) {
  return (
    <div className={cn('overflow-auto', className)}>
      <table className="min-w-full border-separate border-spacing-0 text-left text-[12.5px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-10 w-10 border-b border-line bg-surface-2 px-2 py-2 text-right text-[11px] font-medium text-subtle">#</th>
            {columns.map((c) => {
              const active = sort?.column === c.name;
              return (
                <th key={c.name} className="whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 font-medium">
                  <button
                    type="button"
                    disabled={!onSort}
                    onClick={() => onSort?.(c.name)}
                    className={cn('inline-flex items-center gap-1.5 text-[12px] text-fg', onSort && 'hover:text-primary')}
                  >
                    {primaryKey.includes(c.name) ? <span className="text-[10px] font-semibold text-warn">PK</span> : null}
                    {c.name}
                    {c.type ? <span className="font-mono text-[10.5px] font-normal text-subtle">{c.type}</span> : null}
                    {active ? sort.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} /> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} onClick={() => onRowClick?.(row, i)} className={cn('group', onRowClick && 'cursor-pointer')}>
              <td className="sticky left-0 border-b border-line bg-surface px-2 py-1.5 text-right text-[11px] text-subtle group-hover:bg-surface-2">{i + 1}</td>
              {columns.map((c, ci) => (
                <td
                  key={c.name + ci}
                  className={cn(
                    'max-w-[320px] truncate border-b border-line px-3 py-1.5 group-hover:bg-surface-2/70',
                    NUMERIC.test(c.type || '') && 'text-right',
                  )}
                  title={typeof row[ci] === 'object' && row[ci] ? JSON.stringify(row[ci]) : String(row[ci] ?? '')}
                >
                  {renderCell(row[ci])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <p className="px-4 py-10 text-center text-[13px] text-subtle">{emptyText}</p> : null}
    </div>
  );
}

/** Turn Mongo documents into grid columns/rows (top-level keys, most common first). */
export function documentsToGrid(docs, max = 12) {
  const counts = new Map();
  for (const d of docs) for (const k of Object.keys(d)) counts.set(k, (counts.get(k) || 0) + 1);
  const keys = [...counts.entries()]
    .sort((a, b) => (a[0] === '_id' ? -1 : b[0] === '_id' ? 1 : b[1] - a[1]))
    .slice(0, max)
    .map(([k]) => k);
  return { columns: keys.map((name) => ({ name })), rows: docs.map((d) => keys.map((k) => d[k])) };
}

export function JsonView({ value, className }) {
  const json = JSON.stringify(value, null, 2) || '';
  const html = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (m) => {
      let cls = 'json-num';
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'json-key' : 'json-str';
      else if (/true|false/.test(m)) cls = 'json-bool';
      else if (/null/.test(m)) cls = 'json-null';
      return `<span class="${cls}">${m}</span>`;
    });
  return <pre className={cn('code overflow-auto rounded-lg border border-line bg-bg-2 p-4', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Tiny, safe markdown renderer for assistant answers. */
export function Markdown({ text }) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const out = [];
  const lines = String(text || '').split('\n');
  let inCode = false;
  let code = [];
  let list = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
        code = [];
      } else flushList();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const m = /^\s*[-*]\s+(.*)/.exec(line) || /^\s*\d+\.\s+(.*)/.exec(line);
    if (m) {
      list.push(m[1]);
      continue;
    }
    flushList();
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    if (h) out.push(`<h3>${inline(h[2])}</h3>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  if (inCode && code.length) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  return <div className="prose-lite text-[13px] text-fg" dangerouslySetInnerHTML={{ __html: out.join('') }} />;
}
