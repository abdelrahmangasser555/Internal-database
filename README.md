# Backup Service

Local database backup scheduler, explorer and restore tool for **MongoDB, PostgreSQL, MySQL, MariaDB, SQLite and SQL Server**, plus MongoDB password rotation. Runs on Windows and Ubuntu. Device data stays on the machine.

## Run

```bash
npm start
```

or `pnpm start`. That command (and `npm run dev` / `pnpm dev`) is enough on a new machine: it pulls the latest commit from the git remote this branch tracks (when the working tree is clean), installs dependencies with whichever of npm/pnpm/yarn you used, builds the React dashboard, and starts it. Windows and Ubuntu use the same scripts (`start.bat` / `start.sh` call the same launcher).

Dashboard: `http://127.0.0.1:4780`

Set `BACKUP_SKIP_PULL=1` if you do not want a git pull (local edits are never overwritten — pull is skipped automatically when the tree is dirty).

During UI development (hot reload):

```bash
npm run dev
```

Vite serves the dashboard at `http://127.0.0.1:5173` and proxies `/api` to the Express app on `4780`. Only the React app in `web/` is served.

Headless worker only (for boot):

```bash
npm run worker
npm run install:service
```

### Node version

Node **20+** runs everything except SQLite. SQLite connections use the built-in `node:sqlite` module, which needs **Node 22.13 or newer** (Node 24 LTS recommended). On older Node the SQLite card shows a clear error and every other engine keeps working.

## Supported databases

| Engine | Connection string | Explore | Backup | Restore |
|---|---|---|---|---|
| MongoDB | `mongodb://` / `mongodb+srv://` | collections, documents, inferred schema, aggregate | yes | yes |
| PostgreSQL | `postgres://user:pass@host:5432/db` | schemas, tables, views, FKs, indexes, SQL | yes | yes |
| MySQL | `mysql://user:pass@host:3306/db` | tables, views, FKs, indexes, SQL | yes | yes |
| MariaDB | `mariadb://…` (or `mysql://`, detected automatically) | same as MySQL | yes | yes |
| SQLite | `sqlite:///C:/data/app.db` or a file path | tables, views, FKs, indexes, SQL | yes (rows + raw `.sqlite` copy) | yes |
| SQL Server | `mssql://user:pass@host:1433/db` or an ADO string | schemas, tables, FKs, indexes, SQL | yes | yes (not yet tested against a live server) |

Every engine goes through the same adapter interface in `src/core/adapters/` (`test`, `listDatabases`, `listObjects`, `describe`, `rows`, `query`, `graph`, `dump`, `restoreCheck`, `restore`).

## Read-only by design

Exploring and backing up never write to your databases:

- SQL queries must be a single `SELECT` / `WITH … SELECT` / `EXPLAIN` / `SHOW` statement. Writes, DDL, multiple statements, `SELECT … INTO` and dangerous functions are rejected before they reach the server.
- They also run inside a read-only transaction (PostgreSQL, MySQL/MariaDB), a read-only file handle (SQLite) or a rolled-back transaction (SQL Server), with a timeout and a row cap.
- MongoDB queries are `find` or `aggregate` only; `$out`, `$merge`, `$where`, `$function` and `$accumulator` are blocked.
- Backups use consistent read snapshots (`REPEATABLE READ READ ONLY` in PostgreSQL, `WITH CONSISTENT SNAPSHOT` in MySQL).

Only two modules write, and both ask you to confirm: **Rotate** (MongoDB password hashes) and **Restore**.

## Backups

- Schedules: every N minutes/hours/days, daily at a set time, or weekly.
- Scope: a whole database or chosen tables/collections.
- Format: a zip with `metadata.json`, `checksums.json` (SHA-256 per file) and one folder per table/collection (`rows.ndjson` + `schema.json` for SQL, `documents.ndjson` + `indexes.json` for MongoDB). The old MongoDB backup format still opens, verifies and restores.
- Optional AES-256-GCM encryption with a job passphrase (`.zip.enc`). Encrypted files can be copied as-is; decrypt from the dashboard or after import if the passphrase is known.
- A `.sha256` file is written next to every backup.
- **Verify** checks: file present → SHA-256 matches → archive opens/decrypts → every entry matches its checksum → record counts match. Jobs can verify automatically after each run.
- **Retention**: keep the last N files and/or delete files older than N days. Only files this job created in its own folder are removed; history records are kept and marked “pruned”.

Click a history row to verify, restore, decrypt or open the file in the file manager. Missing files show the saved path and can be removed from the local record.

## Restore

Restore loads a backup into a database of the same engine family (MongoDB → MongoDB, PostgreSQL → PostgreSQL, MySQL ↔ MariaDB, …):

1. Pick the target connection and database (a new name such as `shop_restore` is the safe default).
2. **Preview** shows, per table/collection, whether it will be created, loaded into an empty table, or blocked because it already has data. Restore never overwrites data.
3. Type the target database name to confirm. Tables are created in foreign-key order, rows are inserted in batches, identity sequences and indexes are recreated. Each restore is logged in `data/write-audit.json`.

The connection must use a user that can create tables and insert rows. Your read-only backup users cannot restore.

## Explore

The dashboard is **connection-first**. The home page lists connections. Open one to explore, schedule backups, run analytics, apply seeds, view its pipeline, or rotate MongoDB passwords.

- A tree of databases → tables/collections with row counts and search, scoped to the open connection.
- **Data**: paginated grid with sorting and a column filter (SQL) or a JSON filter (MongoDB); click a row for the full JSON.
- **Structure**: columns/fields with types, keys, defaults, indexes and foreign keys.
- **Query**: read-only editor with `Ctrl + Enter`, history and a row cap.
- **Diagram**: an ER diagram drawn with React Flow; MongoDB relations are inferred from `…Id` fields.
- **Flow** tab: each job on that connection drawn as Source → Snapshot → Storage → Retention.
- `Ctrl + K` opens the command palette, `Ctrl + J` the assistant.

## Assistant (optional)

Add an OpenRouter key to turn on two helpers: **draft a query from plain language** (shown for review, checked by the same read-only guard, and only run when you click Run) and **explain a schema**. Only table, column and type names are sent; row data never leaves the device.

- Put `OPENROUTER_API_KEY=` in `.env`, or paste the key in **Settings → Assistant** (stored encrypted with the device master key and never returned to the browser).
- The default model is `deepseek/deepseek-v4.1-flash`. Change it in Settings or with `OPENROUTER_MODEL`.
- Without a key everything else works and the assistant shows how to enable it.

## Environment

Copy `.env.example` to `.env` on a new machine.

| Variable | Required | Where to get it |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | Yes (email) | IAM user with `ses:SendEmail` |
| `AWS_SECRET_ACCESS_KEY` | Yes (email) | Same IAM user |
| `AWS_REGION` | Yes | SES region, currently `eu-north-1` |
| `SES_FROM_EMAIL` | Yes | Must be a verified SES identity. Default `backups-service@tailoredtech.tech` |
| `APP_PORT` | No | Default `4780`. Dashboard binds to localhost only |
| `BACKUP_MASTER_KEY` | No | Optional override. Otherwise a key is created in `data/master.key` |
| `OPENROUTER_API_KEY` | No | [openrouter.ai/keys](https://openrouter.ai/keys). Turns on the assistant |
| `OPENROUTER_MODEL` | No | Default `deepseek/deepseek-v4.1-flash` |

SES sandbox can only send to verified addresses. Production access is required to mail arbitrary notify/user emails.

## What it stores on this device

`data/` is gitignored (connections, jobs, backup records, settings, encryption key, audit logs, logs). Copy the project to another PC and it starts empty.

## Password rotation

MongoDB only. Writes hashes only. Default is bcrypt with 10 salt rounds, matching Bahri-MOC-PCR. User notify email is off unless you enable it.

## Design

The dashboard follows a small brand kit in `web/src/index.css`: CSS-variable tokens for colour, radius and shadow with a dark theme (default) and a light theme, Inter and JetBrains Mono (self-hosted), Lucide icons, and database logos from [svgl.app](https://svgl.app) in `web/public/brands/` (see the README there for trademark notes).

## Ubuntu notes

```bash
chmod +x start.sh
./start.sh
npm run install:service
loginctl enable-linger "$USER"
```

Install `zenity` if you want a native folder picker (`sudo apt install zenity`).
