import { MarkerType } from '@xyflow/react';
import { bytes } from './format.js';

const edgeBase = {
  animated: true,
  style: { stroke: 'rgba(0,237,100,0.45)', strokeWidth: 1.6 },
  markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(0,237,100,0.7)', width: 16, height: 16 },
};

export function buildFlow({ meta, connections, jobs, records, compact = false }) {
  const nodes = [
    {
      id: 'device',
      type: 'device',
      position: { x: 0, y: 80 },
      data: { name: meta.device || 'this device', platform: meta.platform || '' },
    },
  ];
  const edges = [];
  const gapY = compact ? 130 : 150;
  const startY = connections.length <= 1 ? 80 : 0;

  connections.forEach((conn, i) => {
    const y = startY + i * gapY;
    nodes.push({
      id: `c-${conn.id}`,
      type: 'connection',
      position: { x: 280, y },
      data: conn,
    });
    edges.push({ id: `e-dev-${conn.id}`, source: 'device', target: `c-${conn.id}`, ...edgeBase });

    const connJobs = jobs.filter((j) => j.connectionId === conn.id);
    const shownJobs = compact ? connJobs.slice(0, 1) : connJobs;
    shownJobs.forEach((job, ji) => {
      const jy = y + ji * (compact ? 0 : 120);
      nodes.push({
        id: `j-${job.id}`,
        type: 'job',
        position: { x: 600, y: jy },
        data: job,
      });
      edges.push({ id: `e-c-${job.id}`, source: `c-${conn.id}`, target: `j-${job.id}`, ...edgeBase });

      const rec = records.find((r) => r.jobId === job.id);
      if (rec) {
        nodes.push({
          id: `r-${rec.id}`,
          type: 'archive',
          position: { x: 900, y: jy },
          data: {
            status: rec.exists ? rec.status : 'missing file',
            ok: rec.status === 'success' && rec.exists,
            sizeLabel: rec.sizeLabel || bytes(rec.size),
            record: rec,
          },
        });
        edges.push({
          id: `e-j-${rec.id}`,
          source: `j-${job.id}`,
          target: `r-${rec.id}`,
          ...edgeBase,
          style: { ...edgeBase.style, stroke: rec.exists ? edgeBase.style.stroke : 'rgba(255,192,16,0.7)' },
        });
      }
    });
  });

  return { nodes, edges };
}
