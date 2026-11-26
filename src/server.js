import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { listConnections, saveConnection, deleteConnection, getConnection, listJobs, saveJob, deleteJob, patchJob, getJob, listRecords, getRecord, deleteRecord, getSettings, saveSettings, publicSettings, listRotationAudit, listWriteAudit, listSeeds, getSeed, saveSeed, deleteSeed, patchSeed, listDashboards, getDashboard, saveDashboard, deleteDashboard, listSchemaDrafts, getSchemaDraft, saveSchemaDraft, deleteSchemaDraft } from './core/store.js';
import { connectionInsight } from './core/insight.js';
import { listCollections, findDocuments, collectionStats, listIndexes, sampleUsers, closeClient } from './core/mongo.js';
import { runBackup, getRunning, listRunning, recordExists, decryptRecord, importBackupFile, tempDecryptDir } from './core/backup.js';
import { resolveConnection, testConnectionUri, healthCheckAll, closeAdapter } from './core/adapters/index.js';
import { ENGINES } from './core/engines.js';
import { verifyRecord } from './core/verify.js';
import { previewRestore, executeRestore } from './core/restore.js';
import { aiStatus, draftQuery, explainSchema, clearSchemaCache, testAi } from './core/ai.js';
import { applySeed, fullSeed, publicSeed, simulateSeed } from './core/seeds.js';
import { listSkills } from './core/seed-skills.js';
import { exampleSeed, validateSeed } from './core/seed-format.js';
import { addDashboardWidget, createDashboard, previewQuery, repairDashboard, reviseDashboard, runDashboard } from './core/dashboards.js';
import { analyzeDraft, analyzeLive, draftSchema, publicDraft } from './core/schema-studio.js';
import { emptySchema } from './core/schema-format.js';
import { computeNextRun, describeInterval, formatNext } from './core/schedule.js';
import { pickFile, pickFolder } from './core/dialogs.js';
import { revealPath, revealRecord } from './core/explorer.js';
import { autostartStatus, enableAutostart, disableAutostart } from './core/autostart.js';
import { previewRotation, executeRotation, filterRotationAudit, formatRotationAudit } from './core/rotate.js';
import { sendHtmlEmail, fromAddress } from './core/email.js';
import { deviceName, ROOT } from './core/paths.js';
import { getHashConfig } from './core/hash.js';

const uiDist = path.join(ROOT, 'web', 'dist');

function wrap(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      res.status(400).json({ error: err.message || String(err) });
    });
  };
}

function withExists(record) {
  return { ...record, exists: recordExists(record) };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use((req, res, next) => express.static(uiDist)(req, res, next));

  app.get('/api/meta', (_req, res) => {
    res.json({
      device: deviceName(),
      platform: process.platform,
      fromEmail: fromAddress(),
      autostart: autostartStatus(),
      hash: getHashConfig(getSettings()),
      engines: Object.values(ENGINES),
      ai: aiStatus(),
      node: process.versions.node,
    });
  });

  app.get('/api/running', (_req, res) => res.json(listRunning()));

  app.get(
    '/api/connections/health',
    wrap(async (_req, res) => {
      res.json(await healthCheckAll());
    }),
  );

  app.get('/api/connections', (_req, res) => res.json(listConnections()));

  app.post(
    '/api/connections',
    wrap(async (req, res) => {
      const row = saveConnection(req.body || {});
      res.json(row);
    }),
  );

  app.put(
    '/api/connections/:id',
    wrap(async (req, res) => {
      const before = getConnection(req.params.id);
      const row = saveConnection({ ...req.body, id: req.params.id });
      if (req.body?.uri && before) {
        await closeAdapter(req.params.id, before.engine);
        clearSchemaCache(req.params.id);
      }
      res.json(row);
    }),
  );

  app.delete(
    '/api/connections/:id',
    wrap(async (req, res) => {
      const before = getConnection(req.params.id);
      await closeClient(req.params.id);
      if (before) await closeAdapter(req.params.id, before.engine);
      deleteConnection(req.params.id);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/connections/test',
    wrap(async (req, res) => {
      let uri = req.body?.uri;
      let engine = req.body?.engine;
      if (!uri && req.body?.id) {
        const saved = getConnection(req.body.id, { includeUri: true });
        uri = saved?.uri;
        engine = engine || saved?.engine;
      }
      if (!uri) throw new Error('Connection string is required');
      res.json(await testConnectionUri(uri, engine));
    }),
  );

  app.get(
    '/api/connections/:id/databases',
    wrap(async (req, res) => {
      const { conn, adapter } = resolveConnection(req.params.id);
      res.json(await adapter.listDatabases(conn));
    }),
  );

  app.get(
    '/api/connections/:id/databases/:db/collections',
    wrap(async (req, res) => {
      res.json(await listCollections(req.params.id, req.params.db));
    }),
  );

  app.get(
    '/api/connections/:id/databases/:db/collections/:col/documents',
    wrap(async (req, res) => {
      let filter = {};
      if (req.query.filter) {
        try {
          filter = JSON.parse(String(req.query.filter));
        } catch {
          throw new Error('Filter must be JSON');
        }
      }
      res.json(
        await findDocuments(req.params.id, req.params.db, req.params.col, {
          skip: Number(req.query.skip || 0),
          limit: Number(req.query.limit || 50),
          filter,
        }),
      );
    }),
  );

  app.get(
    '/api/connections/:id/databases/:db/collections/:col/stats',
    wrap(async (req, res) => {
      res.json(await collectionStats(req.params.id, req.params.db, req.params.col));
    }),
  );

  app.get(
    '/api/connections/:id/databases/:db/collections/:col/indexes',
    wrap(async (req, res) => {
      res.json(await listIndexes(req.params.id, req.params.db, req.params.col));
    }),
  );

  app.get(
    '/api/connections/:id/databases/:db/collections/:col/users',
    wrap(async (req, res) => {
      res.json(
        await sampleUsers(req.params.id, req.params.db, req.params.col, {
          skip: Number(req.query.skip || 0),
          limit: Number(req.query.limit || 200),
          search: String(req.query.search || ''),
        }),
      );
    }),
  );

  // ---- Engine-agnostic explorer (Mongo + SQL). Everything here is read-only. ----
  const dbBase = '/api/connections/:id/databases/:db';

  app.get(
    `${dbBase}/objects`,
    wrap(async (req, res) => {
      const { conn, adapter } = resolveConnection(req.params.id);
      res.json(await adapter.listObjects(conn, req.params.db));
    }),
  );

  app.get(
    `${dbBase}/objects/:name/describe`,
    wrap(async (req, res) => {
      const { conn, adapter } = resolveConnection(req.params.id);
      res.json(await adapter.describe(conn, req.params.db, req.params.name));
    }),
  );

  app.get(
    `${dbBase}/objects/:name/fetch`,
    wrap(async (req, res) => {
      const { conn, adapter } = resolveConnection(req.params.id);
      if (typeof adapter.fetchOne !== 'function') throw new Error('This engine does not support linked lookups');
      const field = String(req.query.field || '').trim();
      const value = req.query.value;
      if (!field) throw new Error('field is required');
      if (value == null || value === '') throw new Error('value is required');
      const targetObject = req.params.name;
      let parsed = value;
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          parsed = JSON.parse(value);
        } catch {
          parsed = value;
        }
      }
      res.json(await adapter.fetchOne(conn, req.params.db, targetObject, { field, value: parsed }));
    }),
  );

  app.get(
    `${dbBase}/objects/:name/rows`,
    wrap(async (req, res) => {
      const { conn, adapter } = resolveConnection(req.params.id);
      let filter;
      if (req.query.filter) {
        try {
          filter = JSON.parse(String(req.query.filter));
        } catch {
          throw new Error('Filter must be JSON');
        }
      }
      const sort = req.query.sort ? { column: String(req.query.sort), dir: req.query.dir === 'desc' ? 'desc' : 'asc' } : null;
      res.json(
        await adapter.rows(conn, req.params.db, req.params.name, {
          skip: Number(req.query.skip || 0),
          limit: Number(req.query.limit || 50),
          filter,
          sort,
        }),
      );
    }),
  );

  app.post(
    `${dbBase}/query`,
    wrap(async (req, res) => {
      const { conn, adapter } = resolveConnection(req.params.id);
      res.json(await adapter.query(conn, req.params.db, req.body?.text, { limit: req.body?.limit }));
    }),
  );

  app.get(
    `${dbBase}/graph`,
    wrap(async (req, res) => {
      const { conn, adapter } = resolveConnection(req.params.id);
      res.json(await adapter.graph(conn, req.params.db));
    }),
  );

  app.post(
    `${dbBase}/analyze`,
    wrap(async (req, res) => {
      res.json(await analyzeLive({ connectionId: req.params.id, database: req.params.db }));
    }),
  );

  app.get(
    '/api/connections/:id/permissions',
    wrap(async (req, res) => {
      const { conn, adapter } = resolveConnection(req.params.id);
      const db = req.query.db ? String(req.query.db) : undefined;
      if (typeof adapter.permissions !== 'function') throw new Error('This engine does not report privileges');
      res.json(await adapter.permissions(conn, db));
    }),
  );

  app.get(
    '/api/connections/:id/insight',
    wrap(async (req, res) => {
      res.json(await connectionInsight(req.params.id, req.query.db ? String(req.query.db) : undefined));
    }),
  );

  // ---- Assistant (optional, OpenRouter). Drafts only; never executes. ----
  app.get('/api/ai/status', (_req, res) => res.json(aiStatus()));

  app.post(
    '/api/ai/query',
    wrap(async (req, res) => {
      res.json(await draftQuery(req.body || {}));
    }),
  );

  app.post(
    '/api/ai/test',
    wrap(async (_req, res) => {
      res.json(await testAi());
    }),
  );

  app.post(
    '/api/ai/explain',
    wrap(async (req, res) => {
      res.json(await explainSchema(req.body || {}));
    }),
  );

  app.get('/api/jobs', (_req, res) => {
    res.json(
      listJobs().map((job) => ({
        ...job,
        intervalLabel: describeInterval(job.interval),
        nextRunLabel: formatNext(job.nextRunAt),
        running: getRunning(job.id),
      })),
    );
  });

  app.post(
    '/api/jobs',
    wrap(async (req, res) => {
      const body = req.body || {};
      const nextRunAt = computeNextRun(body.interval).toISOString();
      res.json(saveJob({ ...body, nextRunAt }));
    }),
  );

  app.put(
    '/api/jobs/:id',
    wrap(async (req, res) => {
      const body = { ...req.body, id: req.params.id };
      if (body.interval) body.nextRunAt = computeNextRun(body.interval).toISOString();
      res.json(saveJob(body));
    }),
  );

  app.delete('/api/jobs/:id', (req, res) => {
    deleteJob(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/jobs/:id/toggle', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(patchJob(job.id, { enabled: !job.enabled }));
  });

  app.post(
    '/api/jobs/:id/run',
    wrap(async (req, res) => {
      const record = await runBackup(req.params.id, { reason: 'manual' });
      const next = computeNextRun(getJob(req.params.id)?.interval, new Date());
      patchJob(req.params.id, {
        lastRunAt: new Date().toISOString(),
        nextRunAt: next.toISOString(),
      });
      res.json(record);
    }),
  );

  app.get('/api/jobs/:id/status', (req, res) => {
    res.json(getRunning(req.params.id) || { status: 'idle' });
  });

  app.get('/api/records', (_req, res) => {
    res.json(listRecords().map(withExists));
  });

  app.delete('/api/records/:id', (req, res) => {
    deleteRecord(req.params.id);
    res.json({ ok: true });
  });

  app.post(
    '/api/records/:id/open',
    wrap(async (req, res) => {
      res.json(revealRecord(req.params.id));
    }),
  );

  app.post(
    '/api/records/:id/decrypt-open',
    wrap(async (req, res) => {
      const dest = tempDecryptDir(req.params.id);
      const result = await decryptRecord(req.params.id, dest, req.body?.passphrase);
      res.json(revealPath(result.extractDir));
    }),
  );

  app.post(
    '/api/records/:id/verify',
    wrap(async (req, res) => {
      res.json(await verifyRecord(req.params.id, { passphrase: req.body?.passphrase }));
    }),
  );

  app.post(
    '/api/records/:id/restore/preview',
    wrap(async (req, res) => {
      res.json(await previewRestore({ ...(req.body || {}), recordId: req.params.id }));
    }),
  );

  app.post(
    '/api/records/:id/restore/execute',
    wrap(async (req, res) => {
      res.json(await executeRestore({ ...(req.body || {}), recordId: req.params.id }));
    }),
  );

  app.get('/api/audit/writes', (_req, res) => {
    const rotations = listRotationAudit().map((r) => ({ ...r, kind: r.kind || 'rotate' }));
    const rows = [...listWriteAudit(), ...rotations].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    res.json(rows.slice(0, 300));
  });

  app.post(
    '/api/records/import',
    wrap(async (req, res) => {
      res.json(importBackupFile(req.body || {}));
    }),
  );

  const assertMongoTarget = (body) => {
    const conn = getConnection(body?.connectionId);
    if (conn && conn.engine && conn.engine !== 'mongodb') {
      throw new Error('Password rotate works on MongoDB connections only');
    }
  };

  app.post(
    '/api/rotate/preview',
    wrap(async (req, res) => {
      assertMongoTarget(req.body);
      res.json(await previewRotation(req.body || {}));
    }),
  );

  app.post(
    '/api/rotate/execute',
    wrap(async (req, res) => {
      assertMongoTarget(req.body);
      res.json(await executeRotation(req.body || {}));
    }),
  );

  app.get('/api/rotate/audit', (req, res) => {
    res.json(filterRotationAudit(listRotationAudit(), req.query || {}));
  });

  app.get('/api/rotate/audit.txt', (req, res) => {
    const rows = filterRotationAudit(listRotationAudit(), req.query || {});
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rotation-audit-${stamp}.txt"`);
    res.send(formatRotationAudit(rows));
  });

  app.post(
    '/api/dialogs/folder',
    wrap(async (_req, res) => {
      const selected = await pickFolder();
      res.json({ path: selected });
    }),
  );

  app.post(
    '/api/dialogs/file',
    wrap(async (_req, res) => {
      const selected = await pickFile();
      res.json({ path: selected });
    }),
  );

  app.get('/api/settings', (_req, res) => res.json(publicSettings()));

  app.put('/api/settings', (req, res) => {
    res.json(saveSettings(req.body || {}));
  });

  app.get('/api/autostart', (_req, res) => res.json(autostartStatus()));

  app.post('/api/autostart/enable', (_req, res) => {
    try {
      res.json(enableAutostart());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/autostart/disable', (_req, res) => {
    res.json(disableAutostart());
  });

  app.post(
    '/api/email/test',
    wrap(async (req, res) => {
      const to = req.body?.to;
      if (!to) throw new Error('Destination email is required');
      const result = await sendHtmlEmail({
        to,
        subject: 'Backup service test email',
        html: '<p>SES is configured. You will receive backup notifications from this address.</p>',
      });
      res.json(result);
    }),
  );

  // ---- Import Seeds (explicit write path, like Restore). ----
  app.get('/api/seeds', (_req, res) => res.json(listSeeds().map(publicSeed)));
  app.get('/api/seeds/skills', (_req, res) => res.json(listSkills()));
  app.get('/api/seeds/example', (_req, res) => res.json(exampleSeed()));
  app.post(
    '/api/seeds/validate',
    wrap(async (req, res) => {
      res.json(validateSeed(req.body?.payload ?? req.body));
    }),
  );
  app.get(
    '/api/seeds/:id',
    wrap(async (req, res) => {
      const row = getSeed(req.params.id);
      if (!row) throw new Error('Seed not found');
      res.json(fullSeed(row));
    }),
  );
  app.post(
    '/api/seeds',
    wrap(async (req, res) => {
      const row = saveSeed(req.body || {});
      res.json(fullSeed(row));
    }),
  );
  app.put(
    '/api/seeds/:id',
    wrap(async (req, res) => {
      const existing = getSeed(req.params.id);
      if (!existing) throw new Error('Seed not found');
      const row = saveSeed({ ...req.body, id: req.params.id });
      res.json(fullSeed(row));
    }),
  );
  app.delete('/api/seeds/:id', (req, res) => {
    deleteSeed(req.params.id);
    res.json({ ok: true });
  });
  app.post(
    '/api/seeds/simulate',
    wrap(async (req, res) => {
      const body = req.body || {};
      let payload = body.payload;
      if (!payload && body.seedId) {
        const row = getSeed(body.seedId);
        if (!row) throw new Error('Seed not found');
        payload = row.payload;
      }
      const result = await simulateSeed({
        payload,
        connectionId: body.connectionId,
        database: body.database,
        wipe: Boolean(body.wipe),
        createMissing: body.createMissing !== false,
      });
      if (body.seedId) patchSeed(body.seedId, { lastSimulatedAt: new Date().toISOString() });
      res.json(result);
    }),
  );
  app.post(
    '/api/seeds/apply',
    wrap(async (req, res) => {
      const body = req.body || {};
      let payload = body.payload;
      if (!payload && body.seedId) {
        const row = getSeed(body.seedId);
        if (!row) throw new Error('Seed not found');
        payload = row.payload;
      }
      const result = await applySeed({
        payload,
        connectionId: body.connectionId,
        database: body.database,
        wipe: Boolean(body.wipe),
        createMissing: body.createMissing !== false,
        confirm: body.confirm,
      });
      if (body.seedId) patchSeed(body.seedId, { lastAppliedAt: new Date().toISOString() });
      res.json(result);
    }),
  );

  // ---- AI exploration dashboards (read-only queries). ----
  app.get('/api/dashboards', (_req, res) => res.json(listDashboards()));
  app.get(
    '/api/dashboards/:id',
    wrap(async (req, res) => {
      const row = getDashboard(req.params.id);
      if (!row) throw new Error('Dashboard not found');
      res.json(row);
    }),
  );
  app.post(
    '/api/dashboards/preview',
    wrap(async (req, res) => {
      const body = req.body || {};
      res.json(await previewQuery(body));
    }),
  );
  app.post(
    '/api/dashboards',
    wrap(async (req, res) => {
      const body = req.body || {};
      if (!body.connectionId || !body.database) throw new Error('Pick a connection and database');
      res.json(
        await createDashboard({
          connectionId: body.connectionId,
          database: body.database,
          prompt: body.prompt,
          query: body.query,
          type: body.type,
          title: body.title,
        }),
      );
    }),
  );
  app.post(
    '/api/dashboards/:id/run',
    wrap(async (req, res) => {
      res.json(await runDashboard(req.params.id));
    }),
  );
  app.post(
    '/api/dashboards/:id/revise',
    wrap(async (req, res) => {
      res.json(await reviseDashboard({ id: req.params.id, instruction: req.body?.instruction }));
    }),
  );
  app.post(
    '/api/dashboards/:id/widgets',
    wrap(async (req, res) => {
      const body = req.body || {};
      res.json(await addDashboardWidget({ id: req.params.id, prompt: body.prompt, query: body.query, type: body.type, title: body.title }));
    }),
  );
  app.post(
    '/api/dashboards/:id/repair',
    wrap(async (req, res) => {
      res.json(await repairDashboard(req.params.id));
    }),
  );
  app.put(
    '/api/dashboards/:id',
    wrap(async (req, res) => {
      const existing = getDashboard(req.params.id);
      if (!existing) throw new Error('Dashboard not found');
      res.json(saveDashboard({ ...existing, ...req.body, id: req.params.id }));
    }),
  );
  app.delete('/api/dashboards/:id', (req, res) => {
    deleteDashboard(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/schemas', (_req, res) => res.json(listSchemaDrafts().map(publicDraft)));

  app.post(
    '/api/schemas',
    wrap(async (req, res) => {
      const body = req.body || {};
      const schema = body.schema || emptySchema({ name: body.name, engine: body.engine, description: body.description });
      res.json(saveSchemaDraft({ ...body, schema }));
    }),
  );

  app.get('/api/schemas/:id', (req, res) => {
    const row = getSchemaDraft(req.params.id);
    if (!row) return res.status(404).json({ error: 'Schema draft not found' });
    res.json(row);
  });

  app.put(
    '/api/schemas/:id',
    wrap(async (req, res) => {
      const existing = getSchemaDraft(req.params.id);
      if (!existing) throw new Error('Schema draft not found');
      res.json(saveSchemaDraft({ ...existing, ...req.body, id: req.params.id, schema: req.body?.schema || existing.schema }));
    }),
  );

  app.post(
    '/api/schemas/:id/talk',
    wrap(async (req, res) => {
      const existing = getSchemaDraft(req.params.id);
      if (!existing) throw new Error('Schema draft not found');
      const { schema, model } = await draftSchema({
        prompt: req.body?.prompt,
        engine: req.body?.engine || existing.engine,
        current: existing.schema,
      });
      const saved = saveSchemaDraft({ id: req.params.id, schema, name: schema.name, engine: schema.engine, description: schema.description });
      res.json({ ...saved, model });
    }),
  );

  app.post(
    '/api/schemas/:id/analyze',
    wrap(async (req, res) => {
      const existing = getSchemaDraft(req.params.id);
      if (!existing) throw new Error('Schema draft not found');
      const result = await analyzeDraft(existing.schema);
      const saved = saveSchemaDraft({ id: req.params.id, schema: result.schema, name: result.schema.name, engine: result.schema.engine });
      res.json({ ...saved, findings: result.findings, summary: result.summary, model: result.model, ai: result.ai, error: result.error });
    }),
  );

  app.delete('/api/schemas/:id', (req, res) => {
    deleteSchemaDraft(req.params.id);
    res.json({ ok: true });
  });

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    const indexFile = path.join(uiDist, 'index.html');
    if (!fs.existsSync(indexFile)) {
      res
        .status(503)
        .type('html')
        .send(
          '<p>The dashboard is not built. Run <code>npm start</code> or <code>pnpm start</code> (builds the React UI), or <code>npm run dev</code> for hot reload on port 5173.</p>',
        );
      return;
    }
    res.sendFile(indexFile);
  });

  return app;
}

export function startServer() {
  const app = createApp();
  const port = Number(process.env.APP_PORT || 4780);
  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}
