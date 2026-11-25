import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, Eye, RotateCcw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Confirm, Field, Input, Select, Sheet } from './ui.jsx';
import { EngineLogo } from './EngineLogo.jsx';
import { engineOf, shortName } from '../lib/engines.js';
import { compact, duration } from '../lib/format.js';

const family = (e) => (e === 'mariadb' ? 'mysql' : e || 'mongodb');

export function RestoreSheet() {
  const { sheet, closeSheet, connections, jobs } = useApp();
  const open = sheet?.type === 'restore';
  const rec = open ? sheet.record : null;
  const engine = rec?.engine || 'mongodb';
  const info = engineOf(engine);
  const targets = useMemo(() => connections.filter((c) => family(c.engine) === family(engine)), [connections, engine]);

  const [connectionId, setConnectionId] = useState('');
  const [database, setDatabase] = useState('');
  const [dbs, setDbs] = useState([]);
  const [picked, setPicked] = useState([]);
  const [passphrase, setPassphrase] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open || !rec) return;
    const first = targets.find((c) => c.id === rec.connectionId) || targets[0];
    setConnectionId(first?.id || '');
    setDatabase(engine === 'sqlite' ? 'main' : `${rec.database}_restore`);
    setPicked((rec.collections || []).map((c) => c.name));
    setPassphrase('');
    setPreview(null);
    setResult(null);
  }, [open, rec?.id]);

  useEffect(() => {
    if (!open || !connectionId) return;
    API.connections.databases(connectionId).then(setDbs).catch(() => setDbs([]));
    setPreview(null);
  }, [open, connectionId]);

  if (!rec) return <Sheet open={false} onClose={closeSheet} title="" />;
  const job = jobs.find((j) => j.id === rec.jobId);
  const needsPass = rec.encrypted && !job?.hasPassphrase;
  const body = { connectionId, database, objects: picked, passphrase: passphrase || undefined };

  const runPreview = async () => {
    setBusy(true);
    setResult(null);
    try {
      setPreview(await API.records.restorePreview(rec.id, body));
    } catch (err) {
      toast.error(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      wide
      title="Restore backup"
      subtitle={`${rec.fileName} · ${info.label}`}
      icon={<EngineLogo engine={engine} size={18} tile />}
      onClose={closeSheet}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-subtle">Restore never overwrites: targets must be new or empty.</span>
          <div className="flex gap-2">
            <Button loading={busy && !confirmOpen} onClick={runPreview} disabled={!connectionId || !database || !picked.length}>
              <Eye size={14} /> Preview
            </Button>
            <Button variant="primary" disabled={!preview?.canRestore} onClick={() => setConfirmOpen(true)}>
              <RotateCcw size={14} /> Restore
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-3 rounded-lg border border-warn/25 bg-warn/8 p-3 text-[12.5px] leading-5 text-fg">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
          <div>
            Restore is a <b>write</b>, like Password rotate. It creates {info.objects} and inserts records into the target you pick. Point it at a new database (for
            example <code className="font-mono">{rec.database}_restore</code>) and compare before switching anything over.
          </div>
        </div>

        {!targets.length ? (
          <p className="text-[13px] text-muted">Add a {info.label} connection first to restore this backup.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Target connection">
              <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                {targets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.environment || 'production'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Target database" hint={engine === 'sqlite' ? 'SQLite restores into the connection file.' : 'Created on first write if it does not exist (MongoDB).'}>
              <Input list="restore-dbs" value={database} onChange={(e) => setDatabase(e.target.value)} disabled={engine === 'sqlite'} className="font-mono text-[12.5px]" />
              <datalist id="restore-dbs">
                {dbs.map((d) => (
                  <option key={d.name} value={d.name} />
                ))}
              </datalist>
            </Field>
          </div>
        )}

        {needsPass ? (
          <Field label="Passphrase" hint="Needed to read this encrypted file. Not stored.">
            <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </Field>
        ) : null}

        <div>
          <div className="mb-2 flex items-center justify-between text-[12px] font-medium text-muted">
            <span>
              {picked.length} of {(rec.collections || []).length} {info.objects}
            </span>
            <button type="button" className="text-primary hover:underline" onClick={() => setPicked(picked.length ? [] : (rec.collections || []).map((c) => c.name))}>
              {picked.length ? 'Clear' : 'Select all'}
            </button>
          </div>
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            {(rec.collections || []).map((c) => {
              const item = preview?.items?.find((i) => i.name === c.name);
              const checked = picked.includes(c.name);
              return (
                <label key={c.name} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-[13px] last:border-0 hover:bg-surface-2/60">
                  <input
                    type="checkbox"
                    className="accent-[var(--primary)]"
                    checked={checked}
                    onChange={() => {
                      setPreview(null);
                      setPicked((p) => (checked ? p.filter((x) => x !== c.name) : [...p, c.name]));
                    }}
                  />
                  <span className="truncate">{shortName(c.name, engine)}</span>
                  <span className="num ml-auto text-[12px] text-subtle">{compact(c.count)}</span>
                  {item ? (
                    <Badge tone={item.blocked ? 'fail' : item.targetExists ? 'warn' : 'ok'}>
                      {item.blocked ? `target has ${compact(item.targetRows)}` : item.action}
                    </Badge>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>

        {preview ? (
          <div className={`rounded-lg border p-3 text-[13px] ${preview.canRestore ? 'border-ok/25 bg-ok/8' : 'border-danger/25 bg-danger/8'}`}>
            {preview.canRestore
              ? `Ready: ${preview.items.length} ${info.objects}, ${preview.totalRecords.toLocaleString()} records into ${preview.target.connectionName} / ${preview.target.database}.`
              : 'Some targets already contain data. Pick a different database or untick those items.'}
          </div>
        ) : null}

        {result ? (
          <div className="rounded-lg border border-ok/25 bg-ok/8 p-3 text-[13px]">
            <div className="flex items-center gap-2 font-medium text-ok">
              <CircleCheck size={15} /> Restored {result.inserted.toLocaleString()} records in {duration(result.durationMs)}
            </div>
            <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
              {result.results.map((r) => (
                <li key={r.name}>
                  {shortName(r.name, engine)} · {r.inserted.toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <Confirm
        open={confirmOpen}
        danger
        title={`Write into ${database}?`}
        body={`This inserts ${preview?.totalRecords?.toLocaleString() || 0} records into ${preview?.target?.connectionName}. Existing data is never overwritten.`}
        confirmLabel="Restore now"
        typeToConfirm={database}
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async (typed) => {
          setBusy(true);
          try {
            const r = await API.records.restoreExecute(rec.id, { ...body, confirm: typed });
            setResult(r);
            setPreview(null);
            toast.success(`Restored ${r.inserted.toLocaleString()} records`);
            setConfirmOpen(false);
          } catch (err) {
            toast.error(err.message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}
