# Backup Service

Local MongoDB backup scheduler, Compass-style browser, and password rotation. Runs on Windows and Ubuntu. Device data stays on the machine.

## Run

```bash
npm install
npm start
```

Dashboard: `http://127.0.0.1:4780`

During UI development (hot reload):

```bash
npm run dev
```

Vite serves the dashboard at `http://127.0.0.1:5173` and proxies `/api` to the Express app on `4780`.

Headless worker only (for boot):

```bash
npm run worker
npm run install:service
```

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

SES sandbox can only send to verified addresses. Production access is required to mail arbitrary notify/user emails.

## What it stores on this device

`data/` is gitignored (connections, jobs, backup records, encryption key, logs). Copy the project to another PC and it starts empty.

## Backups

Read-only Mongo dumps (no writes). Optional AES-256-GCM encryption with a job passphrase. Encrypted files (`.zip.enc`) can be copied as-is; decrypt from the dashboard or after import if the passphrase is known.

Click a history row to open Explorer / the file manager. Missing files show the saved path and can be deleted from the local record.

## Password rotation

Writes hashes only. Default is bcrypt with 10 salt rounds, matching Bahri-MOC-PCR. User notify email is off unless you enable it.

## Ubuntu notes

```bash
chmod +x start.sh
npm install
npm start
npm run install:service
loginctl enable-linger "$USER"
```

Install `zenity` if you want a native folder picker (`sudo apt install zenity`).
