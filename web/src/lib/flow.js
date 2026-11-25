import { MarkerType } from '@xyflow/react';
import { bytes, verificationTone } from './format.js';

// Pipeline per job: Source → Snapshot → Storage → Retention.
// Connections without jobs get a source node plus a ghost "add job" node.

const COL = { source: 0, snapshot: 300, storage: 600, retention: 900 };
const ROW = 170;

function edge(id, source, target, { live = true, warn = false } = {}) {
  const stroke = warn ? 'var(--warn)' : live ? 'var(--primary)' : 'var(--line-strong)';
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    className: live ? 'edge-flow' : undefined,
    style: { stroke, strokeWidth: 1.6, opacity: live ? 0.85 : 0.6 },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
  };
}

export function buildPipeline({ connections, jobs, records, filterConnection }) {
  const nodes = [];
  const edges = [];
  let row = 0;
  const conns = filterConnection ? connections.filter((c) => c.id === filterConnection) : connections;

  for (const conn of conns) {
    const connJobs = jobs.filter((j) => j.connectionId === conn.id);
    const span = Math.max(1, connJobs.length);
    const sourceY = row * ROW + ((span - 1) * ROW) / 2;
    nodes.push({ id: `src-${conn.id}`, type: 'source', position: { x: COL.source, y: sourceY }, data: { conn, jobs: connJobs.length } });

    if (!connJobs.length) {
      nodes.push({ id: `ghost-${conn.id}`, type: 'ghost', position: { x: COL.snapshot, y: sourceY + 12 }, data: { conn } });
      edges.push(edge(`e-ghost-${conn.id}`, `src-${conn.id}`, `ghost-${conn.id}`, { live: false }));
    }

    connJobs.forEach((job, i) => {
      const y = (row + i) * ROW;
      const jobRecords = records.filter((r) => r.jobId === job.id);
      const latest = jobRecords[0];
      const files = jobRecords.filter((r) => r.status === 'success' && r.exists && !r.pruned);
      const totalSize = files.reduce((s, r) => s + (r.size || 0), 0);
      const live = job.enabled;
      const failed = latest && latest.status !== 'success';

      nodes.push({ id: `snap-${job.id}`, type: 'snapshot', position: { x: COL.snapshot, y }, data: { job, latest } });
      nodes.push({
        id: `store-${job.id}`,
        type: 'storage',
        position: { x: COL.storage, y },
        data: { job, latest, files: files.length, totalSize: bytes(totalSize), verification: verificationTone(latest?.verification) },
      });
      nodes.push({
        id: `ret-${job.id}`,
        type: 'retention',
        position: { x: COL.retention, y },
        data: { job, files: files.length, pruned: jobRecords.filter((r) => r.pruned).length },
      });
      edges.push(edge(`e-s-${job.id}`, `src-${conn.id}`, `snap-${job.id}`, { live }));
      edges.push(edge(`e-st-${job.id}`, `snap-${job.id}`, `store-${job.id}`, { live, warn: failed }));
      edges.push(edge(`e-r-${job.id}`, `store-${job.id}`, `ret-${job.id}`, { live: live && Boolean(job.retention?.keepLast || job.retention?.maxAgeDays) }));
    });
    row += span;
  }
  return { nodes, edges };
}
