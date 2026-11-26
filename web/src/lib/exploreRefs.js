/** Map of column name → lookup target for the current object (SQL FKs + inferred Mongo refs). */
export function buildColumnLinks({ object, meta, graph }) {
  const links = {};
  for (const fk of meta?.foreignKeys || []) {
    links[fk.column] = {
      targetObject: fk.refTable,
      targetField: fk.refColumn || 'id',
      inferred: false,
    };
  }
  for (const rel of graph?.relations || []) {
    if (rel.from !== object) continue;
    if (links[rel.fromColumn]) continue;
    links[rel.fromColumn] = {
      targetObject: rel.to,
      targetField: rel.toColumn || '_id',
      inferred: Boolean(rel.inferred),
    };
  }
  const table = graph?.tables?.find((t) => t.name === object);
  for (const col of table?.columns || []) {
    if (!col.fk || links[col.name]) continue;
    const rel = graph.relations?.find((r) => r.from === object && r.fromColumn === col.name);
    if (rel) {
      links[col.name] = {
        targetObject: rel.to,
        targetField: rel.toColumn || '_id',
        inferred: true,
      };
    }
  }
  return links;
}

export function linkValueRaw(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    if (value.$oid) return value.$oid;
    return null;
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  return null;
}

export function isLinkableValue(value) {
  return linkValueRaw(value) != null;
}