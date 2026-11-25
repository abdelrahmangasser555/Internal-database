import { useMemo, useState } from 'react';
import { CalendarClock, FileInput, FolderArchive, Lock, Pause, Play, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Card, Confirm, Empty, Input, PageHeader, Select, StatusDot } from '../components/ui.jsx';
import { EngineLogo } from '../components/EngineLogo.jsx';
import { compact, formatWhen, relativeTime, verificationTone } from '../lib/format.js';
import { ENGINES } from '../lib/engines.js';

export function BackupsPage() {
  const { jobs, records, openSheet, refresh, connections } = useApp();
  const [runningId, setRunningId] = useState(null);
  const [importPath, setImportPath] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [engine, setEngine] = useState('all');
  const [removeJob, setRemoveJob] = useState(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return records.filter((r) => {
      if (engine !== 'all' && (r.engine || 'mongodb') !== engine) return false;
      if (status === 'ok' && !(r.status === 'success' && r.exists)) return false;
      if (status === 'failed' && r.status === 'success') return false;
      if (status === 'missing' && (r.exists || r.status !== 'success')) return false;
      if (status === 'unverified' && (r.status !== 'success' || r.verification?.status === 'verified')) return false;
      if (term && ![r.jobName, r.database, r.connectionName, r.fileName].some((v) => String(v || '').toLowerCase().includes(term))) return false;
      return true;
    });
  }, [records, q, status, engine]);

  const usedEngines = [...new Set(records.map((r) => r.engine || 'mongodb'))];

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-5 py-6 md:px-8">
      <PageHeader
        title="Backups"
        subtitle="Scheduled read-only snapshots with checksums, optional AES-256 encryption, retention and one-click verification."
        actions={
          <Button variant="primary" onClick={() => openSheet({ type: 'job', job: {} })}>
            <Plus size={15} /> New backup job
          </Button>
        }
      />

      {!jobs.length ? (
        <Card>
          <Empty
            icon={FolderArchive}
            title="No backup jobs yet"
            body="A job snapshots one database on a schedule into a folder you choose."
            action={
              <Button variant="primary" onClick={() => openSheet({ type: 'job', job: {} })}>
                Create job
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => {
            const conn = connections.find((c) => c.id === job.connectionId);
            const last = records.find((r) => r.jobId === job.id);
            const r = job.retention || {};
            return (
              <Card key={job.id} className="flex flex-col gap-3.5 p-4">
                <button type="button" className="flex items-start gap-3 text-left" onClick={() => openSheet({ type: 'job', job })}>
                  <EngineLogo engine={conn?.engine} size={17} tile />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{job.name}</span>
                    <span className="block truncate text-[12px] text-subtle">
                      {conn?.name || 'Missing connection'} · {job.database}
                    </span>
                  </span>
                  {job.running ? (
                    <Badge tone="primary" dot pulse>
                      running
                    </Badge>
                  ) : (
                    <Badge tone={job.enabled ? 'ok' : 'muted'} dot>
                      {job.enabled ? 'scheduled' : 'paused'}
                    </Badge>
                  )}
                </button>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock size={12} className="text-subtle" /> {job.intervalLabel}
                  </span>
                  <span className="truncate">{job.enabled ? `Next ${job.nextRunLabel}` : 'Paused'}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Lock size={12} className="text-subtle" /> {job.encrypt ? 'Encrypted' : 'Plain zip'}
                  </span>
                  <span className="truncate">{r.keepLast || r.maxAgeDays ? [r.keepLast && `keep ${r.keepLast}`, r.maxAgeDays && `${r.maxAgeDays}d`].filter(Boolean).join(' · ') : 'Keep all'}</span>
                </div>
                <div className="flex items-center gap-2 rounded-md bg-surface-2/70 px-2.5 py-1.5 text-[11.5px] text-muted">
                  {last ? (
                    <>
                      <StatusDot tone={last.status === 'success' ? 'ok' : 'fail'} />
                      <span className="truncate">
                        Last {last.status} {relativeTime(last.finishedAt || last.startedAt)} · {last.sizeLabel}
                      </span>
                    </>
                  ) : (
                    <span>Never run</span>
                  )}
                </div>
                <div className="mt-auto flex gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={runningId === job.id || job.running}
                    onClick={async () => {
                      setRunningId(job.id);
                      try {
                        const rec = await API.jobs.run(job.id);
                        if (rec?.status && rec.status !== 'success') toast.error(rec.error || 'Backup failed');
                        else toast.success('Backup finished');
                        await refresh();
                      } catch (err) {
                        toast.error(err.message);
                      } finally {
                        setRunningId(null);
                      }
                    }}
                  >
                    <Play size={13} /> Run now
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await API.jobs.toggle(job.id);
                      await refresh();
                    }}
                  >
                    {job.enabled ? <Pause size={13} /> : <Play size={13} />} {job.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => setRemoveJob(job)} aria-label="Delete job">
                    <Trash2 size={13} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold">History</h2>
            <p className="text-[12px] text-subtle">
              {filtered.length} of {records.length} files. Click a row to verify, restore or open it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-8 w-44 pl-8 text-[12.5px]" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-36 text-[12.5px]">
              <option value="all">All statuses</option>
              <option value="ok">Success</option>
              <option value="failed">Failed</option>
              <option value="missing">Missing file</option>
              <option value="unverified">Not verified</option>
            </Select>
            <Select value={engine} onChange={(e) => setEngine(e.target.value)} className="h-8 w-36 text-[12.5px]">
              <option value="all">All engines</option>
              {usedEngines.map((e) => (
                <option key={e} value={e}>
                  {ENGINES[e]?.label || e}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {!records.length ? (
          <p className="px-4 py-10 text-center text-[13px] text-subtle">No backups on this device yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-[11.5px] text-muted">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Database</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Integrity</th>
                  <th className="px-4 py-2 text-right font-medium">Records</th>
                  <th className="px-4 py-2 text-right font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">File</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rec) => {
                  const v = verificationTone(rec.verification);
                  return (
                    <tr key={rec.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2/60" onClick={() => openSheet({ type: 'record', record: rec })}>
                      <td className="whitespace-nowrap px-4 py-2.5" title={formatWhen(rec.finishedAt || rec.startedAt)}>
                        {relativeTime(rec.finishedAt || rec.startedAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <EngineLogo engine={rec.engine} size={14} />
                          <span className="max-w-[180px] truncate font-medium">{rec.jobName}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{rec.database}</td>
                      <td className="px-4 py-2.5">
                        {rec.status === 'success' ? (
                          rec.pruned ? (
                            <Badge>pruned</Badge>
                          ) : rec.exists ? (
                            <Badge tone="ok">success</Badge>
                          ) : (
                            <Badge tone="warn">missing file</Badge>
                          )
                        ) : (
                          <Badge tone="fail">{rec.status}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {rec.status === 'success' ? (
                          <span className="inline-flex items-center gap-1">
                            <Badge tone={v.tone}>
                              <ShieldCheck size={10} /> {v.label}
                            </Badge>
                            {rec.encrypted ? (
                              <Badge tone="primary">
                                <Lock size={10} />
                              </Badge>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                      <td className="num px-4 py-2.5 text-right text-muted">{compact(rec.documentCount)}</td>
                      <td className="num px-4 py-2.5 text-right text-muted">{rec.sizeLabel}</td>
                      <td className={`max-w-[260px] truncate px-4 py-2.5 font-mono text-[11px] ${rec.exists ? 'text-subtle' : 'text-warn'}`} title={rec.filePath}>
                        {rec.fileName}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filtered.length ? <p className="px-4 py-8 text-center text-[13px] text-subtle">Nothing matches these filters.</p> : null}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <FileInput size={14} className="text-subtle" />
          <span className="text-[12px] text-muted">Import an existing backup file</span>
          <Input value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="Full path to a .zip or .zip.enc" className="h-8 min-w-[240px] flex-1 font-mono text-[12px]" />
          <Button
            size="sm"
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
      </Card>

      <Confirm
        open={Boolean(removeJob)}
        danger
        title={`Delete “${removeJob?.name}”?`}
        body="The schedule is removed. Backup files already written stay on disk and in history."
        confirmLabel="Delete job"
        onClose={() => setRemoveJob(null)}
        onConfirm={async () => {
          await API.jobs.remove(removeJob.id);
          toast.success('Job deleted');
          setRemoveJob(null);
          await refresh();
        }}
      />
    </div>
  );
}
