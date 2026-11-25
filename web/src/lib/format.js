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
  return d.toLocaleString();
}

export function cell(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
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
