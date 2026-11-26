import { ENGINES, engineInfo, isSqlEngine } from './engines.js';
import { SEED_FORMAT, exampleSeed } from './seed-format.js';

const EXAMPLE = JSON.stringify(exampleSeed(), null, 2);

function formatBlock() {
  return `## Output format (required)

Return **one** JSON object. No markdown around it unless the host forces a fence — if you must fence, use \`\`\`json.

\`\`\`
{
  "format": "${SEED_FORMAT}",
  "version": 1,
  "name": "short human name",
  "description": "what this fixture is for",
  "engine": "<mongodb|postgres|mysql|mariadb|sqlite|mssql|any>",
  "notes": "optional author notes",
  "objects": [
    {
      "name": "users",
      "kind": "collection | table",
      "pk": ["_id"],
      "columns": [
        { "name": "_id", "type": "string", "pk": true, "required": true },
        { "name": "email", "type": "string", "required": true }
      ],
      "rules": {
        "required": ["email"],
        "unique": ["email"],
        "allowOrphan": false
      },
      "refs": [
        {
          "field": "userId",
          "target": "users",
          "targetField": "_id",
          "required": true,
          "onMissing": "error | skip | null",
          "cardinality": "many-to-one | one-to-one | one-to-many | many-to-many",
          "note": "An observation cannot exist without a user."
        }
      ],
      "records": [ { "_id": "user_1", "email": "ada@example.com" } ],
      "note": "Root entity. Insert first."
    }
  ]
}
\`\`\`

### Rules for the JSON

1. \`format\` must be exactly \`${SEED_FORMAT}\`.
2. Put **each collection/table in its own object**. Do not dump unrelated entities into one array.
3. \`pk\` is the natural key used inside this seed (stable string ids like \`user_ada\` are better than random ObjectIds).
4. \`refs\` describe **how records connect**. Every foreign key, object id pointer, or join table belongs here.
5. \`required: true\` + \`onMissing: "error"\` means the child **cannot** be inserted without a matching parent in this seed (or already in the target database). Example: an observation without a user is illegal.
6. \`required: false\` + \`onMissing: "null"\` means the child **can** exist without the parent; the link is optional.
7. \`onMissing: "skip"\` drops the child row when the parent is absent.
8. \`rules.allowOrphan: true\` only when the domain truly allows records with no parent (rare). Default false.
9. \`rules.unique\` lists fields that must not repeat inside the seed (email, slug, code).
10. Insert order is derived from refs (parents first). You may add \`order: ["users", "observations"]\` if you want it explicit.
11. Keep fixtures small and realistic: enough rows to exercise every relationship, not a production dump.
12. Never put live passwords, API keys, or real PII. Use obviously fake values.
13. Nested paths are allowed on refs (\`patient.userId\`) but prefer a top-level field.
14. Many-to-many: add a join object (e.g. \`user_roles\`) with two required refs, not arrays of ids, unless the native model is an array (Mongo).
15. If a column is JSON/JSONB, store a JSON object, not a string.`;
}

function discoveryBlock() {
  return `## How to build the seed from a project

1. Find models / schemas / migrations / Prisma / Mongoose / TypeORM / SQL files.
2. List every entity that the fixture needs (start from the feature under test, walk parents).
3. For each entity write:
   - primary key (or a seed-local stable id)
   - required fields and unique fields
   - every relation: field → target entity → target field
   - whether the relation is mandatory (NOT NULL / required: true / belongs_to required)
4. State the condition in \`refs[].note\` in plain language: "this row is allowed without X" or "this row is illegal without X".
5. Emit 2–10 records per object so graphs are visible (two users, two child rows, one optional orphan only if the rule allows it).
6. Validate mentally: every required ref value exists on a parent record in this same JSON.`;
}

function edgeBlock() {
  return `## Edge cases you must handle

- Missing parent for a required ref → do not emit the child; or emit it and set onMissing error (the importer will reject it). Prefer omit.
- Optional parent → set required false, onMissing null, and you MAY omit the field.
- Self-refs (managerId → users) are allowed; put a root row with null manager first.
- Circular refs: break the cycle by making one side optional, or insert a stub parent.
- Composite keys: \`pk: ["orgId", "id"]\` and refs that point at both columns (one ref per column, same target).
- Soft deletes / status flags: include them as normal fields; do not invent a deleted parent that children still point at unless that is a real rule.
- Enums: only use values the schema allows.
- Timestamps: ISO-8601 strings.
- Mongo ObjectId: either a stable string id (\`user_ada\`) or \`{ "$oid": "24 hex chars" }\`. Prefer stable strings.
- SQL identity/serial: still send the pk in the record so children can reference it; the importer uses OVERRIDING / IDENTITY_INSERT when needed.
- Do not include views, migrations, or large blobs.`;
}

function exampleBlock() {
  return `## Tiny example

${EXAMPLE}`;
}

export function tallSkillPrompt() {
  return `# Skill: export a Backup Service seed

You are writing a **seed fixture** for Backup Service, a local database tool. The JSON you produce is imported there, simulated against a live connection, then optionally applied (insert, optional wipe of listed objects).

${formatBlock()}

${discoveryBlock()}

${edgeBlock()}

${exampleBlock()}

When the user points you at a codebase, inspect models and produce a complete \`${SEED_FORMAT}\` document covering the entities they named. Explain the graph in \`description\` and per-object \`note\` / \`refs[].note\`. Output the JSON last.`;
}

function dialectNotes(engine) {
  const info = engineInfo(engine);
  if (engine === 'mongodb') {
    return `## MongoDB dialect

- \`kind\` is \`"collection"\`. \`engine\` is \`"mongodb"\` (or \`"any"\` if the same fixture should also load into SQL with matching table names).
- Default pk is \`_id\`. Use stable string ids unless the app requires ObjectId.
- Refs are ordinary fields (\`userId\`) or nested (\`user._id\`). There are no native FKs — you MUST declare them in \`refs\` so the importer can enforce the graph.
- Arrays of ids: either a join collection, or \`cardinality: "many-to-many"\` on an array field.
- Extended JSON is allowed: \`{ "$oid": "..." }\`, \`{ "$date": "2024-01-01T00:00:00.000Z" }\`.
- Do not emit \`$out\` / \`$merge\` pipelines. This is data, not a query.`;
  }
  const ident =
    engine === 'mysql' || engine === 'mariadb'
      ? 'backtick-quoted identifiers'
      : engine === 'mssql'
        ? '[bracket] identifiers; default schema dbo'
        : engine === 'sqlite'
          ? 'double-quoted identifiers; no schemas'
          : 'double-quoted identifiers; default schema public';
  const json =
    engine === 'postgres'
      ? 'JSONB for nested objects'
      : engine === 'mysql' || engine === 'mariadb'
        ? 'JSON columns for nested objects'
        : 'TEXT holding JSON for nested objects';
  return `## ${info.label} dialect

- \`kind\` is \`"table"\`. \`engine\` is \`${engine}\`.
- Name tables the way the database stores them (${engine === 'postgres' ? '\`public.users\` or \`users\`' : engine === 'mssql' ? '\`dbo.users\` or \`users\`' : 'unqualified \`users\`'}).
- Identifiers: ${ident}.
- Nested values: ${json}.
- Declare SQL foreign keys in \`refs\` even if migrations already have them — the seed runner uses refs for insert order and orphan checks.
- NOT NULL columns belong in \`rules.required\` and \`columns[].required\`.
- Booleans: ${engine === 'mysql' || engine === 'mariadb' ? '0/1 or true/false' : engine === 'mssql' ? 'true/false (bit)' : 'true/false'}.
- ${engine === 'sqlite' ? 'The target is a file; CREATE TABLE will run if a listed table is missing and columns are provided.' : 'If a table is missing, the importer can CREATE TABLE from \`columns\` (best-effort types). Prefer seeding into an existing schema.'}`;
}

export function engineSkillPrompt(engine) {
  const info = engineInfo(engine);
  const family = isSqlEngine(engine) ? 'SQL tables' : 'MongoDB collections';
  return `# Skill: export a Backup Service seed for ${info.label}

You are writing a **${info.label}** seed fixture for Backup Service. Output one \`${SEED_FORMAT}\` JSON document that can be simulated and applied onto a ${info.label} connection.

Focus on ${family}. Set \`"engine": "${engine}"\`.

${formatBlock()}

${dialectNotes(engine)}

${discoveryBlock()}

${edgeBlock()}

${exampleBlock()}

When the user points you at their ${info.label} project, inspect schema/models and emit the JSON last.`;
}

export function listSkills() {
  return [
    {
      id: 'tall',
      engine: 'any',
      title: 'Universal seed export',
      subtitle: 'Long prompt for any stack. Copy into Cursor and point it at a project.',
      prompt: tallSkillPrompt(),
    },
    ...Object.keys(ENGINES).map((engine) => ({
      id: engine,
      engine,
      title: `${engineInfo(engine).label} seed export`,
      subtitle: `Same format, with ${engineInfo(engine).label} naming, types and relation rules.`,
      prompt: engineSkillPrompt(engine),
    })),
  ];
}
