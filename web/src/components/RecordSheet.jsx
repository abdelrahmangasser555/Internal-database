import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, FolderOpen, LockOpen, RotateCcw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { bytes, duration, formatWhen, verificationTone } from '../lib/format.js';
import { engineOf, shortName } from '../lib/engines.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Confirm, Field, Input, KeyValue, Sheet } from './ui.jsx';
import { EngineLogo } from './EngineLogo.jsx';
import { cn } from '../lib/cn.js';

export function RecordSheet() {
  const { sheet, closeSheet, refresh, openSheet, records, jobs } = useApp();
  const open = sheet?.type === 'record';
  const rec = open ? records.find((r) => r.id === sheet.record?.id) || sheet.record : null;
  const [report, setReport] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setReport(null);
    setPassphrase('');
  }, [rec?.id]);

  if (!rec) return <Sheet open={false} onClose={closeSheet} title="" />;

  const engine = rec.engine || 'mongodb';
  const info = engineOf(engine);
  const job = jobs.find((j) => j.id === rec.jobId);
  const needsPass = rec.encrypted && !job?.hasPassphrase;
  const v = verificationTone(rec.verification);

  const verify = async () => {
    setVerifying(true);
    try {
      const result = await API.records.verify(rec.id, passphrase || undefined);
      setReport(result);
      if (result.summary.status === 'verified') toast.success('Backup verified');
      else if (result.summary.status === 'partial') toast.warning('Verified with warnings');
      else toast.error('Verification failed');
      refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Sheet
      open={open}
      wide
      title={rec.jobName || 'Backup'}
      subtitle={rec.fileName}
      icon={<EngineLogo engine={engine} size={18} tile />}
      onClose={closeSheet}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!rec.exists || rec.status !== 'success'} onClick={() => openSheet({ type: 'restore', record: rec })}>
            <RotateCcw size={14} /> Restore…
          </Button>
          <Button loading={verifying} disabled={!rec.exists} onClick={verify}>
            <ShieldCheck size={14} /> Verify
          </Button>
          <Button
            onClick={async () => {
              try {
                const result = await API.records.open(rec.id);
                if (!result.exists) toast.warning(`File is missing. ${result.path || rec.filePath}`);
                else toast.success('Opened in file manager');
              } catch (err) {
                toast.error(err.message);
              }
            }}
          >
            <FolderOpen size={14} /> Show file
          </Button>
          {rec.encrypted && rec.exists ? (
            <Button
              onClick={async () => {
                try {
                  await API.records.decryptOpen(rec.id, passphrase || undefined);
                  toast.success('Decrypted to a temp folder and opened');
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              <LockOpen size={14} /> Decrypt & open
            </Button>
          ) : null}
          <Button variant="ghost" className="ml-auto text-danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Remove record
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-1.5">
          {rec.status === 'success' ? (
            rec.pruned ? <Badge tone="muted">pruned by retention</Badge> : rec.exists ? <Badge tone="ok" dot>file present</Badge> : <Badge tone="warn" dot>file missing</Badge>
          ) : (
            <Badge tone="fail" dot>{rec.status}</Badge>
          )}
          <Badge tone={v.tone}>{v.label}</Badge>
          {rec.encrypted ? <Badge tone="primary">encrypted</Badge> : <Badge>plain zip</Badge>}
          <Badge>{rec.reason || 'backup'}</Badge>
          <Badge>{info.label}</Badge>
        </div>

        {rec.error ? (
          <div className="flex gap-2 rounded-lg border border-danger/25 bg-danger/8 p-3 text-[13px] text-danger">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {rec.error}
          </div>
        ) : null}

        <KeyValue
          items={[
            ['Connection', rec.connectionName],
            ['Database', rec.database],
            [info.family === 'sql' ? 'Rows' : 'Documents', rec.documentCount?.toLocaleString?.() ?? rec.documentCount],
            ['Size', rec.sizeLabel || bytes(rec.size)],
            ['Started', formatWhen(rec.startedAt)],
            ['Duration', duration(rec.durationMs)],
            ['Device', rec.device],
            ['SHA-256', rec.sha256 || rec.sha256Observed || '—', { mono: true }],
            ['Location', rec.filePath, { mono: true }],
            rec.pruned ? ['Pruned', `${formatWhen(rec.prunedAt)} · ${rec.prunedReason}`] : null,
          ]}
        />

        {(rec.collections || []).length ? (
          <div>
            <h4 className="mb-2 text-[12px] font-medium text-muted">
              {rec.collections.length} {info.objects}
            </h4>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-[12.5px]">
                <tbody>
                  {rec.collections.map((c) => (
                    <tr key={c.name} className="border-b border-line last:border-0">
                      <td className="px-3 py-1.5">{shortName(c.name, engine)}</td>
                      <td className="num px-3 py-1.5 text-right text-muted">{c.count?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {needsPass && rec.exists ? (
          <Field label="Passphrase" hint="This file is encrypted and its job has no saved passphrase. It is only used for this check and is not stored.">
            <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </Field>
        ) : null}

        {report ? (
          <div>
            <h4 className="mb-2 text-[12px] font-medium text-muted">Verification</h4>
            <ul className="space-y-1.5">
              {report.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2.5 rounded-md border border-line bg-surface-2/50 px-3 py-2">
                  {c.status === 'pass' ? (
                    <CircleCheck size={15} className="mt-0.5 shrink-0 text-ok" />
                  ) : c.status === 'warn' ? (
                    <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" />
                  ) : (
                    <CircleX size={15} className="mt-0.5 shrink-0 text-danger" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px]">{c.label}</div>
                    {c.detail ? <div className={cn('mt-0.5 break-all text-[11.5px] text-subtle', c.id === 'sha256' && 'font-mono')}>{c.detail}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : rec.verification ? (
          <p className="text-[12px] text-subtle">Last verified {formatWhen(rec.verification.checkedAt)}.</p>
        ) : null}
      </div>
      <Confirm
        open={confirmDelete}
        danger
        title="Remove this record?"
        body="Only the history entry on this device is removed. The backup file itself is not deleted."
        confirmLabel="Remove record"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await API.records.remove(rec.id);
          toast.success('Record removed');
          setConfirmDelete(false);
          await refresh();
          closeSheet();
        }}
      />
    </Sheet>
  );
}
