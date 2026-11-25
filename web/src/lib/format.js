export function relativeTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return String(iso);
  const delta = Date.now() - then;
  const abs = Math.abs(delta);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const table = [
    [60_000, 1000, 'second'],
    [3_600_000, 60_000, 'minute'],
    [86_400_000, 3_600_000, 'hour'],
    [604_800_000, 86_400_000, 'day'],
    [2_592_000_000, 604_800_000, 'week'],
    [31_536_000_000, 2_592_000_000, 'month'],
  ];
  for (const [limit, unitMs, unit] of table) {
    if (abs < limit) return rtf.format(-Math.round(delta / unitMs), unit);
  }
  return rtf.format(-Math.round(delta / 31_536_000_000), 'year');
}

export function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function cell(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value.$oid) return value.$oid;
    if (value.$date) return typeof value.$date === 'string' ? value.$date : JSON.stringify(value.$date);
    return JSON.stringify(value);
  }
  return String(value);
}

export function docId(doc) {
  const id = doc?._id;
  if (id && typeof id === 'object' && id.$oid) return id.$oid;
  if (id != null) return String(id);
  return '';
}

export function connectionName(connections, id) {
  return connections.find((c) => c.id === id)?.name || 'Connection';
}

export function bytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function compact(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n));
}

export function duration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function verificationTone(v) {
  if (!v) return { tone: 'muted', label: 'not verified' };
  if (v.status === 'verified') return { tone: 'ok', label: 'verified' };
  if (v.status === 'partial') return { tone: 'warn', label: 'partly verified' };
  return { tone: 'fail', label: 'verify failed' };
}
