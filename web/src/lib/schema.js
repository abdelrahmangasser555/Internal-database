export function graphToSchema(graph, engine = 'any') {
  const document = engine === 'mongodb' || engine === 'any';
  return {
    format: 'backup-service-schema-v1',
    name: 'Live schema',
    engine,
    description: '',
    objects: (graph?.tables || []).map((t) => ({
      id: t.name,
      name: t.name,
      kind: t.type || (document ? 'collection' : 'table'),
      note: t.note || '',
      rows: t.rows || 0,
      columns: (t.columns || []).map((c) => ({
        name: c.name,
        type: c.type || '',
        pk: Boolean(c.pk),
        fk: Boolean(c.fk),
        unique: Boolean(c.unique),
        required: c.nullable === false || Boolean(c.pk),
        note: c.note || '',
        presence: c.presence,
        children: [],
      })),
    })),
    relations: (graph?.relations || []).map((r, i) => ({
      id: r.id || `rel_${i + 1}`,
      from: r.from,
      fromColumn: r.fromColumn,
      to: r.to,
      toColumn: r.toColumn,
      kind: r.kind || 'many-to-one',
      required: r.required == null ? !r.inferred : Boolean(r.required),
      inferred: Boolean(r.inferred),
      note: r.note || '',
    })),
    notes: [],
    findings: graph?.findings || [],
    messages: [],
    analysisSummary: '',
    analyzedAt: null,
  };
}

export function severityOf(findings = []) {
  if (findings.some((f) => f.severity === 'error')) return 'error';
  if (findings.some((f) => f.severity === 'warn')) return 'warn';
  if (findings.length) return 'info';
  return null;
}

export function findingsFor(schema, { object, column, relation } = {}) {
  return (schema?.findings || []).filter((f) => {
    if (relation) return f.relation === relation || (f.object === object && f.column === column);
    if (column) return f.object === object && f.column === column;
    if (object) return f.object === object && !f.column;
    return false;
  });
}

export function objectFindings(schema, name) {
  return (schema?.findings || []).filter((f) => f.object === name);
}

export function relationFindings(schema, rel) {
  return (schema?.findings || []).filter((f) => {
    if (f.relation && (f.relation === rel.id || f.relation === `${rel.from}.${rel.fromColumn}`)) return true;
    return f.object === rel.from && f.column === rel.fromColumn && /relation|fk|index|orphan|type|inferred|cycle/i.test(f.kind);
  });
}

export const COLUMN_TYPES = {
  mongodb: ['objectId', 'string', 'number', 'boolean', 'date', 'decimal', 'binary', 'array', 'object'],
  sql: ['uuid', 'integer', 'bigint', 'text', 'varchar(255)', 'boolean', 'timestamptz', 'date', 'numeric', 'json', 'jsonb', 'bytea'],
};

export function typesFor(engine) {
  if (engine === 'mongodb') return COLUMN_TYPES.mongodb;
  if (engine === 'any') return [...COLUMN_TYPES.mongodb, ...COLUMN_TYPES.sql.filter((t) => !COLUMN_TYPES.mongodb.includes(t))];
  return COLUMN_TYPES.sql;
}
