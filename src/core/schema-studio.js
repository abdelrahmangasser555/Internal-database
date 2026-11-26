import { engineInfo } from './engines.js';
import { resolveConnection } from './adapters/index.js';
import { aiStatus, chat as completeChat, extractJson } from './ai.js';
import {
  SCHEMA_ENGINES,
  analyzeSchemaRules,
  applyLiveDetails,
  emptySchema,
  mergeFindings,
  normalizeFinding,
  normalizeSchema,
  schemaFromGraph,
} from './schema-format.js';

const DETAIL_CAP = 24;
const CONCURRENCY = 4;

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(n, items.length || 1) }, () => worker());
  await Promise.all(workers);
  return out;
}

function compactDescribe(desc) {
  if (!desc) return null;
  return {
    name: desc.name,
    type: desc.type,
    estimatedCount: desc.estimatedCount ?? 0,
    sampleSize: desc.sampleSize ?? null,
    primaryKey: desc.primaryKey || [],
    uniques: desc.uniques || [],
    foreignKeys: (desc.foreignKeys || []).slice(0, 40),
    indexes: (desc.indexes || []).slice(0, 40).map((idx) => ({
      name: idx.name,
      unique: Boolean(idx.unique),
      primary: Boolean(idx.primary),
      definition: typeof idx.definition === 'string' ? idx.definition.slice(0, 240) : idx.definition,
    })),
    columns: (desc.columns || []).slice(0, 80).map((c) => ({
      name: c.name,
      type: c.type,
      pk: Boolean(c.pk),
      fk: Boolean(c.fk),
      unique: Boolean(c.unique),
      nullable: c.nullable,
      presence: c.presence,
    })),
  };
}

export async function snapshotLive({ connectionId, database }) {
  if (!connectionId) throw new Error('Pick a connection');
  if (!database) throw new Error('Pick a database');
  const { conn, adapter, info } = resolveConnection(connectionId);
  const graph = await adapter.graph(conn, database);
  const objects = await adapter.listObjects(conn, database).catch(() => graph.tables || []);
  const byName = new Map((objects || []).map((o) => [o.name, o]));
  const ranked = [...(graph.tables || [])].sort((a, b) => (byName.get(b.name)?.rows || b.rows || 0) - (byName.get(a.name)?.rows || a.rows || 0));
  const picked = ranked.slice(0, DETAIL_CAP);
  const described = await mapLimit(picked, CONCURRENCY, async (t) => {
    try {
      const desc = await adapter.describe(conn, database, t.name);
      return compactDescribe(desc);
    } catch {
      return compactDescribe({ name: t.name, type: t.type, estimatedCount: t.rows || 0, columns: t.columns || [], indexes: [] });
    }
  });
  const details = {};
  for (const d of described) {
    if (d?.name) details[d.name] = d;
  }
  const schema = applyLiveDetails(
    schemaFromGraph(graph, {
      engine: conn.engine,
      name: `${conn.name} · ${database}`,
      description: `Live snapshot of ${info.label} database “${database}”. Read-only. Not stored as a draft unless you save it.`,
    }),
    details,
  );
  return {
    engine: conn.engine,
    engineLabel: info.label,
    objectLabel: info.objectLabel,
    database,
    connectionId,
    connectionName: conn.name,
    schema,
    details,
    objectCount: (graph.tables || []).length,
    truncated: ranked.length > DETAIL_CAP,
  };
}

function liveDigest(snapshot) {
  const lines = [];
  const details = snapshot.details || {};
  for (const obj of snapshot.schema.objects.slice(0, 40)) {
    const live = details[obj.name];
    const idx = (live?.indexes || []).map((i) => i.name).join(', ') || 'none';
    const cols = obj.columns
      .slice(0, 18)
      .map((c) => `${c.name}:${c.type}${c.pk ? '*' : ''}${c.fk ? '>' : ''}`)
      .join(', ');
    lines.push(`- ${obj.name} (${obj.kind}, ~${obj.rows ?? live?.estimatedCount ?? 0} rows, indexes: ${idx}) fields: ${cols}`);
  }
  for (const r of snapshot.schema.relations.slice(0, 80)) {
    lines.push(`  rel ${r.from}.${r.fromColumn} -> ${r.to}.${r.toColumn}${r.inferred ? ' inferred' : ''}`);
  }
  return lines.join('\n').slice(0, 18_000);
}

function schemaDigest(schema) {
  const doc = normalizeSchema(schema);
  const lines = [`Engine: ${doc.engine}`, `Name: ${doc.name}`, doc.description ? `Description: ${doc.description}` : ''];
  for (const obj of doc.objects) {
    const cols = obj.columns.map((c) => `${c.name}:${c.type}${c.pk ? '*' : ''}${c.fk ? '>' : ''}${c.unique ? '!' : ''}${c.note ? ` (${c.note})` : ''}`).join(', ');
    lines.push(`- ${obj.name} [${obj.kind}] ${obj.note || ''} :: ${cols}`);
  }
  for (const r of doc.relations) {
    lines.push(`  ${r.kind} ${r.from}.${r.fromColumn} -> ${r.to}.${r.toColumn}${r.required ? ' required' : ''}${r.inferred ? ' inferred' : ''}${r.note ? ` // ${r.note}` : ''}`);
  }
  for (const n of doc.notes) {
    lines.push(`  note${n.object ? ` on ${n.object}` : ''}: ${n.text}`);
  }
  return lines.filter(Boolean).join('\n').slice(0, 16_000);
}

function findingPrompt() {
  return `Return JSON only:
{
  "summary": "3-6 sentences: what will hurt at scale, what is already sound",
  "findings": [
    {
      "id": "f1",
      "severity": "error" | "warn" | "info",
      "kind": "missing-index" | "no-pk" | "orphan-risk" | "unbounded-array" | "wide-object" | "hot-unindexed" | "hub-bottleneck" | "type-mismatch" | "inferred-relation" | "missing-unique" | "opaque-json" | "required-cycle" | "undeclared-ref" | "naming" | "other",
      "object": "collection_or_table_name",
      "column": "optional field",
      "relation": "optional relation id",
      "title": "short label for the canvas badge",
      "detail": "what goes wrong, for this engine",
      "fix": "concrete next step"
    }
  ]
}
Rules:
- Attach every finding to a real object name from the schema. Put the field in column when it is about one field.
- Visualizer reads object/column/relation — never leave findings as floating prose.
- Prefer 4–16 findings. Skip nits. Severity error = will break integrity or sequential scans on large data; warn = likely bottleneck; info = hygiene.
- Respect the engine: Mongo has no native FKs (inferred refs + indexes); SQL should use real FKs and indexes on FK columns.
- Do not invent tables. Do not suggest writes that this tool would execute — this is advice only.`;
}

function parseAiFindings(text) {
  const parsed = extractJson(text);
  const findings = Array.isArray(parsed.findings) ? parsed.findings.map((f, i) => normalizeFinding({ ...f, source: 'ai' }, i)) : [];
  return {
    summary: String(parsed.summary || '').trim().slice(0, 2000),
    findings,
  };
}

export async function critiqueSchema({ schema, liveText } = {}) {
  const doc = normalizeSchema(schema);
  const rules = analyzeSchemaRules(doc, liveText ? undefined : null);
  const system = `You are a database schema reviewer for a local backup/explore tool. Engines: MongoDB, PostgreSQL, MySQL, MariaDB, SQLite, SQL Server.
The user is brainstorming or inspecting a schema. You never execute SQL or writes.
${findingPrompt()}`;
  const user = liveText
    ? `Live ${doc.engine} schema (sampled, read-only):\n${liveText}\n\nHeuristic findings already raised (do not repeat, add what they missed):\n${JSON.stringify(rules.slice(0, 20))}`
    : `Draft schema:\n${schemaDigest(doc)}\n\nHeuristic findings already raised (do not repeat unless you can sharpen them):\n${JSON.stringify(rules.slice(0, 20))}`;
  const { text, model, usage } = await completeChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { json: true, maxTokens: 2800, timeoutMs: 75_000 },
  );
  const ai = parseAiFindings(text);
  return {
    findings: mergeFindings(rules, ai.findings),
    summary: ai.summary,
    model,
    usage,
    ai: true,
  };
}

export async function analyzeDraft(schema) {
  const doc = normalizeSchema(schema);
  const rules = analyzeSchemaRules(doc);
  const status = aiStatus();
  if (!status.enabled) {
    return {
      schema: { ...doc, findings: rules, analysisSummary: 'Rule pass only — add an OpenRouter key in Settings for an AI review.', analyzedAt: new Date().toISOString() },
      findings: rules,
      summary: 'Rule pass only. AI review is off.',
      ai: false,
    };
  }
  try {
    const ai = await critiqueSchema({ schema: doc });
    const summary = ai.summary || '';
    return {
      schema: { ...doc, findings: ai.findings, analysisSummary: summary, analyzedAt: new Date().toISOString() },
      findings: ai.findings,
      summary,
      model: ai.model,
      ai: true,
    };
  } catch (err) {
    return {
      schema: { ...doc, findings: rules, analysisSummary: `AI review failed (${err.message}). Showing rule-based findings.`, analyzedAt: new Date().toISOString() },
      findings: rules,
      summary: err.message,
      ai: false,
      error: err.message,
    };
  }
}

export async function analyzeLive({ connectionId, database }) {
  const snapshot = await snapshotLive({ connectionId, database });
  const rules = analyzeSchemaRules(snapshot.schema, { details: snapshot.details });
  const status = aiStatus();
  let findings = rules;
  let summary = '';
  let model = null;
  let ai = false;
  let error = null;
  if (status.enabled) {
    try {
      const result = await critiqueSchema({ schema: snapshot.schema, liveText: liveDigest(snapshot) });
      findings = mergeFindings(rules, result.findings);
      summary = result.summary;
      model = result.model;
      ai = true;
    } catch (err) {
      error = err.message;
      summary = `AI review failed (${err.message}). Showing rule-based findings from schema, indexes and row counts.`;
    }
  } else {
    summary = 'Rule pass on schema, indexes and row counts. Add an OpenRouter key in Settings for an AI review.';
  }
  const schema = {
    ...snapshot.schema,
    findings,
    analysisSummary: summary,
    analyzedAt: new Date().toISOString(),
  };
  return {
    ...snapshot,
    schema,
    findings,
    summary,
    model,
    ai,
    error,
  };
}

function coerceEngine(engine) {
  return SCHEMA_ENGINES.includes(engine) ? engine : 'any';
}

export async function draftSchema({ prompt, engine = 'any', current } = {}) {
  const question = String(prompt || '').trim();
  if (!question) throw new Error('Describe the schema you want to build');
  const target = coerceEngine(engine);
  const info = target === 'any' ? { label: 'engine-agnostic (Mongo or SQL)' } : engineInfo(target);
  const existing = current ? schemaDigest(current) : '';
  const system = `You design portable database schemas for a local brainstorming canvas (not connected to a live database).
Target engine: ${info.label} (${target}).
If engine is "any", prefer names and types that map to both MongoDB collections and SQL tables (use _id/objectId for Mongo-flavoured keys, or id/uuid — pick one style and stay consistent).
Return JSON only:
{
  "name": "short title",
  "engine": "${target}",
  "description": "what this model is for",
  "objects": [
    {
      "name": "users",
      "kind": "${target === 'mongodb' ? 'collection' : target === 'any' ? 'collection' : 'table'}",
      "note": "one-line purpose",
      "columns": [
        { "name": "_id", "type": "objectId", "pk": true, "unique": true, "required": true, "note": "" }
      ]
    }
  ],
  "relations": [
    { "from": "orders", "fromColumn": "userId", "to": "users", "toColumn": "_id", "kind": "many-to-one", "required": true, "note": "" }
  ],
  "notes": [
    { "text": "canvas sticky note", "object": "optional object name" }
  ]
}
Rules:
- 3–14 objects unless the user asked for less/more. Include realistic fields, not just ids.
- Mark primary keys. Mark FK fields fk:true and add a relations[] entry.
- Mongo: _id objectId, refs as userId objectId, arrays only when they stay small.
- SQL: id uuid or integer PK, real FKs, snake_case or the user's convention.
- Notes are for the canvas (invariants, open questions), not essays.
- ${existing ? 'Revise the current schema. Keep names the user already used unless they asked to rename.' : 'Invent a coherent model from the prompt.'}`;
  const { text, model, usage } = await completeChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: existing ? `Current schema:\n${existing}\n\nInstruction:\n${question}` : question },
    ],
    { json: true, maxTokens: 3500, timeoutMs: 75_000 },
  );
  const parsed = extractJson(text);
  const schema = normalizeSchema({
    ...parsed,
    engine: parsed.engine || target,
    messages: [
      ...((current && current.messages) || []),
      { role: 'user', text: question, at: new Date().toISOString() },
      { role: 'assistant', text: parsed.description || 'Updated the schema on the canvas.', at: new Date().toISOString() },
    ],
  });
  schema.findings = analyzeSchemaRules(schema);
  return { schema, model, usage };
}

export async function reviseSchema({ instruction, current }) {
  return draftSchema({ prompt: instruction, engine: current?.engine, current });
}

export function publicDraft(row) {
  if (!row) return null;
  const schema = normalizeSchema(row.schema || row);
  const stats = {
    objects: schema.objects.length,
    relations: schema.relations.length,
    notes: schema.notes.length,
    errors: schema.findings.filter((f) => f.severity === 'error').length,
    warns: schema.findings.filter((f) => f.severity === 'warn').length,
  };
  return {
    id: row.id,
    name: row.name || schema.name,
    engine: row.engine || schema.engine,
    description: row.description || schema.description,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    analyzedAt: schema.analyzedAt,
    stats,
  };
}

export { emptySchema, normalizeSchema };
