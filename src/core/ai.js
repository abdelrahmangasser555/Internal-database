import { getAiKey, getSettings, DEFAULT_AI_MODEL } from './store.js';
import { resolveConnection } from './adapters/index.js';
import { assertReadOnlySql } from './adapters/sqlsafe.js';
import { parseMongoQuery } from './adapters/mongo.js';
import { engineInfo } from './engines.js';

// Optional assistant via OpenRouter. It only drafts read-only queries and explains
// schemas. It never executes anything: the UI shows the draft, and running it goes
// through the same read-only query runner as hand-written queries.

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const schemaCache = new Map();

export const DASHBOARD_WIDGET_TYPES = [
  'kpi',
  'bar',
  'line',
  'area',
  'pie',
  'scatter',
  'stacked',
  'funnel',
  'table',
  'pipeline',
  'note',
];

export function aiStatus() {
  const settings = getSettings();
  const hasKey = Boolean(getAiKey());
  return {
    enabled: settings.ai?.enabled !== false && hasKey,
    hasKey,
    model: settings.ai?.model || DEFAULT_AI_MODEL,
    provider: 'OpenRouter',
  };
}

export async function chat(messages, { json = false, maxTokens = 1200, timeoutMs = 60_000 } = {}) {
  const key = getAiKey();
  if (!key) throw new Error('The assistant is off. Add an OpenRouter API key in Settings or set OPENROUTER_API_KEY in .env.');
  const { model } = aiStatus();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://127.0.0.1',
        'X-Title': 'Backup Service',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `OpenRouter returned ${res.status}`);
    const text = data?.choices?.[0]?.message?.content || '';
    return { text, model: data.model || model, usage: data.usage || null };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`The assistant timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function samplePreview(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    if (value.$oid) return `ObjectId(${String(value.$oid).slice(0, 8)}…)`;
    if (value.$date) return String(value.$date).slice(0, 24);
    try {
      return JSON.stringify(value).slice(0, 48);
    } catch {
      return null;
    }
  }
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

function columnHint(c) {
  const flags = [c.pk ? 'PK' : '', c.fk ? 'FK' : ''].filter(Boolean).join(' ');
  const sample = samplePreview(c.sample);
  return `${c.name} ${c.type || 'unknown'}${flags ? ` ${flags}` : ''}${sample ? ` eg ${sample}` : ''}`;
}

export async function loadGraph(connectionId, database) {
  const key = `${connectionId}:${database || ''}`;
  const cached = schemaCache.get(key);
  if (cached && Date.now() - cached.at < 120_000) return cached.graph;
  const { conn, adapter } = resolveConnection(connectionId);
  const graph = await adapter.graph(conn, database);
  schemaCache.set(key, { at: Date.now(), graph });
  return graph;
}

async function schemaContext(connectionId, database, focus, { budget = 14_000 } = {}) {
  const graph = await loadGraph(connectionId, database);
  const tables = [...(graph.tables || [])].sort((a, b) => {
    if (a.name === focus) return -1;
    if (b.name === focus) return 1;
    return (b.rows || 0) - (a.rows || 0);
  });
  let text = '';
  for (const t of tables) {
    const cols = (t.columns || []).slice(0, 36).map(columnHint).join(', ');
    const line = `- ${t.name} (${t.type || 'table'}, ~${t.rows || 0} rows): ${cols}\n`;
    if (text.length + line.length > budget) {
      text += `… ${tables.length} objects total; remaining omitted.\n`;
      break;
    }
    text += line;
  }
  if (graph.relations?.length) {
    text += 'Relations:\n';
    for (const r of graph.relations.slice(0, 160)) {
      const line = `- ${r.from}.${r.fromColumn} -> ${r.to}.${r.toColumn}${r.inferred ? ' (inferred)' : ''}\n`;
      if (text.length + line.length > budget + 4_000) break;
      text += line;
    }
  }
  return { text, graph };
}

export function extractJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const m = /\{[\s\S]*\}/.exec(trimmed);
    if (m) return JSON.parse(m[0]);
    throw new Error('The assistant did not return a usable draft. Try rephrasing.');
  }
}

export function coerceQueryText(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  return JSON.stringify(raw, null, 2);
}

export function validateReadOnlyQuery(query, isMongo) {
  const text = coerceQueryText(query);
  if (!text) throw new Error('This widget has no query');
  if (isMongo) {
    parseMongoQuery(text);
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return assertReadOnlySql(text);
}

function dialectGuide(conn) {
  const info = engineInfo(conn.engine);
  if (conn.engine === 'mongodb') {
    return `MongoDB. Every widget.query is a JSON object string with "collection" and either "filter" (+ optional projection/sort/limit/skip) or "pipeline" (aggregation array). Use Extended JSON for ObjectId/date: {"$oid":"…"} and {"$date":"2024-01-01T00:00:00Z"}. Aggregations that chart should $group, $project aliases that match xKey/yKey, $sort and $limit. Never $out, $merge, $where, $function, $accumulator.`;
  }
  return `${info.label} SQL. Every widget.query is exactly one read-only statement (SELECT or WITH … SELECT). Quote identifiers for ${info.label}. Prefer GROUP BY for charts. Always LIMIT 200 (TOP 200 on SQL Server) unless the query is a single-row aggregate. Never INSERT/UPDATE/DELETE/DDL.`;
}

function dashboardSystem({ conn, database, schema }) {
  const info = engineInfo(conn.engine);
  return `You are a senior analytics engineer designing read-only exploration dashboards for a local backup tool.
Engine: ${dialectGuide(conn)}
Database: ${database}
Schema (ranked by size; samples are truncated):
${schema}

Return JSON only:
{
  "title": "short name",
  "summary": "2-5 sentences covering what it shows, the grain of each chart, and how entities join.",
  "plan": "brief internal plan of joins, time fields, and fallbacks if a field is missing",
  "widgets": [
    {
      "id": "w1",
      "type": "kpi | bar | line | area | pie | scatter | stacked | funnel | table | pipeline | note",
      "title": "short",
      "query": "read-only query string (empty only for note/pipeline)",
      "explanation": "one sentence: grain, filters, join",
      "objects": ["table_or_collection"],
      "xKey": "label or time column",
      "yKey": "primary numeric column",
      "seriesKeys": ["optional extra numeric columns for stacked/area/line"],
      "span": "1 | 2 | full",
      "format": "number | compact | percent | bytes",
      "steps": [{ "object": "users", "role": "source" }],
      "note": "plain text for type=note"
    }
  ]
}

Capability rules:
- Match complexity to the request. A single deep question may be 1–3 widgets. A broad operational view may be 6–14. Never pad with duplicate KPIs.
- Use joins / $lookup (or matching ObjectId fields) when the question spans entities. If a join key is only inferred, say so in explanation and still try.
- Time series: prefer createdAt/updatedAt/timestamp fields. Bucket by day or month. Type line or area.
- Comparisons / mix: stacked or grouped bar with seriesKeys.
- Conversion / stages: funnel (ordered rows, xKey=stage, yKey=count).
- Distributions: bar or pie. Relationships of two numerics: scatter.
- Quality questions: null rates, orphan FK counts, duplicates — table + KPI.
- KPI: one row, one numeric. Charts: 2–40 rows. Tables: useful columns, LIMIT 80.
- Pipeline widgets describe entity flow in steps[]; a cheap COUNT is optional.
- Note widgets hold caveats, definitions, or "how to read this" — no query.
- If a requested field is missing, pick the closest real column from the schema and say so. Never invent tables.
- Prefer real aggregate queries over sampling raw documents for charts.
- ${info.label} identifier quoting must be valid. Mongo pipelines must be valid JSON.
- Never write, DDL, stored procedures, or side-effect stages.`;
}

function compactWidget(w) {
  return {
    id: w.id,
    type: w.type,
    title: w.title,
    query: w.query || '',
    explanation: w.explanation || '',
    objects: w.objects || [],
    xKey: w.xKey || null,
    yKey: w.yKey || null,
    seriesKeys: w.seriesKeys || [],
    span: w.span || '1',
    format: w.format || null,
    steps: w.steps || [],
    error: w.error || null,
  };
}

export async function draftQuery({ connectionId, database, question, focus }) {
  if (!String(question || '').trim()) throw new Error('Ask a question first');
  const { conn } = resolveConnection(connectionId);
  const { text: schema } = await schemaContext(connectionId, database, focus);
  const isMongo = conn.engine === 'mongodb';
  const system = `You write read-only database queries for a local backup and exploration tool.
Database engine: ${dialectGuide(conn)}
Database: ${database}
Schema:
${schema}
Rules: never write, modify, delete or create data or schema objects. If the request needs a write, explain that the tool is read-only and return the closest read-only query (for example a SELECT preview of affected rows).
Prefer joins/aggregations when the question needs them. Reply as JSON: {"query": string, "explanation": string (1-3 short sentences, plain language), "objects": string[] (tables/collections used)}`;
  const { text, model, usage } = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: String(question).slice(0, 4000) },
    ],
    { json: true, maxTokens: 1800 },
  );
  const parsed = extractJson(text);
  let query = coerceQueryText(parsed.query);
  let valid = true;
  let error = null;
  try {
    query = validateReadOnlyQuery(query, isMongo);
  } catch (err) {
    valid = false;
    error = err.message;
  }
  return {
    language: isMongo ? 'mongo' : 'sql',
    query,
    explanation: parsed.explanation || '',
    objects: Array.isArray(parsed.objects) ? parsed.objects : [],
    valid,
    error,
    model,
    usage,
  };
}

export async function explainSchema({ connectionId, database, focus }) {
  const { conn } = resolveConnection(connectionId);
  const info = engineInfo(conn.engine);
  const { text: schema } = await schemaContext(connectionId, database, focus);
  const ask = focus
    ? `Explain the ${info.objectLabel} "${focus}": what it most likely stores, its key fields, how it relates to others, and two useful read-only queries.`
    : `Give a short tour of this ${info.label} database: the main entities, how they connect, anything that looks risky for backups (very large ${info.objectPlural}, missing primary keys, unindexed foreign keys), and three useful read-only queries.`;
  const { text, model, usage } = await chat(
    [
      {
        role: 'system',
        content: `You explain database schemas to engineers in plain, short language. Use markdown with short headings and bullet points. Engine: ${info.label}. Database: ${database}.\nSchema:\n${schema}`,
      },
      { role: 'user', content: ask },
    ],
    { maxTokens: 1500 },
  );
  return { markdown: text, model, usage };
}

export async function draftDashboard({ connectionId, database, prompt }) {
  if (!String(prompt || '').trim()) throw new Error('Describe the dashboard you want');
  const { conn } = resolveConnection(connectionId);
  const { text: schema } = await schemaContext(connectionId, database, null, { budget: 22_000 });
  const { text, model, usage } = await chat(
    [
      { role: 'system', content: dashboardSystem({ conn, database, schema }) },
      { role: 'user', content: String(prompt).slice(0, 6000) },
    ],
    { json: true, maxTokens: 5000, timeoutMs: 90_000 },
  );
  const parsed = extractJson(text);
  const widgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
  if (!widgets.length) throw new Error('The assistant did not return any widgets. Try a more specific prompt.');
  return {
    title: String(parsed.title || 'Exploration dashboard').slice(0, 80),
    summary: String(parsed.summary || parsed.plan || '').slice(0, 2000),
    widgets,
    model,
    usage,
  };
}

export async function reviseDashboardDraft({ connectionId, database, instruction, current }) {
  if (!String(instruction || '').trim()) throw new Error('Say what to change');
  const { conn } = resolveConnection(connectionId);
  const { text: schema } = await schemaContext(connectionId, database, null, { budget: 18_000 });
  const snapshot = {
    title: current?.name || current?.title,
    summary: current?.summary,
    widgets: (current?.widgets || []).map(compactWidget),
  };
  const { text, model, usage } = await chat(
    [
      { role: 'system', content: dashboardSystem({ conn, database, schema }) },
      {
        role: 'user',
        content: `Revise this existing dashboard. Keep widgets that still help, edit queries that are wrong, add what the instruction asks, and drop only what conflicts.
Instruction:
${String(instruction).slice(0, 4000)}

Current dashboard JSON:
${JSON.stringify(snapshot).slice(0, 14_000)}`,
      },
    ],
    { json: true, maxTokens: 5000, timeoutMs: 90_000 },
  );
  const parsed = extractJson(text);
  const widgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
  if (!widgets.length) throw new Error('The assistant returned an empty dashboard. Try a narrower instruction.');
  return {
    title: String(parsed.title || current?.name || 'Exploration dashboard').slice(0, 80),
    summary: String(parsed.summary || current?.summary || '').slice(0, 2000),
    widgets,
    model,
    usage,
  };
}

export async function draftWidget({ connectionId, database, prompt, currentWidgets = [] }) {
  if (!String(prompt || '').trim()) throw new Error('Describe the widget');
  const { conn } = resolveConnection(connectionId);
  const { text: schema } = await schemaContext(connectionId, database, null, { budget: 18_000 });
  const { text, model, usage } = await chat(
    [
      { role: 'system', content: dashboardSystem({ conn, database, schema }) },
      {
        role: 'user',
        content: `Add exactly one widget that answers this request. Return JSON {"widgets":[one widget]}.
Request: ${String(prompt).slice(0, 4000)}
Existing widget titles (avoid duplicates): ${(currentWidgets || []).map((w) => w.title).join(', ') || 'none'}`,
      },
    ],
    { json: true, maxTokens: 1800, timeoutMs: 75_000 },
  );
  const parsed = extractJson(text);
  const widget = Array.isArray(parsed.widgets) ? parsed.widgets[0] : parsed.widget || parsed;
  if (!widget || typeof widget !== 'object') throw new Error('The assistant did not return a widget.');
  return { widget, model, usage };
}

export async function repairWidgets({ connectionId, database, widgets, failures }) {
  const broken = (failures || []).filter((f) => f?.id && f?.error);
  if (!broken.length) return { widgets, repaired: 0 };
  const { conn } = resolveConnection(connectionId);
  const { text: schema } = await schemaContext(connectionId, database, null, { budget: 16_000 });
  const payload = broken.map((f) => {
    const w = (widgets || []).find((row) => row.id === f.id) || {};
    return { ...compactWidget(w), error: f.error };
  });
  const { text, model, usage } = await chat(
    [
      { role: 'system', content: dashboardSystem({ conn, database, schema }) },
      {
        role: 'user',
        content: `These widgets failed validation or execution. Return JSON {"widgets":[...]} with the SAME ids, fixed read-only queries (and xKey/yKey if aliases were wrong). Keep type/title unless the type cannot work.
Failures:
${JSON.stringify(payload).slice(0, 12_000)}`,
      },
    ],
    { json: true, maxTokens: 3500, timeoutMs: 75_000 },
  );
  const parsed = extractJson(text);
  const fixes = Array.isArray(parsed.widgets) ? parsed.widgets : [];
  const byId = new Map(fixes.map((w) => [w.id, w]));
  let repaired = 0;
  const next = (widgets || []).map((w) => {
    const fix = byId.get(w.id);
    if (!fix) return w;
    repaired += 1;
    return { ...w, ...fix, id: w.id };
  });
  return { widgets: next, repaired, model, usage };
}

export function clearSchemaCache(connectionId) {
  for (const key of schemaCache.keys()) if (!connectionId || key.startsWith(`${connectionId}:`)) schemaCache.delete(key);
}

/** Small round-trip to confirm the key and model work. Sends no schema or data. */
export async function testAi() {
  const started = Date.now();
  const { text, model } = await chat([{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens: 8 });
  return { ok: true, model, reply: String(text || '').trim().slice(0, 40), latencyMs: Date.now() - started };
}
