import { useState } from 'react';
import { FolderArchive, Play, Power, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, Empty } from '../components/ui.jsx';
import { formatWhen, relativeTime } from '../lib/format.js';

export function BackupsPage() {
  const { jobs, records, openSheet, refresh, connections } = useApp();
  const [runningId, setRunningId] = useState(null);
  const [importPath, setImportPath] = useState('');

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Backups</h1>
          <p className="text-sm text-mist">Scheduled read-only dumps. Files stay where you point the job.</p>
        </div>
        <Button variant="primary" onClick={() => openSheet({ type: 'job', job: {} })}>
          New backup job
        </Button>
      </div>

      {!jobs.length ? (
        <Card>
          <Empty
            icon={FolderArchive}
            title="No jobs yet"
            body="Create a job to dump a database on a cadence, optionally encrypting the zip."
            action={<Button variant="primary" onClick={() => openSheet({ type: 'job', job: {} })}>Create job</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {jobs.map((job) => {
            const conn = connections.find((c) => c.id === job.connectionId);
            return (
              <Card key={job.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="text-left" onClick={() => openSheet({ type: 'job', job })}>
                    <div className="font-display text-lg font-semibold">{job.name}</div>
                    <div className="text-sm text-mist">
                      {conn?.name || 'Connection'} · {job.database}
                    </div>
                  </button>
                  <Badge tone={job.enabled ? 'ok' : 'muted'}>{job.enabled ? 'scheduled' : 'paused'}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-mist">
                  <div>{job.intervalLabel}</div>
                  <div>Next {job.nextRunLabel}</div>
                  <div>{job.encrypt ? 'Encrypted' : 'Plain zip'}</div>
                  <div>{job.allCollections ? 'All collections' : (job.collections || []).join(', ') || '—'}</div>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={runningId === job.id}
                    onClick={async () => {
                      setRunningId(job.id);
                      try {
                        await API.jobs.run(job.id);
                        toast.success('Backup finished');
                        await refresh();
                      } catch (err) {
                        toast.error(err.message);
                      } finally {
                        setRunningId(null);
                      }
                    }}
                  >
                    <Play size={14} /> {runningId === job.id ? 'Running…' : 'Run now'}
                  </Button>
                  <Button
                    onClick={async () => {
                      await API.jobs.toggle(job.id);
                      await refresh();
                    }}
                  >
                    <Power size={14} /> Toggle
                  </Button>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (!confirm('Delete this backup job? Files already written are kept.')) return;
                      await API.jobs.remove(job.id);
                      toast.success('Job deleted');
                      await refresh();
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">History</h2>
            <p className="text-xs text-mist">Click a row to open the file sheet. Missing files stay as records until you delete them.</p>
          </div>
          <div className="flex gap-2">
            <input
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="Import existing zip path"
              className="w-64 rounded-xl border border-line bg-ink-2 px-3 py-2 text-xs"
            />
            <Button
              onClick={async () => {
                if (!importPath.trim()) return toast.error('Path required');
                try {
                  await API.records.import({ filePath: importPath.trim() });
                  toast.success('Imported');
                  setImportPath('');
                  await refresh();
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Import
            </Button>
          </div>
        </div>
        {!records.length ? (
          <p className="text-sm text-mist">No backups on this device yet.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-mist">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Job</th>
                  <th className="py-2 pr-4">Database</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2">Location</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => (
                  <tr
                    key={rec.id}
                    className="cursor-pointer border-t border-line hover:bg-white/5"
                    onClick={() => openSheet({ type: 'record', record: rec })}
                  >
                    <td className="py-2.5 pr-4" title={formatWhen(rec.finishedAt || rec.startedAt)}>
                      {relativeTime(rec.finishedAt || rec.startedAt)}
                    </td>
                    <td className="py-2.5 pr-4">{rec.jobName}</td>
                    <td className="py-2.5 pr-4">{rec.database}</td>
                    <td className="py-2.5 pr-4">
                      {rec.status === 'success' ? (
                        rec.exists ? (
                          <Badge tone="ok">success</Badge>
                        ) : (
                          <Badge tone="warn">missing file</Badge>
                        )
                      ) : (
                        <Badge tone="fail">{rec.status}</Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">{rec.sizeLabel}</td>
                    <td className={`max-w-[280px] truncate py-2.5 font-mono text-xs ${rec.exists ? '' : 'text-warn'}`}>
                      {rec.filePath}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
