import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

let client;

function getClient() {
  if (client) return client;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'eu-north-1';
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for SES');
  }
  client = new SESClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export function fromAddress() {
  return process.env.SES_FROM_EMAIL || 'backups-service@tailoredtech.tech';
}

function wrapHtml(title, inner) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0b1a21;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#E8EDEB;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1a21;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#112733;border:1px solid #3D4F58;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid #3D4F58;">
            <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#00ED64;">Backup Service</div>
            <div style="font-size:20px;font-weight:600;margin-top:6px;">${title}</div>
          </td>
        </tr>
        <tr><td style="padding:24px;">${inner}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function rowsHtml(rows) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${rows
        .map(
          ([label, value]) => `
        <tr>
          <td style="padding:8px 0;width:180px;color:#C1C7C6;font-size:13px;vertical-align:top;">${label}</td>
          <td style="padding:8px 0;font-size:13px;color:#E8EDEB;">${value ?? '—'}</td>
        </tr>`,
        )
        .join('')}
    </table>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendHtmlEmail({ to, subject, html }) {
  const destinations = (Array.isArray(to) ? to : [to])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!destinations.length) return { skipped: true };
  const result = await getClient().send(
    new SendEmailCommand({
      Source: fromAddress(),
      Destination: { ToAddresses: destinations },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }),
  );
  return { skipped: false, messageId: result.MessageId };
}

export function backupEmailHtml(input) {
  const labels = { mongodb: 'MongoDB', postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', sqlite: 'SQLite', mssql: 'SQL Server' };
  const record = { ...input, engineLabel: labels[input.engine] || 'MongoDB' };
  const collections = (record.collections || [])
    .map((col) => `${escapeHtml(col.name)} <span style="color:#C1C7C6;">(${col.count} ${record.engine && record.engine !== 'mongodb' ? 'rows' : 'docs'})</span>`)
    .join('<br>');
  const statusColor = record.status === 'success' ? '#00ED64' : '#DB3030';
  return wrapHtml(
    record.status === 'success' ? 'Backup completed' : 'Backup failed',
    `
      <div style="margin-bottom:16px;font-size:13px;color:#C1C7C6;">
        A ${escapeHtml(record.engineLabel || "database")} backup ran on <strong style="color:#E8EDEB;">${escapeHtml(record.device)}</strong>.
      </div>
      ${rowsHtml([
        ['Status', `<span style="color:${statusColor};font-weight:600;">${escapeHtml(record.status)}</span>`],
        ['Connection', escapeHtml(record.connectionName)],
        ['Database', escapeHtml(record.database)],
        ['Collections', collections || '—'],
        ['Documents', escapeHtml(record.documentCount)],
        ['Size', escapeHtml(record.sizeLabel)],
        ['Encrypted', record.encrypted ? 'Yes (AES-256-GCM)' : 'No'],
        ['Duration', escapeHtml(record.durationMs ? `${Math.round(record.durationMs / 1000)}s` : '')],
        ['Started', escapeHtml(record.startedAt)],
        ['Finished', escapeHtml(record.finishedAt)],
        ['Location', `<code style="color:#00ED64;">${escapeHtml(record.filePath)}</code>`],
        ['Error', record.error ? escapeHtml(record.error) : ''],
      ])}
    `,
  );
}

export function passwordEmailHtml({ name, username, email, password, customMessage, database, connectionName }) {
  const message = customMessage
    ? `<div style="margin-bottom:16px;padding:12px 14px;background:#21313C;border-radius:6px;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(customMessage)}</div>`
    : '';
  return wrapHtml(
    'Your password has been rotated',
    `
      ${message}
      <div style="margin-bottom:16px;font-size:13px;color:#C1C7C6;">
        Credentials were updated for database <strong style="color:#E8EDEB;">${escapeHtml(database)}</strong>
        on ${escapeHtml(connectionName)}.
      </div>
      ${rowsHtml([
        ['Name', escapeHtml(name)],
        ['Username', escapeHtml(username)],
        ['Email', escapeHtml(email)],
        ['New password', `<code style="font-size:16px;color:#00ED64;">${escapeHtml(password)}</code>`],
      ])}
      <p style="margin-top:18px;font-size:12px;color:#C1C7C6;">Keep this password private. You can change it after you sign in.</p>
    `,
  );
}

export function renderTemplate(template, vars) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '');
}
