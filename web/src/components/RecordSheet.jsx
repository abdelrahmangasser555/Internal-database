import { toast } from 'sonner';
import { API } from '../api.js';
import { formatWhen } from '../lib/format.js';
import { useApp } from '../state/AppState.jsx';
import { Badge, Button, Sheet } from './ui.jsx';

export function RecordSheet() {
  const { sheet, closeSheet, refresh } = useApp();
  const open = sheet?.type === 'record';
  const rec = open ? sheet.record : null;

  if (!rec) {
    return <Sheet open={false} onClose={closeSheet} title="" />;
  }

  return (
    <Sheet
      open={open}
      title={rec.jobName || 'Backup'}
      subtitle={rec.fileName}
      onClose={closeSheet}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={async () => {
              try {
                const result = await API.records.open(rec.id);
                if (!result.exists) toast.warning(`File is missing. ${result.path || rec.filePath}`);
                else toast.success('Opened in explorer');
              } catch (err) {
                toast.error(err.message);
              }
            }}
          >
            Open in explorer
          </Button>
          {rec.encrypted && rec.exists ? (
            <Button
              onClick={async () => {
                try {
                  await API.records.decryptOpen(rec.id);
                  toast.success('Decrypted and opened');
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Decrypt & open
            </Button>
          ) : null}
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm('Remove this record from this device? The file is not deleted unless it is already gone.')) return;
              await API.records.remove(rec.id);
              toast.success('Record removed');
              await refresh();
              closeSheet();
            }}
          >
            Delete record
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {rec.status === 'success' ? (
            rec.exists ? <Badge tone="ok">file found</Badge> : <Badge tone="warn">missing file</Badge>
          ) : (
            <Badge tone="fail">{rec.status}</Badge>
          )}
          {rec.encrypted ? <Badge>encrypted</Badge> : <Badge tone="sky">plain zip</Badge>}
          <Badge>{rec.reason || 'backup'}</Badge>
        </div>
        <Row k="Database" v={rec.database} />
        <Row k="Collections" v={(rec.collections || []).map((c) => c.name).join(', ') || '—'} />
        <Row k="Documents" v={rec.documentCount ?? '—'} />
        <Row k="Size" v={rec.sizeLabel} />
        <Row k="When" v={formatWhen(rec.finishedAt || rec.startedAt)} />
        <Row k="Device" v={rec.device} />
        <Row k="Location" v={rec.filePath} mono />
        {rec.error ? <p className="rounded-xl bg-danger/10 p-3 text-danger">{rec.error}</p> : null}
      </div>
    </Sheet>
  );
}

function Row({ k, v, mono }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-mist">{k}</div>
      <div className={mono ? 'mt-1 break-all font-mono text-xs text-leaf' : 'mt-1'}>{v || '—'}</div>
    </div>
  );
}
