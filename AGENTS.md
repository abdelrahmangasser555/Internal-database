# AGENTS.md

Guidance for AI coding agents working in **backup-service** (local backup scheduler, explorer and restore tool for MongoDB, PostgreSQL, MySQL/MariaDB, SQLite and SQL Server; MongoDB password rotation; import seeds; AI exploration dashboards).

## Project summary

| Item | Detail |
|------|--------|
| Runtime | Node.js **≥ 20**, ES modules (`"type": "module"`). SQLite needs **≥ 22.13** (`node:sqlite`) |
| Server | Express 5, localhost dashboard on `APP_PORT` (default **4780**) |
| Data | JSON files under `data/` (gitignored); device-local only |
| Platforms | Windows and Ubuntu (autostart / service scripts) |
| Brand | Flat greys, no background gradients. Themes are full kits (type, radius, stroke, shadow, buttons), not colour-only: Graphite (Segoe UI, 2px, dashed), Ink (IBM Plex, sharp), Slate (Inter, 8px, lifted), Paper (Source Serif + Source Sans), Sand (Figtree, pill). Tokens live in `web/src/index.css`; picker in the header and Settings. |

User-facing docs: `README.md`.

## Commands

```bash
npm start            # pull (if clean git), install, build React UI, serve on 4780
npm run dev          # same bootstrap, then API (4780) + Vite (5173) with HMR
pnpm start / pnpm dev
npm run build:ui     # production dashboard into web/dist (Vite; cross-platform)
npm test             # node:test suites in test/
npm run worker       # headless scheduler only (src/worker.js)
npm run install:service
npm run uninstall:service
```

`scripts/launch.js` is the Windows/Linux entry for `start` and `dev`. It fast-forwards the tracked git remote when the working tree is clean, runs `npm`/`pnpm` install, and starts the app. Set `BACKUP_SKIP_PULL=1` to skip git. Windows: `start.bat`. Ubuntu: `start.sh`.

Do not commit `node_modules/`, `data/`, or `.env`.

## Layout

```
src/
  index.js          # entry: env, dirs, lock, scheduler, server, autostart, open browser
  worker.js         # scheduler only; exits if lock held
  server.js         # Express app + /api/* routes; static UI from web/dist only (SPA)
  core/
    store.js        # JSON persistence (connections, jobs, records, settings, audits, seeds, dashboards)
    engines.js      # engine registry, URI detection, URI masking
    adapters/       # one module per engine behind a shared interface
      index.js      #   adapterFor(), resolveConnection(), health checks
      sqlsafe.js    #   read-only SQL guard, value encoding, FK ordering
      seedwrite.js  #   shared SQL types / CREATE TABLE helpers for seeds
      postgres.js, mysql.js (MySQL + MariaDB), sqlite.js, mssql.js, mongo.js
    backup.js       # read-only dumps via adapters, zip, checksums, encryption, retention
    archive.js      # open/decrypt backup archives, SHA-256 helpers
    verify.js       # integrity checks for a backup record
    restore.js      # preview + execute restore (explicit write path)
    seed-format.js  # backup-service-seed-v1 parse / validate / graph integrity
    seed-skills.js  # copyable export prompts (universal + per engine)
    seeds.js        # simulate + apply seeds onto a connection
    dashboards.js   # persist + run AI exploration dashboards (read-only queries)
    ai.js           # optional OpenRouter assistant (drafts queries/dashboards; never executes)
    mongo.js        # Mongo client cache, browse helpers (used by the Mongo adapter and Rotate)
    schedule.js     # node-cron, next-run computation
    rotate.js       # password rotation (hashes on the database; plaintext stays in the local audit)
    crypto.js       # master key, URI encryption, backup passphrase AES-256-GCM
    email.js        # AWS SES HTML mail
    paths.js        # ROOT, DATA_DIR, file paths, ensureDataDirs()
    env.js          # dotenv load
    lock.js         # single scheduler via data/scheduler.lock
    autostart.js    # OS login autostart
    hash.js         # bcrypt config (aligned with Bahri-MOC-PCR)
    explorer.js, dialogs.js, log.js, pattern.js
web/
  src/              # React dashboard (Vite + Tailwind + React Flow + Recharts)
  dist/             # production build (gitignored)
test/               # node:test (seed format, sqlite seed apply, skills)
scripts/
  launch.js, workspace.js, build-ui.js, ensure-ui.js, install-service.js, uninstall-service.js, run-worker.cmd (gitignored when generated)
```

## Architecture notes

1. **Two processes, one lock** — `index.js` and `worker.js` both call `acquireLock()`. Only one runs `startScheduler()`. A second `index.js` instance can still serve the dashboard without owning the scheduler.
2. **API surface** — New HTTP features belong in `server.js` using the existing `wrap()` helper (async errors → `400` + `{ error }`). JSON body limit is **8mb** (seeds).
3. **Persistence** — `store.js` uses atomic writes (`*.tmp` + rename, mode `0o600`). Connection URIs are stored encrypted (`uriEnc`); API returns masked/public shapes unless `includeUri` is used internally.
4. **Backups** — Must stay **read-only** toward every source database (no writes to customer DBs). Dumps go through `adapter.dump()` using read-only snapshots. Optional job passphrases produce `.zip.enc`; decryption lives in `archive.js` / `backup.js`. Archive format `backup-service-v2` adds `checksums.json` and `tables/` folders; the v1 Mongo layout (`collections/`) must keep opening, verifying and restoring.
4a. **Explorer queries** — Anything user- or AI-typed goes through `assertReadOnlySql()` (SQL) or `parseMongoQuery()` (Mongo) **and** runs inside a read-only transaction/handle. Never weaken either layer.
4b. **Restore** — Explicit write path. It only writes into empty or new tables/collections, needs the typed target name, and logs to `data/write-audit.json`.
4c. **Import seeds** — Third explicit write path (`src/core/seeds.js`). Format `backup-service-seed-v1` (`src/core/seed-format.js`). Simulate is read-only (schema, privileges, ref graph, live key lookup). Apply can CREATE missing objects, optionally DELETE rows in listed objects (`wipe`), then INSERT in parent-first order. Confirm by typing the target database name. Audits as `kind: 'seed'`. Copyable export skills live in `src/core/seed-skills.js` (`GET /api/seeds/skills`).
4d. **Analytics dashboards** — Read-only. User describes a view; `draftDashboard()` in `ai.js` returns widgets (kpi / bar / line / pie / table / pipeline). `dashboards.js` stores them in `data/dashboards.json` and re-runs queries through the same read-only adapters. Never execute writes from a dashboard.
5. **Rotation** — `rotate.js` writes password **hashes** to MongoDB. The generated password and the previous generated password are stored in `data/rotation-audit.json` on this device (gitignored) so the audit page can search, filter by date, copy the latest password, and download a `.txt`. Default notify email is off unless settings enable it.
6. **UI** — React dashboard in `web/src/` (Vite, Tailwind, Lucide, Framer Motion, `@xyflow/react`, Recharts). Information architecture is **connection-first**: `/` lists connections; `/c/:connectionId/*` is the workspace (overview, explore, backups, analytics, seeds, flow, rotate). Old `/browse`, `/backups`, `/rotate`, `/analytics`, `/seeds`, `/flow` URLs redirect. Theme tokens (`web/src/index.css`) drive type, radius, stroke, shadow and buttons per brand — use `border-theme`, `shadow-card`, `rounded-md`, `btn`. After API changes, update `web/src/api.js` and the relevant page/sheet. `npm run build:ui` writes `web/dist`; Express serves that as an SPA. `npm run dev` proxies `/api` from Vite `:5173` to Express `:4780`. Info (`i`) tips are `InfoTip` / `Field info=` in `web/src/components/ui.jsx`. The flow map (`web/src/pages/FlowMap.jsx`) draws backup jobs plus pinned analytics dashboards and seeds. A seed `bindings[]` entry is `{ connectionId, database }`; clicking that node opens the seed on that target. Folder and file pickers live in `src/core/dialogs.js` (`POST /api/dialogs/folder`, `POST /api/dialogs/file`).
7. **Connection privileges** — `adapter.permissions(conn, db)` on every engine. `GET /api/connections/:id/permissions`. Shown on the connection sheet (and simulation reports). Best-effort: missing GRANT visibility is a note, not a hard failure.
8. **Connection insight** — `adapter.insight(conn, db)` plus `GET /api/connections/:id/insight`. Read-only cluster/database metadata for the connection home (version, topology, connections, collections). Samples of connection counts are stored in `data/insight-samples.json` (gitignored) so “opened in the last period” can be estimated.

## Seed format (`backup-service-seed-v1`)

Portable fixture JSON. Each table/collection is an `objects[]` entry with `pk`, `columns`, `records`, `refs` (how rows connect) and `rules` (`required`, `unique`, `allowOrphan`).

- `refs[].required` + `onMissing: "error"` → child **cannot** exist without the parent (example: observation without user).
- `onMissing: "null"` → optional link stored as null.
- `onMissing: "skip"` → drop the child row.
- `engine`: `mongodb` | `postgres` | `mysql` | `mariadb` | `sqlite` | `mssql` | `any`.
- Insert order is derived from refs (parents first).
- Skills: copy from the Seeds page (universal “tall” prompt + one prompt per engine) into another project; the model must emit this JSON.

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

SES sandbox only sends to verified recipients. Analytics dashboards need the assistant key.

## Coding conventions

- Use **native `node:` imports** (`node:fs`, `node:path`, etc.) like existing files.
- Prefer small, focused changes in `core/` modules; avoid growing `server.js` without extracting helpers when logic is reusable.
- Match error style: throw `Error` with clear messages; HTTP layer maps via `wrap()`.
- Tests: `npm test` (`node:test` in `test/`). Still verify UI with `npm run dev` against `127.0.0.1`.
- Filename on Windows: `start.bat` runs `node scripts\launch.js start`; Unix `start.sh` does the same.

## Safety rules for agents

1. **Do not** commit `.env`, `data/`, backups, or `data/master.key`.
2. **Do not** add write operations to target databases during backup/browse/query/assistant/analytics flows unless the user explicitly requests a new feature and it is clearly scoped. **Rotate, Restore and Seeds** are the intentional write paths. The assistant must never execute anything itself.
3. **Do not** expose connection URIs in logs or API responses without masking.
4. **Do not** bind the dashboard to `0.0.0.0` unless the user asks; product intent is local-only.
5. When changing encryption or file formats, consider backward compatibility for existing `.zip.enc` and `data/*.json`. Seed format changes must keep opening `backup-service-seed-v1`.

## Common tasks

| Task | Where to work |
|------|----------------|
| New REST endpoint | `server.js` + `web/src/api.js` + the matching page/sheet |
| Backup behavior / formats | `core/backup.js`, `core/crypto.js` |
| Cron / scheduling | `core/schedule.js`, job fields in `store.js` |
| New database engine | `core/engines.js`, a new `core/adapters/<engine>.js`, register it in `adapters/index.js`, add a logo + entry in `web/src/lib/engines.js`, add a seed skill in `seed-skills.js` |
| Explorer | `core/adapters/*`, `web/src/pages/Browse.jsx`, `web/src/components/explore/` |
| Verify / restore | `core/verify.js`, `core/restore.js`, `web/src/components/RecordSheet.jsx`, `RestoreSheet.jsx` |
| Import seeds | `core/seed-format.js`, `core/seeds.js`, `core/seed-skills.js`, adapter `seed*` / `permissions`, `web/src/pages/Seeds.jsx` |
| Analytics dashboards | `core/ai.js` (`draftDashboard`), `core/dashboards.js`, `web/src/pages/Analytics.jsx` |
| Assistant | `core/ai.js`, `web/src/components/AssistantSheet.jsx` |
| Connection privileges | `adapter.permissions()`, `GET /api/connections/:id/permissions`, `ConnectionSheet.jsx` |
| Connection home analytics | `adapter.insight()`, `core/insight.js`, `GET /api/connections/:id/insight`, `ConnectionHome.jsx` |
| Email templates | `core/email.js` |
| Settings / defaults | `store.js` (`settings.json`), `/api/meta` in `server.js` |
| Boot at login | `core/autostart.js`, `scripts/install-service.js` |
| Dashboard UX / flow canvas | `web/src/` (`pages/`, `components/`, `components/flow/`). Design tokens live in `web/src/index.css` (dark default + light); use the token classes (`bg-surface`, `text-muted`, `border-line`, `text-primary`…) rather than raw colours. Logos come from svgl.app into `web/public/brands/` |

## Optional Cursor rules

For file-specific agent rules, add `.cursor/rules/*.mdc` (see Cursor “create rule” skill). This `AGENTS.md` is the project-wide overview; keep it updated when architecture or entrypoints change.
