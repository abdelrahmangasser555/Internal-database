export const SCHEMA_FORMAT = 'backup-service-schema-v1';

export const SCHEMA_ENGINES = ['mongodb', 'postgres', 'mysql', 'mariadb', 'sqlite', 'mssql', 'any'];

export const RELATION_KINDS = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'];

export const FINDING_SEVERITIES = ['error', 'warn', 'info'];

const ID_SUFFIX = /(_id|Id|_ids|Ids)$/;

export function objectKindFor(engine) {
  return engine === 'mongodb' ? 'collection' : engine === 'any' ? 'collection' : 'table';
}

export function isDocumentEngine(engine) {
  return engine === 'mongodb' || engine === 'any';
}

function slug(value, fallback) {
  const s = String(value || '')
    .trim()
    .replace(/\s+/g, '_');
  return s || fallback;
}

export function defaultColumnType(engine, name) {
  const n = String(name || '');
  if (engine === 'mongodb') {
    if (n === '_id' || ID_SUFFIX.test(n)) return 'objectId';
    if (/At$|Date$|_at$|_date$/.test(n)) return 'date';
    if (/^(is|has|can)[A-Z]/.test(n)) return 'boolean';
    if (/count|qty|amount|total/i.test(n)) return 'number';
    return 'string';
  }
  if (n === 'id' || n.endsWith('_id')) return 'uuid';
  if (/_at$|_date$/.test(n)) return 'timestamptz';
  if (/^(is_|has_|can_)/.test(n)) return 'boolean';
  if (/count|qty|amount|total/.test(n)) return 'integer';
  return engine === 'mssql' ? 'nvarchar(255)' : 'text';
}

export function normalizeColumn(raw, i = 0, engine = 'any') {
  const name = slug(raw?.name, `field_${i + 1}`);
  const nullable = raw?.nullable;
  return {
    name,
    type: String(raw?.type || defaultColumnType(engine, name)).trim() || 'string',
    pk: Boolean(raw?.pk),
    fk: Boolean(raw?.fk),
    unique: Boolean(raw?.unique),
    required: raw?.required == null ? (nullable == null ? Boolean(raw?.pk) : !nullable) : Boolean(raw.required),
    note: String(raw?.note || '').trim().slice(0, 400),
    presence: Number.isFinite(raw?.presence) ? raw.presence : null,
  };
}

export function normalizeObject(raw, i = 0, engine = 'any') {
  const kind = raw?.kind === 'table' || raw?.kind === 'view' || raw?.kind === 'collection' ? raw.kind : objectKindFor(engine);
  const name = slug(raw?.name || raw?.id, `object_${i + 1}`);
  const columns = Array.isArray(raw?.columns) ? raw.columns.map((col, j) => normalizeColumn(col, j, engine)) : [];
  return {
    id: slug(raw?.id || name, name),
    name,
    kind,
    note: String(raw?.note || '').trim().slice(0, 800),
    columns,
    rows: Number.isFinite(raw?.rows) ? raw.rows : Number.isFinite(raw?.estimatedCount) ? raw.estimatedCount : null,
    x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : null,
    y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : null,
  };
}

export function normalizeRelation(raw, i = 0) {
  return {
    id: slug(raw?.id, `rel_${i + 1}`),
    from: slug(raw?.from, ''),
    fromColumn: String(raw?.fromColumn || '').trim(),
    to: slug(raw?.to, ''),
    toColumn: String(raw?.toColumn || '').trim(),
    kind: RELATION_KINDS.includes(raw?.kind) ? raw.kind : 'many-to-one',
    required: Boolean(raw?.required),
    inferred: Boolean(raw?.inferred),
    note: String(raw?.note || '').trim().slice(0, 400),
  };
}

export function normalizeNote(raw, i = 0) {
  return {
    id: slug(raw?.id, `note_${i + 1}`),
    text: String(raw?.text || raw?.body || '').trim().slice(0, 2000),
    object: raw?.object ? slug(raw.object, '') : '',
    x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : null,
    y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : null,
  };
}

export function normalizeFinding(raw, i = 0) {
  const severity = FINDING_SEVERITIES.includes(raw?.severity)
    ? raw.severity
    : raw?.severity === 'danger' || raw?.severity === 'fail'
      ? 'error'
      : 'warn';
  return {
    id: slug(raw?.id, `f${i + 1}`),
    severity,
    kind: slug(raw?.kind, 'issue'),
    object: raw?.object ? String(raw.object).trim() : '',
    column: raw?.column ? String(raw.column).trim() : '',
    relation: raw?.relation ? String(raw.relation).trim() : '',
    title: String(raw?.title || 'Finding').trim().slice(0, 160),
    detail: String(raw?.detail || raw?.message || '').trim().slice(0, 1200),
    fix: String(raw?.fix || '').trim().slice(0, 600),
    source: raw?.source === 'ai' ? 'ai' : 'rules',
  };
}

export function normalizeMessage(raw, i = 0) {
  return {
    id: slug(raw?.id, `m${i + 1}`),
    role: raw?.role === 'assistant' ? 'assistant' : 'user',
    text: String(raw?.text || raw?.content || '').trim().slice(0, 8000),
    at: raw?.at || new Date().toISOString(),
  };
}

export function normalizeSchema(raw = {}) {
  const engine = SCHEMA_ENGINES.includes(raw.engine) ? raw.engine : 'any';
  let objects = Array.isArray(raw.objects) ? raw.objects : [];
  if (!objects.length && Array.isArray(raw.tables)) objects = raw.tables;
  const relations = Array.isArray(raw.relations) ? raw.relations : [];
  const notes = Array.isArray(raw.notes) ? raw.notes : [];
  if (typeof raw.notes === 'string' && raw.notes.trim()) {
    notes.unshift({ id: 'overview', text: raw.notes });
  }
  return {
    format: SCHEMA_FORMAT,
    name: String(raw.name || 'Untitled schema').trim().slice(0, 120) || 'Untitled schema',
    engine,
    description: String(raw.description || '').trim().slice(0, 2000),
    objects: objects.map((item, i) => normalizeObject(item, i, engine)),
    relations: relations.map((item, i) => normalizeRelation(item, i)).filter((r) => r.from && r.to),
    notes: notes.map((item, i) => normalizeNote(item, i)).filter((n) => n.text),
    findings: Array.isArray(raw.findings) ? raw.findings.map((item, i) => normalizeFinding(item, i)) : [],
    messages: Array.isArray(raw.messages) ? raw.messages.slice(-40).map((item, i) => normalizeMessage(item, i)) : [],
    analysisSummary: String(raw.analysisSummary || '').trim().slice(0, 2000),
    analyzedAt: raw.analyzedAt || null,
  };
}

export function emptySchema(partial = {}) {
  return normalizeSchema({
    name: 'Untitled schema',
    engine: 'any',
    objects: [],
    relations: [],
    notes: [],
    findings: [],
    messages: [],
    ...partial,
  });
}

export function schemaFromGraph(graph, { engine = 'any', name, description } = {}) {
  const tables = graph?.tables || [];
  const objects = tables.map((t) => ({
    id: t.name,
    name: t.name,
    kind: t.type === 'collection' || engine === 'mongodb' ? 'collection' : t.type === 'view' ? 'view' : 'table',
    note: t.note || '',
    rows: t.rows,
    columns: (t.columns || []).map((c) => ({
      name: c.name,
      type: c.type || '',
      pk: Boolean(c.pk),
      fk: Boolean(c.fk),
      unique: Boolean(c.unique),
      required: c.nullable === false || Boolean(c.pk),
      presence: c.presence,
      note: c.note || '',
    })),
  }));
  const relations = (graph?.relations || []).map((r) => ({
    from: r.from,
    fromColumn: r.fromColumn,
    to: r.to,
    toColumn: r.toColumn,
    kind: r.kind || 'many-to-one',
    inferred: Boolean(r.inferred),
    required: r.required == null ? !r.inferred : Boolean(r.required),
    note: r.note || '',
  }));
  return normalizeSchema({ name: name || 'Live schema', engine, description, objects, relations });
}

export function graphFromSchema(schema) {
  const doc = normalizeSchema(schema);
  return {
    tables: doc.objects.map((o) => ({
      name: o.name,
      type: o.kind,
      rows: o.rows || 0,
      columns: o.columns,
      note: o.note,
    })),
    relations: doc.relations,
    inferred: doc.relations.some((r) => r.inferred),
  };
}

export function summarizeSchema(schema) {
  const doc = normalizeSchema(schema);
  const findings = doc.findings || [];
  return {
    objects: doc.objects.length,
    relations: doc.relations.length,
    notes: doc.notes.length,
    errors: findings.filter((f) => f.severity === 'error').length,
    warns: findings.filter((f) => f.severity === 'warn').length,
    infos: findings.filter((f) => f.severity === 'info').length,
  };
}

export function findingKey(f) {
  return `${f.kind}|${f.object}|${f.column || ''}|${f.relation || ''}`;
}

export function mergeFindings(base, extra) {
  const out = [];
  const seen = new Set();
  for (const raw of [...(base || []), ...(extra || [])]) {
    const f = normalizeFinding(raw, out.length);
    const key = findingKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...f, id: `f${out.length + 1}` });
  }
  const rank = { error: 0, warn: 1, info: 2 };
  out.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.object.localeCompare(b.object));
  return out;
}

function typeFamily(type) {
  const t = String(type || '').toLowerCase();
  if (/objectid|oid/.test(t)) return 'oid';
  if (/uuid|uniqueidentifier|guid/.test(t)) return 'uuid';
  if (/int|serial|number|long|decimal|numeric|float|double|money/.test(t)) return 'num';
  if (/bool/.test(t)) return 'bool';
  if (/date|time/.test(t)) return 'time';
  if (/json|object|bson/.test(t)) return 'json';
  if (/array|\[\]/.test(t)) return 'array';
  if (/bin|bytea|blob/.test(t)) return 'bin';
  return 'str';
}

function looksLikeId(name) {
  return name === '_id' || name === 'id' || ID_SUFFIX.test(name);
}

function indexColumnSet(indexes = []) {
  const set = new Set();
  for (const idx of indexes) {
    const def = idx?.definition;
    if (def && typeof def === 'object') {
      Object.keys(def).forEach((k) => set.add(k));
      continue;
    }
    const text = String(def || '');
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.keys(parsed).forEach((k) => set.add(k));
        continue;
      }
    } catch {
      // SQL index definition
    }
    const parens = text.match(/\(([^)]+)\)/);
    if (parens) {
      for (const part of parens[1].split(',')) {
        const col = part.trim().replace(/["`\[\]]/g, '').split(/\s+/)[0];
        if (col && !/^(asc|desc|nulls)$/i.test(col)) set.add(col);
      }
    }
    if (idx?.primary && idx?.name) set.add('_id');
  }
  return set;
}

function objectByName(schema) {
  const map = new Map();
  for (const o of schema.objects) {
    map.set(o.name, o);
    map.set(o.id, o);
  }
  return map;
}

function columnOf(obj, name) {
  if (!obj || !name) return null;
  return obj.columns.find((c) => c.name === name) || null;
}

/**
 * Engine-agnostic rule pass. Works on brainstorm drafts and live snapshots.
 * `live` is optional: { details: { [objectName]: { indexes, estimatedCount, sampleSize, columns } } }
 */
export function analyzeSchemaRules(schema, live = null) {
  const doc = normalizeSchema(schema);
  const findings = [];
  const push = (item) => findings.push(normalizeFinding({ ...item, source: 'rules' }, findings.length));
  const byName = objectByName(doc);
  const engine = doc.engine;
  const document = isDocumentEngine(engine);
  const details = live?.details || {};

  const names = new Set();
  for (const obj of doc.objects) {
    if (names.has(obj.name)) {
      push({
        severity: 'error',
        kind: 'duplicate-object',
        object: obj.name,
        title: `Duplicate ${obj.kind} name`,
        detail: `Two objects share the name “${obj.name}”. Queries and restores will collide.`,
        fix: 'Rename one of them so each collection/table is unique.',
      });
    }
    names.add(obj.name);

    if (!obj.columns.length) {
      push({
        severity: 'warn',
        kind: 'empty-object',
        object: obj.name,
        title: `${obj.kind} has no fields`,
        detail: `“${obj.name}” is empty, so relations and indexes cannot be planned.`,
        fix: 'Add a primary key and the fields this entity actually stores.',
      });
      continue;
    }

    const pk = obj.columns.filter((c) => c.pk);
    if (!pk.length && obj.kind !== 'view') {
      push({
        severity: document ? 'warn' : 'error',
        kind: 'no-pk',
        object: obj.name,
        title: 'No primary key',
        detail: document
          ? `Mongo collections need a stable _id. “${obj.name}” has none in this draft.`
          : `SQL table “${obj.name}” has no primary key. Updates, FKs and replication become expensive and unsafe.`,
        fix: document ? 'Add an _id objectId primary key.' : 'Add a primary key (uuid or identity integer).',
      });
    }

    if (obj.columns.length > 36) {
      push({
        severity: 'warn',
        kind: 'wide-object',
        object: obj.name,
        title: 'Wide document / table',
        detail: `“${obj.name}” has ${obj.columns.length} fields. Wide rows slow scans, backups and ORM hydration.`,
        fix: 'Split rarely-read groups into a child table/collection or a JSON column with a documented shape.',
      });
    }

    const colNames = new Set();
    for (const col of obj.columns) {
      if (colNames.has(col.name)) {
        push({
          severity: 'error',
          kind: 'duplicate-column',
          object: obj.name,
          column: col.name,
          title: 'Duplicate field',
          detail: `“${obj.name}.${col.name}” is declared twice.`,
          fix: 'Keep a single definition.',
        });
      }
      colNames.add(col.name);

      if (/^(email|username)$/i.test(col.name) && !col.unique) {
        push({
          severity: 'warn',
          kind: 'missing-unique',
          object: obj.name,
          column: col.name,
          title: `${col.name} is not unique`,
          detail: `Login and lookup fields need a unique constraint or unique index.`,
          fix: 'Mark it unique (and required).',
        });
      }

      const family = typeFamily(col.type);
      if (family === 'array' && (obj.rows || 0) > 10_000) {
        push({
          severity: 'warn',
          kind: 'unbounded-array',
          object: obj.name,
          column: col.name,
          title: 'Array on a large collection',
          detail: `“${obj.name}.${col.name}” is an array and this object already looks large. Unbounded arrays become write and document-size bottlenecks.`,
          fix: 'Move the array to a child collection keyed by this document’s id, and index the parent id.',
        });
      }

      if (family === 'json' && !col.note) {
        push({
          severity: 'info',
          kind: 'opaque-json',
          object: obj.name,
          column: col.name,
          title: 'Opaque JSON / object field',
          detail: `“${obj.name}.${col.name}” is unstructured. Querying inside it is slow and easy to drift.`,
          fix: 'Document the shape in a note, or promote hot keys to real columns with indexes.',
        });
      }

      if (document && col.name === 'id' && obj.columns.some((c) => c.name === '_id')) {
        push({
          severity: 'info',
          kind: 'id-confusion',
          object: obj.name,
          column: 'id',
          title: 'Both id and _id',
          detail: 'Mongo already has _id. A second id field usually duplicates keys and breaks joins.',
          fix: 'Keep _id as the canonical key, or store an external id under a named field (legacyId).',
        });
      }
    }
  }

  const incoming = new Map();
  for (const rel of doc.relations) {
    const from = byName.get(rel.from);
    const to = byName.get(rel.to);
    if (!from) {
      push({
        severity: 'error',
        kind: 'missing-from',
        relation: rel.id,
        title: 'Relation source missing',
        detail: `Relation ${rel.from} → ${rel.to} points from an object that is not in the schema.`,
        fix: 'Add the source collection/table or retarget the relation.',
      });
      continue;
    }
    if (!to) {
      push({
        severity: 'error',
        kind: 'missing-to',
        object: rel.from,
        column: rel.fromColumn,
        relation: rel.id,
        title: 'Relation target missing',
        detail: `“${rel.from}.${rel.fromColumn}” points at “${rel.to}”, which does not exist.`,
        fix: 'Create the parent object or point at an existing one.',
      });
      continue;
    }
    incoming.set(rel.to, (incoming.get(rel.to) || 0) + 1);
    const fromCol = columnOf(from, rel.fromColumn);
    const toCol = columnOf(to, rel.toColumn);
    if (rel.fromColumn && !fromCol) {
      push({
        severity: 'error',
        kind: 'missing-fk-column',
        object: rel.from,
        column: rel.fromColumn,
        relation: rel.id,
        title: 'FK field is not on the child',
        detail: `Relation expects ${rel.from}.${rel.fromColumn}, but that field is not declared.`,
        fix: `Add ${rel.fromColumn} on ${rel.from} (type matching ${rel.to}.${rel.toColumn || 'id'}).`,
      });
    } else if (fromCol && !fromCol.fk) {
      fromCol.fk = true;
    }
    if (rel.toColumn && !toCol) {
      push({
        severity: 'warn',
        kind: 'missing-pk-column',
        object: rel.to,
        column: rel.toColumn,
        relation: rel.id,
        title: 'Parent key missing',
        detail: `Relation targets ${rel.to}.${rel.toColumn}, which is not a declared field.`,
        fix: 'Add that key on the parent, usually the primary key.',
      });
    }
    if (fromCol && toCol && typeFamily(fromCol.type) !== typeFamily(toCol.type) && typeFamily(fromCol.type) !== 'str') {
      push({
        severity: 'warn',
        kind: 'type-mismatch',
        object: rel.from,
        column: rel.fromColumn,
        relation: rel.id,
        title: 'Join types do not match',
        detail: `${rel.from}.${rel.fromColumn} is ${fromCol.type}, ${rel.to}.${rel.toColumn} is ${toCol.type}. Joins and indexes will fail or scan.`,
        fix: 'Use the same type on both sides (objectId↔objectId, uuid↔uuid, int↔int).',
      });
    }
    if (rel.inferred) {
      push({
        severity: 'info',
        kind: 'inferred-relation',
        object: rel.from,
        column: rel.fromColumn,
        relation: rel.id,
        title: 'Inferred, not enforced',
        detail: `${rel.from}.${rel.fromColumn} → ${rel.to} was guessed from naming. The database will not reject orphans.`,
        fix: document
          ? 'Treat it as a real ref in the app, add an index, and validate on write.'
          : 'Add a real foreign key constraint.',
      });
    } else if (!rel.required && !document) {
      push({
        severity: 'info',
        kind: 'orphan-risk',
        object: rel.from,
        column: rel.fromColumn,
        relation: rel.id,
        title: 'Optional foreign key',
        detail: `${rel.from}.${rel.fromColumn} can be null, so rows may exist without a parent.`,
        fix: 'If the child cannot exist alone, make the FK required. If it can, document it in a note.',
      });
    }

    const liveFrom = details[rel.from];
    const rows = liveFrom?.estimatedCount ?? from.rows ?? 0;
    if (liveFrom && rel.fromColumn && rows >= 1000) {
      const indexed = indexColumnSet(liveFrom.indexes);
      const pkNames = new Set((liveFrom.primaryKey || []).concat(from.columns.filter((c) => c.pk).map((c) => c.name)));
      if (!indexed.has(rel.fromColumn) && !pkNames.has(rel.fromColumn)) {
        push({
          severity: rows >= 50_000 ? 'error' : 'warn',
          kind: 'missing-fk-index',
          object: rel.from,
          column: rel.fromColumn,
          relation: rel.id,
          title: 'FK without an index',
          detail: `${rel.from} has ~${rows.toLocaleString()} rows and ${rel.fromColumn} is used to join ${rel.to}, but it is not indexed. Joins and cascade lookups become table scans.`,
          fix: `Create an index on ${rel.from}(${rel.fromColumn}).`,
        });
      }
    }
  }

  for (const obj of doc.objects) {
    const liveObj = details[obj.name];
    const rows = liveObj?.estimatedCount ?? obj.rows ?? 0;
    const indexes = liveObj?.indexes || [];
    if (liveObj && rows >= 20_000) {
      const nonPk = indexes.filter((idx) => !idx.primary && idx.name !== '_id_');
      if (nonPk.length === 0) {
        push({
          severity: rows >= 100_000 ? 'error' : 'warn',
          kind: 'hot-unindexed',
          object: obj.name,
          title: 'Large object with almost no indexes',
          detail: `“${obj.name}” has ~${rows.toLocaleString()} rows/documents and only a primary key index. Filters on tenant, status or foreign keys will scan.`,
          fix: 'Add indexes for the filters and joins you actually run (tenant, createdAt, FK columns).',
        });
      }
    }
    const fans = incoming.get(obj.name) || 0;
    if (fans >= 6 && rows >= 10_000) {
      push({
        severity: 'warn',
        kind: 'hub-bottleneck',
        object: obj.name,
        title: 'Hot hub entity',
        detail: `“${obj.name}” is referenced by ${fans} other objects and already looks large. It will be a write and lock bottleneck.`,
        fix: 'Keep the hub row small, index inbound FKs on children, and avoid updating the hub on every child write.',
      });
    }
    if (document) {
      for (const col of obj.columns) {
        if (looksLikeId(col.name) && col.name !== '_id' && typeFamily(col.type) === 'oid') {
          const hits = doc.relations.some((r) => r.from === obj.name && r.fromColumn === col.name);
          if (!hits) {
            push({
              severity: 'info',
              kind: 'undeclared-ref',
              object: obj.name,
              column: col.name,
              title: 'ObjectId field with no relation',
              detail: `“${obj.name}.${col.name}” looks like a reference but is not linked on the canvas.`,
              fix: 'Draw the relation, or note why it is an opaque id.',
            });
          }
        }
      }
    }
  }

  const requiredEdges = doc.relations.filter((r) => r.required);
  const adj = new Map();
  for (const r of requiredEdges) {
    if (!adj.has(r.from)) adj.set(r.from, []);
    adj.get(r.from).push(r.to);
  }
  const visiting = new Set();
  const seen = new Set();
  const walk = (node, stack) => {
    if (visiting.has(node)) {
      const cycle = [...stack, node].join(' → ');
      push({
        severity: 'error',
        kind: 'required-cycle',
        object: node,
        title: 'Required-relation cycle',
        detail: `Insert order cannot be solved: ${cycle}. Every side requires the other.`,
        fix: 'Make one FK optional, or break the cycle with a join table.',
      });
      return;
    }
    if (seen.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of adj.get(node) || []) walk(next, stack);
    stack.pop();
    visiting.delete(node);
    seen.add(node);
  };
  for (const obj of doc.objects) walk(obj.name, []);

  return mergeFindings(findings, []);
}

export function applyLiveDetails(schema, details = {}) {
  const doc = normalizeSchema(schema);
  doc.objects = doc.objects.map((obj) => {
    const live = details[obj.name];
    if (!live) return obj;
    const byCol = new Map((live.columns || []).map((c) => [c.name, c]));
    return {
      ...obj,
      rows: live.estimatedCount ?? obj.rows,
      columns: obj.columns.map((c) => {
        const lc = byCol.get(c.name);
        if (!lc) return c;
        return {
          ...c,
          type: c.type || lc.type || '',
          pk: c.pk || Boolean(lc.pk),
          fk: c.fk || Boolean(lc.fk),
          unique: c.unique || Boolean(lc.unique),
          required: lc.nullable == null ? c.required : !lc.nullable,
          presence: lc.presence ?? c.presence,
        };
      }),
    };
  });
  return doc;
}
