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

async function chat(messages, { json = false, maxTokens = 1200 } = {}) {
  const key = getAiKey();
  if (!key) throw new Error('The assistant is off. Add an OpenRouter API key in Settings or set OPENROUTER_API_KEY in .env.');
  const { model } = aiStatus();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
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
    if (err.name === 'AbortError') throw new Error('The assistant timed out after 60s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function schemaContext(connectionId, database, focus) {
  const key = `${connectionId}:${database}`;
  const cached = schemaCache.get(key);
  let graph;
  if (cached && Date.now() - cached.at < 120_000) graph = cached.graph;
  else {
    const { conn, adapter } = resolveConnection(connectionId);
    graph = await adapter.graph(conn, database);
    schemaCache.set(key, { at: Date.now(), graph });
  }
  const tables = [...graph.tables].sort((a, b) => (a.name === focus ? -1 : b.name === focus ? 1 : 0));
  let text = '';
  for (const t of tables) {
    const cols = t.columns.map((c) => `${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.fk ? ' FK' : ''}`).join(', ');
    const line = `- ${t.name} (${t.type}, ~${t.rows} rows): ${cols}\n`;
    if (text.length + line.length > 14_000) break;
    text += line;
  }
  if (graph.relations?.length) {
    text += 'Relations:\n';
    for (const r of graph.relations.slice(0, 120)) text += `- ${r.from}.${r.fromColumn} -> ${r.to}.${r.toColumn}${r.inferred ? ' (inferred)' : ''}\n`;
  }
  return text;
}

function extractJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const m = /\{[\s\S]*\}/.exec(trimmed);
    if (m) return JSON.parse(m[0]);
    throw new Error('The assistant did not return a usable draft. Try rephrasing.');
  }
}

export async function draftQuery({ connectionId, database, question, focus }) {
  if (!String(question || '').trim()) throw new Error('Ask a question first');
  const { conn } = resolveConnection(connectionId);
  const info = engineInfo(conn.engine);
  const schema = await schemaContext(connectionId, database, focus);
  const isMongo = conn.engine === 'mongodb';
  const dialect = isMongo
    ? `MongoDB. Return the query as a JSON object string with keys: "collection" and either "filter" (+ optional "projection", "sort", "limit") or "pipeline" (array). Use Extended JSON for ObjectId/date values, e.g. {"$oid":"..."} and {"$date":"2024-01-01T00:00:00Z"}. Never use $out, $merge, $where, $function.`
    : `${info.label} SQL. Return exactly one read-only statement (SELECT / WITH ... SELECT). Quote identifiers for ${info.label}. Always include a LIMIT (or TOP for SQL Server) of at most 200 unless the user asks for an aggregate.`;
  const system = `You write read-only database queries for a local backup and exploration tool.
Database engine: ${dialect}
Database: ${database}
Schema:
${schema}
Rules: never write, modify, delete or create data or schema objects. If the request needs a write, explain that the tool is read-only and return the closest read-only query (for example a SELECT preview of affected rows).
Reply as JSON: {"query": string, "explanation": string (1-3 short sentences, plain language), "objects": string[] (tables/collections used)}`;
  const { text, model, usage } = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: String(question).slice(0, 2000) },
    ],
    { json: true },
  );
  const parsed = extractJson(text);
  let query = typeof parsed.query === 'string' ? parsed.query : JSON.stringify(parsed.query, null, 2);
  let valid = true;
  let error = null;
  try {
    if (isMongo) {
      parseMongoQuery(query);
      query = JSON.stringify(JSON.parse(query), null, 2);
    } else {
      query = assertReadOnlySql(query);
    }
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
  const schema = await schemaContext(connectionId, database, focus);
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
  const info = engineInfo(conn.engine);
  const schema = await schemaContext(connectionId, database);
  const isMongo = conn.engine === 'mongodb';
  const dialect = isMongo
    ? 'MongoDB. Each widget.query is a JSON object with "collection" and either "filter" or "pipeline". Aggregations should end with $group/$project/$sort/$limit. Never $out/$merge/$where.'
    : `${info.label} SQL. Each widget.query is one read-only SELECT (or WITH ... SELECT). Quote identifiers. Always LIMIT 200 (TOP 200 on SQL Server). Prefer GROUP BY for charts.`;
  const system = `You design read-only exploration dashboards for a local backup tool.
Engine: ${dialect}
Database: ${database}
Schema:
${schema}

Reply as JSON:
{
  "title": "short name",
  "summary": "2-4 sentences: what this dashboard shows and how the main entities connect (the data pipeline).",
  "widgets": [
    {
      "id": "w1",
      "type": "kpi | bar | line | pie | table | pipeline",
      "title": "short",
      "query": "read-only query string",
      "explanation": "one sentence",
      "objects": ["table_or_collection"],
      "xKey": "category column for charts",
      "yKey": "numeric column for charts",
      "steps": [{ "object": "users", "role": "source" }]
    }
  ]
}

Rules:
- 4 to 8 widgets. Mix 1-2 kpis, 2-3 charts, 1 table, and at most one pipeline.
- KPI queries return one row with a numeric column.
- Bar/line/pie queries return 2-20 rows with a label column (xKey) and a number (yKey).
- Pipeline widgets describe the main data flow between objects in "steps" (no heavy query required; a small COUNT query is fine).
- Never write, DDL, or stored procedures.
- If the question is vague, pick the most useful operational view (volume, freshness, top categories, relation health).`;
  const { text, model, usage } = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: String(prompt).slice(0, 2500) },
    ],
    { json: true, maxTokens: 2500 },
  );
  const parsed = extractJson(text);
  const widgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
  if (!widgets.length) throw new Error('The assistant did not return any widgets. Try a more specific prompt.');
  return {
    title: String(parsed.title || 'Exploration dashboard').slice(0, 80),
    summary: String(parsed.summary || '').slice(0, 1200),
    widgets,
    model,
    usage,
  };
}

export function clearSchemaCache(connectionId) {
  for (const key of schemaCache.keys()) if (key.startsWith(`${connectionId}:`)) schemaCache.delete(key);
}

/** Small round-trip to confirm the key and model work. Sends no schema or data. */
export async function testAi() {
  const started = Date.now();
  const { text, model } = await chat([{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens: 8 });
  return { ok: true, model, reply: String(text || '').trim().slice(0, 40), latencyMs: Date.now() - started };
}
