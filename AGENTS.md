# AGENTS.md

Guidance for AI coding agents working in **backup-service** (local backup scheduler, explorer and restore tool for MongoDB, PostgreSQL, MySQL/MariaDB, SQLite and SQL Server; MongoDB password rotation).

## Project summary

| Item | Detail |
|------|--------|
| Runtime | Node.js **≥ 20**, ES modules (`"type": "module"`). SQLite needs **≥ 22.13** (`node:sqlite`) |
| Server | Express 5, localhost dashboard on `APP_PORT` (default **4780**) |
| Data | JSON files under `data/` (gitignored); device-local only |
| Platforms | Windows and Ubuntu (autostart / service scripts) |

User-facing docs: `README.md`.

## Commands

```bash
npm install          # dependencies
npm start            # builds UI if needed, then dashboard + scheduler
npm run dev          # Express API (4780) + Vite UI (5173) with HMR
npm run build:ui     # production dashboard into web/dist (Vite; cross-platform)
npm run worker       # headless scheduler only (src/worker.js)
npm run install:service
npm run uninstall:service
```

Windows: `start.bat` runs `node src\index.js`.

Do not commit `node_modules/`, `data/`, or `.env`.

## Layout

```
src/
  index.js          # entry: env, dirs, lock, scheduler, server, autostart, open browser
  worker.js         # scheduler only; exits if lock held
  server.js         # Express app + /api/* routes; static UI from web/dist (SPA)
  core/
    store.js        # JSON persistence (connections, jobs, records, settings, audits)
    engines.js      # engine registry, URI detection, URI masking
    adapters/       # one module per engine behind a shared interface
      index.js      #   adapterFor(), resolveConnection(), health checks
      sqlsafe.js    #   read-only SQL guard, value encoding, FK ordering
      postgres.js, mysql.js (MySQL + MariaDB), sqlite.js, mssql.js, mongo.js
    backup.js       # read-only dumps via adapters, zip, checksums, encryption, retention
    archive.js      # open/decrypt backup archives, SHA-256 helpers
    verify.js       # integrity checks for a backup record
    restore.js      # preview + execute restore (explicit write path)
    ai.js           # optional OpenRouter assistant (drafts read-only queries; never executes)
    mongo.js        # Mongo client cache, browse helpers (used by the Mongo adapter and Rotate)
    schedule.js     # node-cron, next-run computation
    rotate.js       # password rotation (writes hashes only)
    crypto.js       # master key, URI encryption, backup passphrase AES-256-GCM
    email.js        # AWS SES HTML mail
    paths.js        # ROOT, DATA_DIR, file paths, ensureDataDirs()
    env.js          # dotenv load
    lock.js         # single scheduler via data/scheduler.lock
    autostart.js    # OS login autostart
    hash.js         # bcrypt config (aligned with Bahri-MOC-PCR)
    explorer.js, dialogs.js, log.js, pattern.js
  ui/               # legacy vanilla fallback if web/dist is missing
web/
  src/              # React dashboard (Vite + Tailwind + React Flow)
  dist/             # production build (gitignored)
scripts/
  install-service.js, uninstall-service.js, ensure-ui.js, run-worker.cmd (gitignored when generated)
```

## Architecture notes

1. **Two processes, one lock** — `index.js` and `worker.js` both call `acquireLock()`. Only one runs `startScheduler()`. A second `index.js` instance can still serve the dashboard without owning the scheduler.
2. **API surface** — New HTTP features belong in `server.js` using the existing `wrap()` helper (async errors → `400` + `{ error }`). Keep JSON body limit in mind (`2mb`).
3. **Persistence** — `store.js` uses atomic writes (`*.tmp` + rename, mode `0o600`). Connection URIs are stored encrypted (`uriEnc`); API returns masked/public shapes unless `includeUri` is used internally.
4. **Backups** — Must stay **read-only** toward every source database (no writes to customer DBs). Dumps go through `adapter.dump()` using read-only snapshots. Optional job passphrases produce `.zip.enc`; decryption lives in `archive.js` / `backup.js`. Archive format `backup-service-v2` adds `checksums.json` and `tables/` folders; the v1 Mongo layout (`collections/`) must keep opening, verifying and restoring.
4a. **Explorer queries** — Anything user- or AI-typed goes through `assertReadOnlySql()` (SQL) or `parseMongoQuery()` (Mongo) **and** runs inside a read-only transaction/handle. Never weaken either layer.
4b. **Restore** — The second explicit write path (with Rotate). It only writes into empty or new tables/collections, needs the typed target name, and logs to `data/write-audit.json`.
5. **Rotation** — `rotate.js` updates password **hashes** only; default notify email is off unless settings enable it.
6. **UI** — React dashboard in `web/src/` (Vite, Tailwind, Lucide, Framer Motion, `@xyflow/react`). After API changes, update `web/src/api.js` and the relevant page/sheet. `npm run build:ui` writes `web/dist`; Express serves that as an SPA. `npm run dev` proxies `/api` from Vite `:5173` to Express `:4780`.

## Environment

Copy `.env.example` → `.env`. Never hardcode or commit secrets.

| Variable | Role |
|----------|------|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | SES (`ses:SendEmail`) |
| `SES_FROM_EMAIL` | Verified SES identity |
| `APP_PORT` | Dashboard port (binds localhost) |
| `BACKUP_MASTER_KEY` | Optional; else `data/master.key` is created |
| `OPENROUTER_API_KEY` | Optional assistant key (or saved encrypted from Settings as `aiKeyEnc`; never returned by the API) |
| `OPENROUTER_MODEL` | Optional; default `deepseek/deepseek-v4.1-flash` |

SES sandbox only sends to verified recipients.

## Coding conventions

- Use **native `node:` imports** (`node:fs`, `node:path`, etc.) like existing files.
- Prefer small, focused changes in `core/` modules; avoid growing `server.js` without extracting helpers when logic is reusable.
- Match error style: throw `Error` with clear messages; HTTP layer maps via `wrap()`.
- No TypeScript, no test runner in repo — verify manually: `npm run dev` (Vite + API) or `npm start`, hit the dashboard, exercise affected API from UI or curl against `127.0.0.1`.
- Filename on Windows: entry is `src/index.js` (Unix path in docs); `start.bat` uses `src\index.js` for Windows.

## Safety rules for agents

1. **Do not** commit `.env`, `data/`, backups, or `data/master.key`.
2. **Do not** add write operations to target databases during backup/browse/query/assistant flows unless the user explicitly requests a new feature and it is clearly scoped (Rotate and Restore are the intentional write paths). The assistant must never execute anything itself.
3. **Do not** expose connection URIs in logs or API responses without masking.
4. **Do not** bind the dashboard to `0.0.0.0` unless the user asks; product intent is local-only.
5. When changing encryption or file formats, consider backward compatibility for existing `.zip.enc` and `data/*.json`.

## Common tasks

| Task | Where to work |
|------|----------------|
| New REST endpoint | `server.js` + `web/src/api.js` + the matching page/sheet |
| Backup behavior / formats | `core/backup.js`, `core/crypto.js` |
| Cron / scheduling | `core/schedule.js`, job fields in `store.js` |
| New database engine | `core/engines.js`, a new `core/adapters/<engine>.js`, register it in `adapters/index.js`, add a logo + entry in `web/src/lib/engines.js` |
| Explorer | `core/adapters/*`, `web/src/pages/Browse.jsx`, `web/src/components/explore/` |
| Verify / restore | `core/verify.js`, `core/restore.js`, `web/src/components/RecordSheet.jsx`, `RestoreSheet.jsx` |
| Assistant | `core/ai.js`, `web/src/components/AssistantSheet.jsx` |
| Email templates | `core/email.js` |
| Settings / defaults | `store.js` (`settings.json`), `/api/meta` in `server.js` |
| Boot at login | `core/autostart.js`, `scripts/install-service.js` |
| Dashboard UX / flow canvas | `web/src/` (`pages/`, `components/`, `components/flow/`). Design tokens live in `web/src/index.css` (dark default + light); use the token classes (`bg-surface`, `text-muted`, `border-line`, `text-primary`…) rather than raw colours. Logos come from svgl.app into `web/public/brands/` |

## Optional Cursor rules

For file-specific agent rules, add `.cursor/rules/*.mdc` (see Cursor “create rule” skill). This `AGENTS.md` is the project-wide overview; keep it updated when architecture or entrypoints change.