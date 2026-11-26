import { Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const COLORS = ['var(--primary)', 'var(--info)', 'var(--ok)', 'var(--warn)', 'var(--danger)', '#c084fc', '#f472b6'];

function tipStyle() {
  return {
    background: 'var(--surface)',
    border: '1px solid var(--line-strong)',
    borderRadius: 10,
    fontSize: 12,
    color: 'var(--fg)',
  };
}

export function WidgetChart({ widget }) {
  const rows = widget.rows || [];
  const xKey = widget.xKey || Object.keys(rows[0] || {})[0];
  const yKey = widget.yKey || Object.keys(rows[0] || {}).find((k) => k !== xKey);
  if (!rows.length || !xKey) {
    return <p className="px-3 py-8 text-center text-[12px] text-subtle">No rows for this widget.</p>;
  }
  if (widget.type === 'pie') {
    return (
      <div className="h-52">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey={yKey} nameKey={xKey} innerRadius={42} outerRadius={72} paddingAngle={2}>
              {rows.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tipStyle()} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }
  if (widget.type === 'line') {
    return (
      <div className="h-52">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey={xKey} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--line)' }} />
            <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} />
            <Tooltip contentStyle={tipStyle()} />
            <Line type="monotone" dataKey={yKey} stroke="var(--primary)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return (
    <div className="h-52">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey={xKey} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--line)' }} />
          <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} />
          <Tooltip contentStyle={tipStyle()} />
          <Bar dataKey={yKey} fill="var(--primary)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
