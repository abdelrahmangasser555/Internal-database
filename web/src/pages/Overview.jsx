import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, FolderArchive, KeyRound, Plus, ShieldCheck, Workflow } from 'lucide-react';
import { ReactFlow, Background, BackgroundVariant } from '@xyflow/react';
import { useApp } from '../state/AppState.jsx';
import { relativeTime } from '../lib/format.js';
import { Badge, Button, Card, Empty } from '../components/ui.jsx';
import { nodeTypes } from '../components/flow/nodes.jsx';
import { buildFlow } from '../lib/flow.js';

export function OverviewPage() {
  const { meta, connections, jobs, records, openSheet } = useApp();
  const navigate = useNavigate();
  const latest = records[0];
  const okCount = records.filter((r) => r.status === 'success' && r.exists).length;
  const encrypted = records.filter((r) => r.encrypted).length;
  const { nodes, edges } = useMemo(
    () => buildFlow({ meta, connections, jobs, records, compact: true }),
    [meta, connections, jobs, records],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-mist">Local operations</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Keep Mongo copies on this machine</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-mist">
            Compass-style browse, scheduled read-only dumps, and a separate password-rotate write path. Everything on this
            device stays on this device.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/flow')}>
            <Workflow size={16} /> Open flow
          </Button>
          <Button variant="primary" onClick={() => openSheet({ type: 'connection' })}>
            <Plus size={16} /> New connection
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Connections" value={connections.length} icon={Database} />
        <Stat label="Jobs" value={jobs.length} icon={FolderArchive} hint={jobs.filter((j) => j.enabled).length + ' live'} />
        <Stat label="Successful files" value={okCount} icon={ShieldCheck} />
        <Stat label="Encrypted" value={encrypted} icon={KeyRound} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <Card className="h-[360px] overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="font-display font-semibold">Pipeline</div>
              <div className="text-xs text-mist">Device → connections → jobs → latest files</div>
            </div>
            <Button variant="quiet" onClick={() => navigate('/flow')}>
              Expand
            </Button>
          </div>
          {connections.length ? (
            <div className="h-[300px]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                panOnDrag
                zoomOnScroll={false}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                colorMode="dark"
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(138,163,173,0.25)" />
              </ReactFlow>
            </div>
          ) : (
            <Empty
              icon={Database}
              title="No connections yet"
              body="Add a Mongo URI to start browsing and scheduling dumps."
              action={
                <Button variant="primary" onClick={() => openSheet({ type: 'connection' })}>
                  Add connection
                </Button>
              }
            />
          )}
        </Card>
        <Card>
          <div className="font-display font-semibold">Latest activity</div>
          <div className="mt-4 space-y-3">
            {latest ? (
              <button
                type="button"
                className="w-full rounded-xl border border-line bg-ink-2 p-3 text-left hover:border-leaf/40"
                onClick={() => openSheet({ type: 'record', record: latest })}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{latest.jobName}</span>
                  <Badge tone={latest.status === 'success' && latest.exists ? 'ok' : 'warn'}>{latest.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-mist">
                  {latest.database} · {latest.sizeLabel} · {relativeTime(latest.finishedAt || latest.startedAt)}
                </p>
              </button>
            ) : (
              <p className="text-sm text-mist">No backups on this device yet.</p>
            )}
            {jobs.slice(0, 4).map((job) => (
              <div key={job.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                <div>
                  <div className="text-sm">{job.name}</div>
                  <div className="text-[11px] text-mist">{job.intervalLabel} · {job.nextRunLabel}</div>
                </div>
                <Badge tone={job.enabled ? 'ok' : 'muted'}>{job.enabled ? 'on' : 'off'}</Badge>
              </div>
            ))}
            <Button className="w-full" onClick={() => openSheet({ type: 'job', job: {} })}>
              New backup job
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, hint }) {
  return (
    <Card className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-leaf/10 text-leaf">
        <Icon size={18} />
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.14em] text-mist">{label}</div>
        <div className="font-display text-2xl font-semibold">{value}</div>
        {hint ? <div className="text-[11px] text-mist">{hint}</div> : null}
      </div>
    </Card>
  );
}
