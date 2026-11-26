import { useEffect, useState } from 'react';
import { ExternalLink, Link2 } from 'lucide-react';
import { API } from '../../api.js';
import { linkValueRaw } from '../../lib/exploreRefs.js';
import { shortName } from '../../lib/engines.js';
import { Badge, Button, Sheet, Spinner } from '../ui.jsx';
import { JsonView } from '../DataGrid.jsx';

export function LinkedRecordSheet({ open, pick, connectionId, db, engine, onClose, onOpenObject }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open || !pick) {
      setResult(null);
      setError(null);
      return;
    }
    const raw = linkValueRaw(pick.value);
    if (raw == null) {
      setError('No value to look up');
      setResult(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    API.connections
      .fetchOne(connectionId, db, pick.targetObject, { field: pick.targetField, value: raw })
      .then((data) => {
        if (!alive) return;
        setResult(data);
        if (!data.found) setError('No matching record in the target collection or table.');
      })
      .catch((err) => {
        if (!alive) return;
        setError(err.message);
        setResult(null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, pick, connectionId, db]);

  const title = pick ? `Linked · ${shortName(pick.targetObject, engine)}` : 'Linked record';
  const subtitle = pick
    ? `${pick.sourceColumn} → ${pick.targetField}${pick.inferred ? ' · inferred link' : ''}`
    : '';

  return (
    <Sheet
      open={open}
      title={title}
      subtitle={subtitle}
      wide
      onClose={onClose}
      footer={
        pick ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onOpenObject?.(pick.targetObject);
              onClose();
            }}
          >
            <ExternalLink size={13} /> Open {shortName(pick.targetObject, engine)}
          </Button>
        ) : null
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted">
          <Spinner size={16} /> Loading linked record…
        </div>
      ) : error ? (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>
      ) : result?.found && result.document ? (
        <JsonView value={result.document} />
      ) : result?.found && result.row ? (
        <div className="overflow-auto rounded-md border border-line">
          <JsonView value={result.row} />
        </div>
      ) : null}
      {pick && !loading ? (
        <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-subtle">
          <Link2 size={12} />
          Read-only lookup on <span className="font-mono text-muted">{pick.targetObject}</span>
          {pick.inferred ? <Badge tone="info">inferred</Badge> : <Badge tone="primary">FK</Badge>}
        </p>
      ) : null}
    </Sheet>
  );
}
