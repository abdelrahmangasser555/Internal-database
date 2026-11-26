import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Boxes, Plus, ScanSearch, Sparkles, StickyNote, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../api.js';
import { useApp } from '../state/AppState.jsx';
import { SchemaCanvas } from '../components/schema/SchemaCanvas.jsx';
import { Badge, Button, Confirm, Empty, Input, Select, Textarea } from '../components/ui.jsx';
import { EngineLogo } from '../components/EngineLogo.jsx';
import { engineOf } from '../lib/engines.js';
import { schemasPath } from '../lib/paths.js';
import { cn } from '../lib/cn.js';

const ENGINE_IDS = ['any', 'mongodb', 'postgres', 'mysql', 'mariadb', 'sqlite', 'mssql'];

function blankSchema(engine = 'any') {
  const info = engineOf(engine);
  const pk =
    engine === 'mongodb' || engine === 'any'
      ? { name: '_id', type: 'objectId', pk: true, unique: true, required: true }
      : { name: 'id', type: 'uuid', pk: true, unique: true, required: true };
  return {
    format: 'backup-service-schema-v1',
    name: 'Untitled schema',
    engine,
    description: '',
    objects: [],
    relations: [],
    notes: [],
    findings: [],
    messages: [],
    analysisSummary: '',
    kindHint: info.object,
    defaultPk: pk,
  };
}

export function SchemasPage() {
  const { schemaId } = useParams();
  const navigate = useNavigate();
  const { meta } = useApp();
  const canvasRef = useRef(null);
  const [list, setList] = useState([]);
  const [row, setRow] = useState(null);
  const [schema, setSchema] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState('');
  const [remove, setRemove] = useState(false);
  const saveTimer = useRef(null);
  const dirty = useRef(false);
  const aiOn = meta?.ai?.enabled;
  const lastTalk = (schema?.messages || []).at(-1);

  const loadList = async () => {
    const rows = await API.schemas.list();
    setList(rows);
    return rows;
  };

  const open = async (id) => {
    const full = await API.schemas.get(id);
    setRow(full);
    setSchema(full.schema);
    dirty.current = false;
    navigate(schemasPath(full.id), { replace: true });
  };

  useEffect(() => {
    loadList()
      .then((rows) => {
        if (schemaId) return open(schemaId);
        if (rows[0]) return open(rows[0].id);
        return null;
      })
      .catch((err) => toast.error(err.message));
  }, []);

  useEffect(() => {
    if (schemaId && row?.id !== schemaId) {
      open(schemaId).catch((err) => toast.error(err.message));
    }
  }, [schemaId]);

  const persist = (next, id = row?.id) => {
    if (!id || !next) return;
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const saved = await API.schemas.save({ id, name: next.name, engine: next.engine, description: next.description, schema: next });
        setRow(saved);
        dirty.current = false;
        loadList().catch(() => {});
      } catch (err) {
        toast.error(err.message);
      }
    }, 500);
  };

  const update = (next) => {
    setSchema(next);
    persist(next);
  };

  const create = async (engine = 'any') => {
    setBusy('create');
    try {
      const schema0 = blankSchema(engine);
      const saved = await API.schemas.save({ name: schema0.name, engine, schema: schema0 });
      await loadList();
      await open(saved.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const flush = async () => {
    if (!row || !schema) return row;
    clearTimeout(saveTimer.current);
    const saved = await API.schemas.save({ id: row.id, name: schema.name, engine: schema.engine, description: schema.description, schema });
    setRow(saved);
    dirty.current = false;
    return saved;
  };

  const talk = async () => {
    const text = prompt.trim();
    if (!text || !row) return;
    setBusy('talk');
    try {
      await flush();
      const saved = await API.schemas.talk(row.id, { prompt: text, engine: schema.engine });
      setRow(saved);
      setSchema(saved.schema);
      setPrompt('');
      toast.success('Canvas updated');
      loadList().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const analyze = async () => {
    if (!row) return;
    setBusy('analyze');
    try {
      await flush();
      const saved = await API.schemas.analyze(row.id);
      setRow(saved);
      setSchema(saved.schema);
      const n = saved.findings?.length || 0;
      toast.success(n ? `${n} finding${n === 1 ? '' : 's'} painted on the canvas` : 'No issues found');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const noun = schema ? engineOf(schema.engine).object : 'collection';

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-line bg-bg-2 md:flex">
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-subtle">Drafts</span>
          <Button size="icon" variant="ghost" onClick={() => create()} title="New schema" disabled={busy === 'create'}>
            <Plus size={14} />
          </Button>
        </div>
        <nav className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          {list.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => open(item.id)}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12.5px]',
                item.id === row?.id ? 'bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--line)]' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
              )}
            >
              <EngineLogo engine={item.engine} size={14} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="block text-[10.5px] text-subtle">
                  {item.stats?.objects || 0} · {engineOf(item.engine).label}
                </span>
              </span>
              {item.stats?.errors ? <Badge tone="danger">{item.stats.errors}</Badge> : item.stats?.warns ? <Badge tone="warn">{item.stats.warns}</Badge> : null}
            </button>
          ))}
          {!list.length ? <p className="px-2 py-3 text-[12px] text-subtle">Independent of connections. Draft here, then analyze.</p> : null}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!schema || !row ? (
          <Empty
            icon={Boxes}
            title="Schema builder"
            body="Click + to add a collection, pick field types from the dropdown, nest subfields on object/array/json, and toggle MongoDB strict:false for flexible shapes. Drag field dots to connect relations."
            action={
              <Button variant="primary" onClick={() => create()} loading={busy === 'create'}>
                <Plus size={14} /> New schema
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <Input
                value={schema.name}
                onChange={(e) => update({ ...schema, name: e.target.value })}
                className="h-8 w-[min(100%,14rem)] text-[13px] font-medium"
              />
              <Select value={schema.engine} onChange={(e) => update({ ...schema, engine: e.target.value })} className="h-8 w-[9.5rem] text-[12px]">
                {ENGINE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {engineOf(id).label}
                  </option>
                ))}
              </Select>
              <Button size="sm" onClick={() => canvasRef.current?.addObject()}>
                <Plus size={13} /> {noun}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => canvasRef.current?.addNote()}>
                <StickyNote size={13} /> Note
              </Button>
              <Button size="sm" onClick={analyze} loading={busy === 'analyze'} title="Flags issues on the canvas. Does not touch a database.">
                <ScanSearch size={13} /> Analyze
              </Button>
              <Button size="sm" variant="danger" className="ml-auto" onClick={() => setRemove(true)}>
                <Trash2 size={13} />
              </Button>
            </div>
            {schema.analysisSummary ? (
              <p className="shrink-0 border-b border-line bg-surface-2/60 px-3 py-1.5 text-[12px] text-muted">{schema.analysisSummary}</p>
            ) : null}
            <div className="min-h-0 flex-1">
              <SchemaCanvas ref={canvasRef} schema={schema} engine={schema.engine} editable onChange={update} />
            </div>
            <div className="shrink-0 border-t border-line bg-bg-2 px-3 py-2">
              {lastTalk?.text ? (
                <p className="mb-1.5 line-clamp-2 text-[11.5px] leading-4 text-muted">
                  <span className="font-medium text-fg">{lastTalk.role === 'assistant' ? 'Assistant' : 'You'} · </span>
                  {lastTalk.text}
                </p>
              ) : null}
              <div className="flex items-end gap-2">
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    aiOn
                      ? 'Describe the model, or how to change this canvas'
                      : 'Add an OpenRouter key in Settings to talk to the assistant. You can still build by hand.'
                  }
                  rows={2}
                  className="min-h-[2.75rem] flex-1 resize-none py-2 text-[12.5px]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      talk();
                    }
                  }}
                />
                <Button variant="primary" onClick={talk} loading={busy === 'talk'} disabled={!prompt.trim() || !aiOn}>
                  <Sparkles size={14} /> {schema.objects.length ? 'Revise' : 'Draft'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Confirm
        open={remove}
        danger
        title="Delete this draft?"
        body="This only removes the brainstorming document on this device. No database is touched."
        confirmLabel="Delete draft"
        onClose={() => setRemove(false)}
        onConfirm={async () => {
          if (!row) return;
          await API.schemas.remove(row.id);
          setRemove(false);
          const rows = await loadList();
          if (rows[0]) await open(rows[0].id);
          else {
            setRow(null);
            setSchema(null);
            navigate('/schemas', { replace: true });
          }
        }}
      />
    </div>
  );
}
