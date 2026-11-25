import { Handle, Position } from '@xyflow/react';
import { Database, FolderArchive, Monitor, Share2, Timer } from 'lucide-react';

function Shell({ children, accent = '#00ed64', selected }) {
  return (
    <div
      className="min-w-[200px] rounded-2xl border bg-[#102029] px-3.5 py-3 shadow-xl"
      style={{
        borderColor: selected ? accent : 'rgba(148,178,188,0.16)',
        boxShadow: selected ? `0 0 0 3px ${accent}22` : undefined,
      }}
    >
      {children}
    </div>
  );
}

function Title({ icon: Icon, label, color }) {
  return (
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-mist">
      <Icon size={14} style={{ color: color || '#00ed64' }} />
      {label}
    </div>
  );
}

export function DeviceNode({ data, selected }) {
  return (
    <Shell selected={selected}>
      <Title icon={Monitor} label="This device" />
      <div className="mt-1 font-display text-base font-semibold">{data.name}</div>
      <div className="text-xs text-mist">{data.platform}</div>
      <Handle type="source" position={Position.Right} />
    </Shell>
  );
}

export function ConnectionNode({ data, selected }) {
  return (
    <Shell selected={selected} accent={data.color}>
      <Handle type="target" position={Position.Left} />
      <Title icon={Share2} label="Connection" color={data.color} />
      <div className="mt-1 flex items-center gap-2 font-display text-sm font-semibold">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: data.color }} />
        {data.name}
      </div>
      <div className="mt-1 max-w-[220px] truncate font-mono text-[11px] text-mist">{data.uriMasked}</div>
      <Handle type="source" position={Position.Right} />
    </Shell>
  );
}

export function DatabaseNode({ data, selected }) {
  return (
    <Shell selected={selected} accent="#7dd3fc">
      <Handle type="target" position={Position.Left} />
      <Title icon={Database} label="Database" color="#7dd3fc" />
      <div className="mt-1 font-display text-sm font-semibold">{data.name}</div>
      <div className="text-xs text-mist">{data.sizeLabel || 'MongoDB'}</div>
      <Handle type="source" position={Position.Right} />
    </Shell>
  );
}

export function JobNode({ data, selected }) {
  return (
    <Shell selected={selected} accent={data.enabled ? '#00ed64' : '#8aa3ad'}>
      <Handle type="target" position={Position.Left} />
      <Title icon={Timer} label="Backup job" />
      <div className="mt-1 font-display text-sm font-semibold">{data.name}</div>
      <div className="text-xs text-mist">{data.intervalLabel}</div>
      <div className="mt-1 text-[11px] text-leaf">{data.enabled ? `Next ${data.nextRunLabel}` : 'Paused'}</div>
      <Handle type="source" position={Position.Right} />
    </Shell>
  );
}

export function ArchiveNode({ data, selected }) {
  return (
    <Shell selected={selected} accent={data.ok ? '#00ed64' : '#ffc010'}>
      <Handle type="target" position={Position.Left} />
      <Title icon={FolderArchive} label="Latest backup" color={data.ok ? '#00ed64' : '#ffc010'} />
      <div className="mt-1 font-display text-sm font-semibold">{data.status}</div>
      <div className="text-xs text-mist">{data.sizeLabel || 'no file yet'}</div>
    </Shell>
  );
}

export const nodeTypes = {
  device: DeviceNode,
  connection: ConnectionNode,
  database: DatabaseNode,
  job: JobNode,
  archive: ArchiveNode,
};
