import { typesFor } from './schema.js';

export const NESTABLE_TYPES = new Set(['object', 'array', 'json', 'jsonb', 'map', 'document']);

export function canNestType(type) {
  return NESTABLE_TYPES.has(String(type || '').toLowerCase().replace(/\(.*\)$/, ''));
}

export function pathKey(path) {
  if (path == null || path === '') return '';
  return Array.isArray(path) ? path.join('.') : String(path);
}

export function parsePath(path) {
  if (Array.isArray(path)) return path;
  if (!path) return [];
  return String(path).split('.');
}

export function blankColumn(engine, columns, { nested = false } = {}) {
  const types = typesFor(engine);
  const idx = (columns?.length || 0) + 1;
  return {
    name: uniqueFieldName(columns, nested ? 'subfield' : 'field'),
    type: nested ? 'string' : types[1] || 'string',
    pk: false,
    fk: false,
    unique: false,
    required: false,
    note: '',
    children: [],
  };
}

export function uniqueFieldName(columns, base = 'field') {
  const names = new Set((columns || []).map((c) => c.name));
  let n = 1;
  let name = `${base}_${n}`;
  while (names.has(name)) {
    n += 1;
    name = `${base}_${n}`;
  }
  return name;
}

function locate(columns, pathParts) {
  if (!pathParts.length) return { parent: null, list: columns, index: -1, column: null };
  let list = columns;
  let parent = null;
  for (let i = 0; i < pathParts.length; i += 1) {
    const index = list.findIndex((c) => c.name === pathParts[i]);
    if (index < 0) return { parent: null, list, index: -1, column: null };
    const column = list[index];
    if (i === pathParts.length - 1) return { parent, list, index, column };
    parent = column;
    list = column.children || [];
  }
  return { parent: null, list, index: -1, column: null };
}

export function updateAtPath(columns, path, updater) {
  const parts = parsePath(path);
  if (!parts.length) return columns;
  const root = columns.map((c) => ({ ...c, children: [...(c.children || [])] }));
  const walk = (list, depth) => {
    const i = list.findIndex((c) => c.name === parts[depth]);
    if (i < 0) return;
    if (depth === parts.length - 1) {
      list[i] = updater({ ...list[i], children: [...(list[i].children || [])] });
      return;
    }
    walk(list[i].children || (list[i].children = []), depth + 1);
  };
  walk(root, 0);
  return root;
}

export function removeAtPath(columns, path) {
  const parts = parsePath(path);
  if (!parts.length) return columns;
  const root = columns.map((c) => ({ ...c, children: [...(c.children || [])] }));
  const walk = (list, depth) => {
    const i = list.findIndex((c) => c.name === parts[depth]);
    if (i < 0) return;
    if (depth === parts.length - 1) list.splice(i, 1);
    else walk(list[i].children || [], depth + 1);
  };
  walk(root, 0);
  return root;
}

export function addSibling(columns, path, engine) {
  const parts = parsePath(path);
  const root = columns.map((c) => ({ ...c, children: [...(c.children || [])] }));
  if (!parts.length) {
    root.push(blankColumn(engine, root));
    return root;
  }
  const parentParts = parts.slice(0, -1);
  const insert = (list, depth) => {
    if (depth === parentParts.length) {
      const i = list.findIndex((c) => c.name === parts[parts.length - 1]);
      const field = blankColumn(engine, list);
      if (i >= 0) list.splice(i + 1, 0, field);
      else list.push(field);
      return;
    }
    const idx = list.findIndex((c) => c.name === parentParts[depth]);
    if (idx < 0) return;
    insert(list[idx].children || (list[idx].children = []), depth + 1);
  };
  if (parentParts.length === 0) {
    const i = root.findIndex((c) => c.name === parts[0]);
    const field = blankColumn(engine, root);
    if (i >= 0) root.splice(i + 1, 0, field);
    else root.push(field);
  } else insert(root, 0);
  return root;
}

export function addChild(columns, path, engine) {
  const parts = parsePath(path);
  if (!parts.length) return columns;
  return updateAtPath(columns, path, (col) => {
    const kids = [...(col.children || [])];
    kids.push(blankColumn(engine, kids, { nested: true }));
    return { ...col, children: kids, type: canNestType(col.type) ? col.type : 'object' };
  });
}

export function flattenColumns(columns, { expanded, max = 999, depth = 0, path = [] } = {}) {
  const out = [];
  const exp = expanded instanceof Set ? expanded : new Set();
  for (const c of columns || []) {
    const nextPath = [...path, c.name];
    const key = pathKey(nextPath);
    const hasKids = (c.children || []).length > 0;
    const canNest = canNestType(c.type);
    const open = hasKids || (canNest && exp.has(key));
    out.push({ column: c, path: nextPath, key, depth, hasChildren: hasKids, canNest, open });
    if (out.length >= max) return out;
    if (hasKids && (exp.has(key) || exp.has('*'))) {
      const nested = flattenColumns(c.children, { expanded, max: max - out.length, depth: depth + 1, path: nextPath });
      out.push(...nested);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function countRows(columns, expanded) {
  return flattenColumns(columns, { expanded: expanded || new Set(['*']), max: 10_000 }).length;
}

export function walkColumns(columns, visitor, path = []) {
  for (const c of columns || []) {
    const next = [...path, c.name];
    visitor(c, next);
    if (c.children?.length) walkColumns(c.children, visitor, next);
  }
}