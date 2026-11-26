import { resolveConnection } from './adapters/index.js';
import { assertReadOnlySql } from './adapters/sqlsafe.js';
import { parseMongoQuery } from './adapters/mongo.js';
import { getDashboard, saveDashboard } from './store.js';
import { draftDashboard } from './ai.js';

const WIDGET_TYPES = new Set(['kpi', 'bar', 'line', 'pie', 'table', 'pipeline']);

export function normalizeWidget(raw, index = 0) {
  const type = WIDGET_TYPES.has(raw?.type) ? raw.type : 'table';
  return {
    id: String(raw?.id || `w${index + 1}`),
    type,
    title: String(raw?.title || `Widget ${index + 1}`).slice(0, 80),
    query: typeof raw?.query === 'string' ? raw.query : raw?.query ? JSON.stringify(raw.query, null, 2) : '',
    explanation: String(raw?.explanation || '').slice(0, 600),
    objects: Array.isArray(raw?.objects) ? raw.objects.map(String).slice(0, 12) : [],
    xKey: raw?.xKey || raw?.x || null,
    yKey: raw?.yKey || raw?.y || raw?.valueKey || null,
    steps: Array.isArray(raw?.steps) ? raw.steps.slice(0, 16) : [],
  };
}

function firstNumeric(row, preferred) {
  if (!row) return null;
  if (preferred && typeof row[preferred] === 'number') return row[preferred];
  const hit = Object.entries(row).find(([, v]) => typeof v === 'number');
  return hit ? hit[1] : Number(Object.values(row)[0]) || 0;
}

export async function runWidgetQuery(connectionId, database, widget) {
  const { conn, adapter } = resolveConnection(connectionId);
  const isMongo = conn.engine === 'mongodb';
  let query = widget.query;
  if (!query) {
    return { ...widget, ok: false, error: 'This widget has no query', rows: [], columns: [] };
  }
  try {
    if (isMongo) parseMongoQuery(query);
    else query = assertReadOnlySql(query);
  } catch (err) {
    return { ...widget, ok: false, error: err.message, rows: [], columns: [] };
  }
  try {
    const result = await adapter.query(conn, database, query, { limit: widget.type === 'table' ? 80 : 200 });
    const colNames = (result.columns || []).map((c) => c.name || c);
    let rows = result.documents || result.rows || [];
    if (rows[0] && Array.isArray(rows[0])) {
      rows = rows.map((r) => Object.fromEntries(colNames.map((c, i) => [c, r[i]])));
    }
    const columns = colNames.length ? colNames : rows[0] ? Object.keys(rows[0]) : [];
    const yKey = widget.yKey || columns.find((c) => rows.some((r) => typeof r[c] === 'number')) || columns[1];
    const xKey = widget.xKey || columns[0];
    const value = widget.type === 'kpi' ? firstNumeric(rows[0], yKey) : null;
    return {
      ...widget,
      ok: true,
      error: null,
      rows,
      columns,
      xKey,
      yKey,
      value,
      rowCount: rows.length,
    };
  } catch (err) {
    return { ...widget, ok: false, error: err.message, rows: [], columns: [] };
  }
}

export async function createDashboard({ connectionId, database, prompt }) {
  const draft = await draftDashboard({ connectionId, database, prompt });
  const widgets = (draft.widgets || []).map(normalizeWidget);
  const row = saveDashboard({
    name: draft.title,
    prompt,
    connectionId,
    database,
    summary: draft.summary,
    widgets,
    lastRunAt: null,
  });
  const ran = await runDashboard(row.id);
  return ran;
}

export async function runDashboard(id) {
  const row = getDashboard(id);
  if (!row) throw new Error('Dashboard not found');
  const widgets = [];
  for (const w of row.widgets || []) {
    widgets.push(await runWidgetQuery(row.connectionId, row.database, normalizeWidget(w)));
  }
  let graph = null;
  try {
    const { conn, adapter } = resolveConnection(row.connectionId);
    graph = await adapter.graph(conn, row.database);
  } catch {
    graph = null;
  }
  saveDashboard({ ...row, lastRunAt: new Date().toISOString() });
  return {
    ...row,
    lastRunAt: new Date().toISOString(),
    widgets,
    graph,
  };
}
