import { resolveConnection } from './adapters/index.js';
import { getDashboard, saveDashboard } from './store.js';
import {
  DASHBOARD_WIDGET_TYPES,
  coerceQueryText,
  draftDashboard,
  draftWidget,
  repairWidgets as aiRepairWidgets,
  reviseDashboardDraft,
  validateReadOnlyQuery,
} from './ai.js';

const WIDGET_TYPES = new Set(DASHBOARD_WIDGET_TYPES);
const QUERYLESS = new Set(['note', 'pipeline']);
const SPANS = new Set(['1', '2', 'full']);
const FORMATS = new Set(['number', 'compact', 'percent', 'bytes']);

export { DASHBOARD_WIDGET_TYPES };

function asStringArray(value, max = 16) {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((s) => s.trim()).filter(Boolean).slice(0, max);
}

export function normalizeWidget(raw, index = 0) {
  const type = WIDGET_TYPES.has(raw?.type) ? raw.type : 'table';
  const span = SPANS.has(String(raw?.span)) ? String(raw.span) : type === 'table' || type === 'pipeline' ? 'full' : type === 'kpi' ? '1' : '2';
  return {
    id: String(raw?.id || `w${index + 1}`).slice(0, 64),
    type,
    title: String(raw?.title || `Widget ${index + 1}`).slice(0, 80),
    query: coerceQueryText(raw?.query),
    explanation: String(raw?.explanation || '').slice(0, 800),
    objects: asStringArray(raw?.objects, 16),
    xKey: raw?.xKey || raw?.x || null,
    yKey: raw?.yKey || raw?.y || raw?.valueKey || null,
    seriesKeys: asStringArray(raw?.seriesKeys || raw?.series, 8),
    span,
    format: FORMATS.has(raw?.format) ? raw.format : type === 'kpi' ? 'compact' : 'number',
    steps: Array.isArray(raw?.steps) ? raw.steps.slice(0, 24) : [],
    note: String(raw?.note || '').slice(0, 4000),
  };
}

export function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    if (value.$numberInt != null) return Number(value.$numberInt);
    if (value.$numberLong != null) return Number(value.$numberLong);
    if (value.$numberDouble != null) return Number(value.$numberDouble);
    if (value.$numberDecimal != null) return Number(value.$numberDecimal);
    if (typeof value.$date === 'string') return Date.parse(value.$date);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceCell(value) {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (value.$oid) return String(value.$oid);
  if (typeof value.$date === 'string') return value.$date;
  if (value.$date && typeof value.$date === 'object' && value.$date.$numberLong) {
    return new Date(Number(value.$date.$numberLong)).toISOString();
  }
  const n = toNumber(value);
  if (n != null && (value.$numberInt != null || value.$numberLong != null || value.$numberDouble != null || value.$numberDecimal != null)) return n;
  return value;
}

function coerceRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = coerceCell(v);
  return out;
}

function firstNumeric(row, preferred) {
  if (!row) return null;
  if (preferred) {
    const n = toNumber(row[preferred]);
    if (n != null) return n;
  }
  for (const v of Object.values(row)) {
    const n = toNumber(v);
    if (n != null) return n;
  }
  return null;
}

function assertWidgetQuery(conn, widget) {
  if (QUERYLESS.has(widget.type) && !widget.query) return widget.query;
  if (!widget.query) throw new Error('This widget has no query');
  return validateReadOnlyQuery(widget.query, conn.engine === 'mongodb');
}

export async function runWidgetQuery(connectionId, database, widget) {
  const { conn, adapter } = resolveConnection(connectionId);
  const normalized = normalizeWidget(widget);
  if (normalized.type === 'note') {
    return { ...normalized, ok: true, error: null, rows: [], columns: [], value: null, rowCount: 0 };
  }
  if (normalized.type === 'pipeline' && !normalized.query) {
    return { ...normalized, ok: true, error: null, rows: [], columns: [], value: null, rowCount: 0 };
  }
  let query;
  try {
    query = assertWidgetQuery(conn, normalized);
  } catch (err) {
    return { ...normalized, ok: false, error: err.message, rows: [], columns: [], value: null };
  }
  try {
    const cap = normalized.type === 'table' ? 80 : normalized.type === 'kpi' ? 5 : 200;
    const result = await adapter.query(conn, database, query, { limit: cap });
    const colNames = (result.columns || []).map((c) => c.name || c);
    let rows = result.documents || result.rows || [];
    if (rows[0] && Array.isArray(rows[0])) {
      rows = rows.map((r) => Object.fromEntries(colNames.map((c, i) => [c, r[i]])));
    }
    rows = rows.map(coerceRow);
    const columns = colNames.length ? colNames : rows[0] ? Object.keys(rows[0]) : [];
    const numericCols = columns.filter((c) => rows.some((r) => toNumber(r[c]) != null));
    const yKey = normalized.yKey && columns.includes(normalized.yKey) ? normalized.yKey : numericCols[0] || columns[1];
    const xKey = normalized.xKey && columns.includes(normalized.xKey) ? normalized.xKey : columns.find((c) => c !== yKey) || columns[0];
    const seriesKeys = (normalized.seriesKeys.length ? normalized.seriesKeys : numericCols.filter((c) => c !== xKey && c !== yKey).slice(0, 5)).filter((c) => columns.includes(c));
    const value = normalized.type === 'kpi' ? firstNumeric(rows[0], yKey) : null;
    return {
      ...normalized,
      query,
      ok: true,
      error: null,
      rows,
      columns,
      xKey,
      yKey,
      seriesKeys,
      value,
      rowCount: rows.length,
      truncated: Boolean(result.truncated),
    };
  } catch (err) {
    return { ...normalized, query, ok: false, error: err.message, rows: [], columns: [], value: null };
  }
}

async function runWidgets(connectionId, database, widgets) {
  return Promise.all((widgets || []).map((w) => runWidgetQuery(connectionId, database, w)));
}

async function maybeRepair(connectionId, database, widgets) {
  const failures = widgets.filter((w) => !w.ok && !QUERYLESS.has(w.type)).map((w) => ({ id: w.id, error: w.error }));
  if (!failures.length) return { widgets, repaired: 0 };
  try {
    const { widgets: fixed, repaired } = await aiRepairWidgets({ connectionId, database, widgets, failures });
    if (!repaired) return { widgets, repaired: 0 };
    const rerunIds = new Set(failures.map((f) => f.id));
    const next = await Promise.all(
      fixed.map((w, i) => (rerunIds.has(w.id) ? runWidgetQuery(connectionId, database, normalizeWidget(w, i)) : Promise.resolve(widgets.find((row) => row.id === w.id) || w))),
    );
    return { widgets: next, repaired };
  } catch {
    return { widgets, repaired: 0 };
  }
}

async function attachGraph(connectionId, database, row, widgets) {
  let graph = null;
  try {
    const { conn, adapter } = resolveConnection(connectionId);
    graph = await adapter.graph(conn, database);
  } catch {
    graph = null;
  }
  const saved = saveDashboard({ ...row, widgets: widgets.map((w, i) => normalizeWidget(w, i)), lastRunAt: new Date().toISOString() });
  return { ...saved, widgets, graph };
}

function widgetFromQuery({ query, type, title, explanation }) {
  return normalizeWidget({
    id: 'w1',
    type: type || 'table',
    title: title || 'Query',
    query,
    explanation: explanation || 'Hand-written read-only query',
    span: type === 'kpi' ? '1' : 'full',
  });
}

export async function previewQuery({ connectionId, database, query, type = 'table' }) {
  if (!connectionId || !database) throw new Error('Pick a connection and database');
  return runWidgetQuery(connectionId, database, widgetFromQuery({ query, type, title: 'Preview' }));
}

export async function createDashboard({ connectionId, database, prompt, query, type, title }) {
  if (!connectionId || !database) throw new Error('Pick a connection and database');
  let name = title || 'Exploration dashboard';
  let summary = '';
  let widgets;
  if (String(prompt || '').trim()) {
    const draft = await draftDashboard({ connectionId, database, prompt });
    name = draft.title;
    summary = draft.summary;
    widgets = (draft.widgets || []).map(normalizeWidget);
    if (query) widgets.push(widgetFromQuery({ query, type, title: title || 'Custom query' }));
  } else if (query) {
    widgets = [widgetFromQuery({ query, type, title })];
    name = title || 'Query dashboard';
    summary = 'Built from a read-only query you pasted.';
  } else {
    throw new Error('Describe what you want to see, or paste a read-only query');
  }
  const parsed = [];
  for (const [i, w] of widgets.entries()) {
    const row = normalizeWidget(w, i);
    if (QUERYLESS.has(row.type) && !row.query) {
      parsed.push({ ...row, ok: true, error: null });
      continue;
    }
    try {
      const { conn } = resolveConnection(connectionId);
      row.query = assertWidgetQuery(conn, row);
      parsed.push(row);
    } catch (err) {
      parsed.push({ ...row, ok: false, error: err.message });
    }
  }
  const { widgets: syntaxFixed } = await maybeRepair(
    connectionId,
    database,
    parsed.map((w) => (w.ok === false ? w : { ...w, ok: true, error: null })),
  );
  const row = saveDashboard({
    name,
    prompt: prompt || query || '',
    connectionId,
    database,
    summary,
    widgets: syntaxFixed.map((w, i) => normalizeWidget(w, i)),
    lastRunAt: null,
  });
  return runDashboard(row.id);
}

export async function runDashboard(id) {
  const row = getDashboard(id);
  if (!row) throw new Error('Dashboard not found');
  let widgets = await runWidgets(row.connectionId, row.database, row.widgets);
  const repaired = await maybeRepair(row.connectionId, row.database, widgets);
  widgets = repaired.widgets;
  return attachGraph(row.connectionId, row.database, row, widgets);
}

export async function reviseDashboard({ id, instruction }) {
  const row = getDashboard(id);
  if (!row) throw new Error('Dashboard not found');
  if (!String(instruction || '').trim()) throw new Error('Say what to change');
  const draft = await reviseDashboardDraft({
    connectionId: row.connectionId,
    database: row.database,
    instruction,
    current: row,
  });
  const widgets = (draft.widgets || []).map(normalizeWidget);
  saveDashboard({
    ...row,
    name: draft.title || row.name,
    summary: draft.summary || row.summary,
    prompt: `${row.prompt || ''}\n\nFollow-up: ${instruction}`.trim().slice(0, 8000),
    widgets,
  });
  return runDashboard(id);
}

export async function addDashboardWidget({ id, prompt, query, type, title }) {
  const row = getDashboard(id);
  if (!row) throw new Error('Dashboard not found');
  let extra;
  if (String(prompt || '').trim()) {
    const draft = await draftWidget({
      connectionId: row.connectionId,
      database: row.database,
      prompt,
      currentWidgets: row.widgets,
    });
    extra = normalizeWidget({ ...draft.widget, type: type || draft.widget?.type, title: title || draft.widget?.title }, row.widgets.length);
  } else if (query) {
    extra = widgetFromQuery({ query, type, title });
    extra.id = `w${Date.now().toString(36)}`;
  } else {
    throw new Error('Describe a widget or paste a read-only query');
  }
  saveDashboard({ ...row, widgets: [...(row.widgets || []).map(normalizeWidget), extra] });
  return runDashboard(id);
}

export async function repairDashboard(id) {
  const row = getDashboard(id);
  if (!row) throw new Error('Dashboard not found');
  const ran = await runWidgets(row.connectionId, row.database, row.widgets);
  const { widgets, repaired } = await maybeRepair(row.connectionId, row.database, ran);
  const packed = await attachGraph(row.connectionId, row.database, row, widgets);
  return { ...packed, repaired };
}
