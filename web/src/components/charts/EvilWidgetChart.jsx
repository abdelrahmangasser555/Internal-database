import { EChartsAreaChart } from '@/components/evilcharts/charts/echarts-area-chart';
import { EChartsBarChart } from '@/components/evilcharts/charts/echarts-bar-chart';
import { EChartsLineChart } from '@/components/evilcharts/charts/echarts-line-chart';
import { EChartsPieChart } from '@/components/evilcharts/charts/echarts-pie-chart';
import { metric } from '../../lib/format.js';
import { SERIES_PALETTES } from './evilPalettes.js';

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function labelOf(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return text.length > 28 ? `${text.slice(0, 26)}…` : text;
}

function seriesOf(widget) {
  const y = widget.yKey;
  const extras = (widget.seriesKeys || []).filter((k) => k && k !== y && k !== widget.xKey);
  return [y, ...extras].filter(Boolean);
}

function chartRows(widget) {
  const xKey = widget.xKey;
  const keys = seriesOf(widget);
  return (widget.rows || []).map((row) => {
    const next = { ...row, [xKey]: labelOf(row[xKey]) };
    for (const k of keys) next[k] = toNumber(row[k]);
    return next;
  });
}

function buildConfig(keys, rows, xKey, type) {
  const config = {};
  if (type === 'pie') {
    rows.forEach((row, i) => {
      const name = String(row[xKey] ?? `Slice ${i + 1}`);
      config[name] = {
        label: name,
        colors: SERIES_PALETTES[i % SERIES_PALETTES.length],
      };
    });
    return config;
  }
  keys.forEach((key, i) => {
    config[key] = {
      label: key,
      colors: SERIES_PALETTES[i % SERIES_PALETTES.length],
    };
  });
  return config;
}

function shortTick(value) {
  const text = String(value);
  return text.length > 8 ? `${text.slice(0, 7)}…` : text;
}

const CHART_FRAME = 'evilm-charts-scope dark h-64 w-full min-h-[220px] rounded-lg';

export function EvilWidgetChart({ widget }) {
  const rows = widget.rows || [];
  const xKey = widget.xKey || Object.keys(rows[0] || {})[0];
  const yKey = widget.yKey || Object.keys(rows[0] || {}).find((k) => k !== xKey);
  const series = seriesOf({ ...widget, xKey, yKey });
  if (!rows.length || !xKey) {
    return <p className="px-3 py-8 text-center text-[12px] text-subtle">No rows for this widget.</p>;
  }
  const data = chartRows({ ...widget, xKey, yKey, seriesKeys: series.slice(1) });
  const config = buildConfig(series, data, xKey, widget.type);

  if (widget.type === 'pie') {
    return (
      <motionSafe className={CHART_FRAME}>
        <EChartsPieChart data={data} config={config} dataKey={yKey} nameKey={xKey} className="h-full w-full">
          <EChartsPieChart.Background variant="dots" />
          <EChartsPieChart.Pie variant="gradient" innerRadius="42%" outerRadius="78%" paddingAngle={2} isClickable>
            <EChartsPieChart.Label position="outside" />
          </EChartsPieChart.Pie>
          <EChartsPieChart.Legend isClickable />
          <EChartsPieChart.Tooltip />
        </EChartsPieChart>
      </motionSafe>
    );
  }

  if (widget.type === 'line') {
    return (
      <motionSafe className={CHART_FRAME}>
        <EChartsLineChart data={data} config={config} className="h-full w-full" xDataKey={xKey}>
          <EChartsLineChart.Grid />
          <EChartsLineChart.XAxis dataKey={xKey} tickFormatter={shortTick} />
          <EChartsLineChart.YAxis tickFormatter={(v) => metric(v, widget.format)} />
          {series.length > 1 ? <EChartsLineChart.Legend isClickable /> : null}
          <EChartsLineChart.Tooltip />
          {series.map((key) => (
            <EChartsLineChart.Line key={key} dataKey={key} glowing strokeWidth={2.5} isClickable />
          ))}
        </EChartsLineChart>
      </motionSafe>
    );
  }

  if (widget.type === 'area') {
    return (
      <motionSafe className={CHART_FRAME}>
        <EChartsAreaChart
          data={data}
          config={config}
          className="h-full w-full"
          xDataKey={xKey}
          stackType="default"
        >
          <EChartsAreaChart.Grid />
          <EChartsAreaChart.XAxis dataKey={xKey} tickFormatter={shortTick} />
          <EChartsAreaChart.YAxis tickFormatter={(v) => metric(v, widget.format)} />
          {series.length > 1 ? <EChartsAreaChart.Legend isClickable /> : null}
          <EChartsAreaChart.Tooltip />
          {series.map((key) => (
            <EChartsAreaChart.Area key={key} dataKey={key} variant="gradient" isClickable />
          ))}
        </EChartsAreaChart>
      </motionSafe>
    );
  }

  const stacked = widget.type === 'stacked';
  return (
    <motionSafe className={CHART_FRAME}>
      <EChartsBarChart
        data={data}
        config={config}
        className="h-full w-full"
        xDataKey={xKey}
        stackType={stacked ? 'stacked' : 'default'}
      >
        <EChartsBarChart.Grid />
        <EChartsBarChart.XAxis dataKey={xKey} tickFormatter={shortTick} />
        <EChartsBarChart.YAxis tickFormatter={(v) => metric(v, widget.format)} />
        {series.length > 1 ? <EChartsBarChart.Legend isClickable /> : null}
        <EChartsBarChart.Tooltip />
        {series.map((key, i) => (
          <EChartsBarChart.Bar
            key={key}
            dataKey={key}
            variant={i % 2 === 0 ? 'gradient' : 'duotone'}
            glowing
            isClickable
          />
        ))}
      </EChartsBarChart>
    </motionSafe>
  );
}

/** Wrapper picks `.dark` so Evil Charts theme colors resolve on our dashboard. */
function motionSafe({ className, children }) {
  return <div className={className}>{children}</div>;
}