import { useEffect, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../../api.js';
import { graphToSchema } from '../../lib/schema.js';
import { Button } from '../ui.jsx';
import { SchemaCanvas } from '../schema/SchemaCanvas.jsx';

export function ErDiagram({ connectionId, db, engine, focus, onOpen, className }) {
  const [schema, setSchema] = useState(null);
  const [error, setError] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState('');

  useEffect(() => {
    let alive = true;
    setSchema(null);
    setError(null);
    setSummary('');
    API.connections
      .graph(connectionId, db)
      .then((g) => alive && setSchema(graphToSchema(g, engine)))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [connectionId, db, engine]);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const result = await API.connections.analyze(connectionId, db);
      setSchema(result.schema);
      setSummary(result.summary || '');
      const n = result.findings?.length || 0;
      toast.success(n ? `${n} finding${n === 1 ? '' : 's'} on the diagram` : 'No issues found');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const saveDraft = async () => {
    if (!schema) return;
    try {
      const saved = await API.schemas.save({
        name: schema.name || `${db} schema`,
        engine,
        description: schema.description,
        schema: { ...schema, findings: schema.findings || [], analysisSummary: summary },
      });
      toast.success(`Saved draft “${saved.name}”`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <SchemaCanvas
      schema={schema}
      engine={engine}
      focus={focus}
      onOpen={onOpen}
      className={className}
      error={error}
      emptyTitle="Nothing to draw"
      emptyBody="This database has no tables or collections yet."
      toolbar={
        <>
          <Button size="xs" onClick={analyze} loading={analyzing} title="Read-only: schema, indexes, row counts and samples">
            <ScanSearch size={12} /> Analyze
          </Button>
          {schema?.findings?.length ? (
            <Button size="xs" variant="ghost" onClick={saveDraft}>
              Save draft
            </Button>
          ) : null}
        </>
      }
    />
  );
}
