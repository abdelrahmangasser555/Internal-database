import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { listConnections, saveConnection, deleteConnection, getConnection, listJobs, saveJob, deleteJob, patchJob, getJob, listRecords, getRecord, deleteRecord, getSettings, saveSettings, listRotationAudit } from './core/store.js';
import { testUri, listDatabases, listCollections, findDocuments, collectionStats, listIndexes, sampleUsers, closeClient } from './core/mongo.js';
import { runBackup, getRunning, recordExists, decryptRecord, importBackupFile, tempDecryptDir } from './core/backup.js';
import { computeNextRun, describeInterval, formatNext } from './core/schedule.js';
import { pickFolder } from './core/dialogs.js';
import { revealPath, revealRecord } from './core/explorer.js';
import { autostartStatus, enableAutostart, disableAutostart } from './core/autostart.js';
import { previewRotation, executeRotation } from './core/rotate.js';
import { sendHtmlEmail, fromAddress } from './core/email.js';
import { deviceName, ROOT } from './core/paths.js';
import { getHashConfig } from './core/hash.js';

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
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
  app.use(express.json({ limit: '2mb' }));
  const resolveUiRoot = () => (fs.existsSync(path.join(uiDist, 'index.html')) ? uiDist : uiDir);
  app.use((req, res, next) => express.static(resolveUiRoot())(req, res, next));

  app.get('/api/meta', (_req, res) => {
    res.json({
      device: deviceName(),
      platform: process.platform,
      fromEmail: fromAddress(),
      autostart: autostartStatus(),
      hash: getHashConfig(getSettings()),
    });
  });

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
      const row = saveConnection({ ...req.body, id: req.params.id });
      res.json(row);
    }),
  );

  app.delete(
    '/api/connections/:id',
    wrap(async (req, res) => {
      await closeClient(req.params.id);
      deleteConnection(req.params.id);
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/connections/test',
    wrap(async (req, res) => {
      let uri = req.body?.uri;
      if (!uri && req.body?.id) {
        uri = getConnection(req.body.id, { includeUri: true })?.uri;
      }
      if (!uri) throw new Error('Connection string is required');
      res.json(await testUri(uri));
    }),
  );

  app.get(
    '/api/connections/:id/databases',
    wrap(async (req, res) => {
      res.json(await listDatabases(req.params.id));
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
          limit: Number(req.query.limit || 100),
          search: String(req.query.search || ''),
        }),
      );
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
      const result = await decryptRecord(req.params.id, dest);
      res.json(revealPath(result.extractDir));
    }),
  );

  app.post(
    '/api/records/import',
    wrap(async (req, res) => {
      res.json(importBackupFile(req.body || {}));
    }),
  );

  app.post(
    '/api/rotate/preview',
    wrap(async (req, res) => {
      res.json(await previewRotation(req.body || {}));
    }),
  );

  app.post(
    '/api/rotate/execute',
    wrap(async (req, res) => {
      res.json(await executeRotation(req.body || {}));
    }),
  );

  app.get('/api/rotate/audit', (_req, res) => res.json(listRotationAudit()));

  app.post(
    '/api/dialogs/folder',
    wrap(async (_req, res) => {
      const selected = await pickFolder();
      res.json({ path: selected });
    }),
  );

  app.get('/api/settings', (_req, res) => res.json(getSettings()));

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

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    const indexFile = path.join(resolveUiRoot(), 'index.html');
    if (!fs.existsSync(indexFile)) {
      res
        .status(503)
        .type('html')
        .send(
          '<p>UI is not built. Run <code>npm run build:ui</code> or <code>npm run dev</code>.</p>',
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
