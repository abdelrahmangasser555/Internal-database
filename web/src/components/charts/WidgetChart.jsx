import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { metric } from '../../lib/format.js';
import { EvilWidgetChart } from './EvilWidgetChart.jsx';
import { SERIES_PALETTES } from './evilPalettes.js';

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

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

function EChartScatter({ data, xKey, yKey, format }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const inst = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    inst.setOption({
      grid: { left: 8, right: 12, top: 16, bottom: 24, containLabel: true },
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(36,36,36,0.92)',
        borderColor: '#6e6e6e',
        textStyle: { color: '#f4f4f4', fontSize: 12 },
      },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } } },
      series: [
        {
          type: 'scatter',
          data: data.map((r) => [toNumber(r[xKey]), toNumber(r[yKey])]),
          symbolSize: 10,
          itemStyle: {
            color: new echarts.graphic.RadialGradient(0.4, 0.3, 1, [
              { offset: 0, color: SERIES_PALETTES[0].dark[0] },
              { offset: 1, color: SERIES_PALETTES[0].dark[2] || SERIES_PALETTES[0].dark[0] },
            ]),
            shadowBlur: 12,
            shadowColor: 'rgba(168, 85, 247, 0.45)',
          },
        },
      ],
      animationDuration: 600,
    });
    const onResize = () => inst.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      inst.dispose();
    };
  }, [data, xKey, yKey, format]);
  return <div ref={ref} className="evilm-charts-scope dark h-56 w-full" />;
}

export function WidgetChart({ widget }) {
  const rows = widget.rows || [];
  const xKey = widget.xKey || Object.keys(rows[0] || {})[0];
  const yKey = widget.yKey || Object.keys(rows[0] || {}).find((k) => k !== xKey);
  const series = seriesOf({ ...widget, xKey, yKey });
  if (!rows.length || !xKey) {
    return <p className="px-3 py-8 text-center text-[12px] text-subtle">No rows for this widget.</p>;
  }
  const data = chartRows({ ...widget, xKey, yKey, seriesKeys: series.slice(1) });
  const format = widget.format || 'compact';
  const height = widget.type === 'funnel' ? Math.max(180, data.length * 28) : 220;

  if (widget.type === 'scatter') {
    return <EChartScatter data={data} xKey={xKey} yKey={yKey} format={format} />;
  }

  if (widget.type === 'funnel') {
    const max = Math.max(1, ...data.map((r) => toNumber(r[yKey])));
    return (
      <div className="space-y-2 py-1" style={{ minHeight: height }}>
        {data.map((row, i) => {
          const v = toNumber(row[yKey]);
          const pal = SERIES_PALETTES[i % SERIES_PALETTES.length].dark;
          const bg = `linear-gradient(90deg, ${pal[0]}, ${pal[Math.min(2, pal.length - 1)]})`;
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="w-36 shrink-0 truncate text-[12px] text-muted" title={String(row[xKey])}>
                {row[xKey]}
              </span>
              <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-surface-2/80 ring-1 ring-line/60">
                <div
                  className="flex h-full items-center px-2 text-[11px] font-semibold text-white shadow-sm"
                  style={{ width: `${Math.max(8, (v / max) * 100)}%`, background: bg }}
                >
                  {metric(v, format)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (['bar', 'line', 'area', 'pie', 'stacked'].includes(widget.type)) {
    return <EvilWidgetChart widget={{ ...widget, xKey, yKey, seriesKeys: series.slice(1), format }} />;
  }

  return <p className="px-3 py-8 text-center text-[12px] text-subtle">Unsupported chart type.</p>;
}