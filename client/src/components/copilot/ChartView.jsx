import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import Plotly from 'plotly.js-cartesian-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';
import { humanize, formatValue, isMoney, isPct } from '../../lib/format.jsx';

const Plot = createPlotlyComponent(Plotly);

// Categorical palette (dark-surface steps), assigned in fixed order — never cycled.
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const SURFACE = '#10131c';
const MAX_SERIES = 8;

const numberFormat = (col) => (isPct(col) ? ',.1f' : isMoney(col) ? '$,.2f' : ',.4~f');
const valueSuffix = (col) => (isPct(col) ? '%' : '');
const tickFormat = (col) => (isMoney(col) ? '$~s' : isPct(col) ? '' : '~s');

function baseLayout(spec, { showLegend, horizontal = false }) {
  const axis = {
    gridcolor: 'rgba(148,163,214,0.08)',
    zeroline: false,
    linecolor: 'rgba(148,163,214,0.18)',
    tickfont: { color: '#7c859b', size: 11.5 },
    title: { font: { color: '#8a93aa', size: 12 }, standoff: 12 },
    automargin: true,
    showspikes: false,
  };
  return {
    paper_bgcolor: SURFACE,
    plot_bgcolor: SURFACE,
    font: { family: 'Inter, system-ui, sans-serif', color: '#b4bbcc', size: 12 },
    margin: { l: 12, r: 16, t: showLegend ? 40 : 12, b: 12 },
    xaxis: { ...axis, showgrid: horizontal },
    yaxis: { ...axis, showgrid: !horizontal },
    hoverlabel: {
      bgcolor: '#1b2030',
      bordercolor: 'rgba(148,163,214,0.35)',
      font: { family: 'Inter, system-ui, sans-serif', color: '#eef1f8', size: 12.5 },
      align: 'left',
    },
    showlegend: showLegend,
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { color: '#b4bbcc', size: 12 }, bgcolor: 'rgba(0,0,0,0)' },
    barcornerradius: 4,
    bargap: 0.32,
    bargroupgap: 0.08,
    dragmode: false,
    title: undefined,
  };
}

// Keep the first N-1 groups by total, fold the rest into "Other" so hues never repeat.
function groupSeries(rows, cols, colorCol, x, y) {
  const ci = cols.indexOf(colorCol);
  const xi = cols.indexOf(x);
  const yi = cols.indexOf(y);
  const totals = new Map();
  rows.forEach((r) => totals.set(String(r[ci]), (totals.get(String(r[ci])) || 0) + (Number(r[yi]) || 0)));
  const ranked = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
  const keep = new Set(ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked);
  // Legend order follows first appearance so colours stay stable across chart types
  const order = [];
  const groups = new Map();
  rows.forEach((r) => {
    const key = keep.has(String(r[ci])) ? String(r[ci]) : 'Other';
    if (!groups.has(key)) { groups.set(key, new Map()); order.push(key); }
    const g = groups.get(key);
    const xv = r[xi];
    g.set(xv, (g.get(xv) || 0) + (Number(r[yi]) || 0));
  });
  if (order.includes('Other')) order.push(order.splice(order.indexOf('Other'), 1)[0]);
  return order.map((name) => ({ name, x: [...groups.get(name).keys()], y: [...groups.get(name).values()] }));
}

function buildFigure(result, type) {
  const { columns: cols, rows, chart: spec } = result;
  const col = (name) => rows.map((r) => r[cols.indexOf(name)]);
  const x = spec.x;
  const ys = spec.y?.length ? spec.y : [];
  const color = spec.color;

  if (type === 'pie') {
    const y = ys[0];
    let labels = col(x).map(String);
    let values = col(y).map(Number);
    if (labels.length > MAX_SERIES) {
      const pairs = labels.map((l, i) => [l, values[i]]).sort((a, b) => b[1] - a[1]);
      const head = pairs.slice(0, MAX_SERIES - 1);
      const other = pairs.slice(MAX_SERIES - 1).reduce((s, p) => s + p[1], 0);
      labels = [...head.map((p) => p[0]), 'Other'];
      values = [...head.map((p) => p[1]), other];
    }
    const total = values.reduce((a, b) => a + b, 0);
    return {
      data: [{
        type: 'pie', labels, values, hole: 0.62, sort: false, direction: 'clockwise',
        marker: { colors: SERIES, line: { color: SURFACE, width: 2 } },
        textinfo: 'percent', textposition: 'inside', insidetextfont: { color: '#fff', size: 12 },
        hovertemplate: `%{label}<br><b>%{value:${numberFormat(y)}}${valueSuffix(y)}</b> · %{percent}<extra></extra>`,
      }],
      layout: {
        ...baseLayout(spec, { showLegend: true }),
        legend: { orientation: 'v', x: 1.02, y: 0.5, yanchor: 'middle', font: { color: '#b4bbcc', size: 12.5 } },
        margin: { l: 12, r: 12, t: 12, b: 12 },
        annotations: [{
          text: `<b style="font-size:20px">${formatValue(total, y)}</b><br><span style="color:#7c859b">${humanize(y)}</span>`,
          showarrow: false, font: { color: '#eef1f8', size: 12 }, x: 0.5, y: 0.5, xref: 'paper', yref: 'paper',
        }],
      },
    };
  }

  if (type === 'histogram') {
    const target = x || ys[0];
    return {
      data: [{
        type: 'histogram', x: col(target), marker: { color: SERIES[0], line: { color: SURFACE, width: 1 } },
        hovertemplate: `${humanize(target)} %{x}<br><b>%{y:,} rows</b><extra></extra>`,
      }],
      layout: {
        ...baseLayout(spec, { showLegend: false }), bargap: 0.06,
        xaxis: { ...baseLayout(spec, {}).xaxis, title: { text: humanize(target) } },
        yaxis: { ...baseLayout(spec, {}).yaxis, title: { text: 'Rows' } },
      },
    };
  }

  if (type === 'scatter') {
    const y = ys[0];
    let series;
    if (color) {
      const groups = new Map();
      rows.forEach((r) => {
        const key = String(r[cols.indexOf(color)]);
        if (!groups.has(key)) groups.set(key, { x: [], y: [] });
        groups.get(key).x.push(r[cols.indexOf(x)]);
        groups.get(key).y.push(r[cols.indexOf(y)]);
      });
      series = [...groups.entries()].slice(0, 3).map(([name, g]) => ({ name, ...g }));
    } else {
      series = [{ name: humanize(y), x: col(x), y: col(y) }];
    }
    return {
      data: series.map((s, i) => ({
        type: 'scatter', mode: 'markers', name: s.name, x: s.x, y: s.y,
        marker: { color: SERIES[i], size: 8, opacity: 0.75, line: { color: SURFACE, width: 1 } },
        hovertemplate: `${humanize(x)}: %{x:${numberFormat(x)}}<br>${humanize(y)}: <b>%{y:${numberFormat(y)}}${valueSuffix(y)}</b><extra>${series.length > 1 ? s.name : ''}</extra>`,
      })),
      layout: {
        ...baseLayout(spec, { showLegend: series.length > 1 }),
        xaxis: { ...baseLayout(spec, {}).xaxis, showgrid: true, title: { text: humanize(x) }, tickformat: tickFormat(x) },
        yaxis: { ...baseLayout(spec, {}).yaxis, title: { text: humanize(y) }, tickformat: tickFormat(y) },
      },
    };
  }

  // bar / line / area
  const isLine = type === 'line' || type === 'area';
  let series;
  if (color && ys.length) {
    series = groupSeries(rows, cols, color, x, ys[0]).map((s) => ({ ...s, measure: ys[0] }));
  } else {
    series = ys.slice(0, MAX_SERIES).map((y) => ({ name: humanize(y), x: col(x).map((v) => (v === null ? '(blank)' : v)), y: col(y), measure: y }));
  }
  const xs = series[0]?.x || [];
  const avgLabel = xs.reduce((s, v) => s + String(v).length, 0) / Math.max(xs.length, 1);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const horizontal = type === 'bar' && !isLine && (xs.length > 14 || (xs.length > 6 && avgLabel > 12) || (narrow && xs.length > 3 && avgLabel > 5));
  const measure = series[0]?.measure;
  const multi = series.length > 1;
  const stacked = type === 'area' && multi;
  const xIsText = xs.some((v) => typeof v === 'string' && !/^\d{4}(-\d{2}){0,2}$/.test(v));

  const data = series.map((s, i) => {
    const valueHover = `%{${horizontal ? 'x' : 'y'}:${numberFormat(s.measure)}}${valueSuffix(s.measure)}`;
    const labelHover = `%{${horizontal ? 'y' : 'x'}}`;
    const common = {
      name: s.name,
      hovertemplate: isLine
        ? `${multi ? `${s.name}: ` : ''}<b>${valueHover}</b><extra></extra>`
        : `${labelHover}<br>${multi ? `${s.name}: ` : ''}<b>${valueHover}</b><extra></extra>`,
    };
    if (isLine) {
      return {
        ...common, type: 'scatter', x: s.x, y: s.y,
        mode: s.x.length <= 40 ? 'lines+markers' : 'lines',
        line: { color: SERIES[i], width: 2, shape: 'linear' },
        marker: { color: SERIES[i], size: 8, line: { color: SURFACE, width: 2 } },
        ...(type === 'area'
          ? (stacked ? { stackgroup: 'one', fillcolor: `${SERIES[i]}55` } : { fill: 'tozeroy', fillcolor: `${SERIES[i]}26` })
          : {}),
      };
    }
    return {
      ...common, type: 'bar',
      x: horizontal ? s.y : s.x, y: horizontal ? s.x : s.y, orientation: horizontal ? 'h' : 'v',
      marker: { color: SERIES[i], line: { color: SURFACE, width: multi ? 1 : 0 } },
    };
  });

  const base = baseLayout(spec, { showLegend: multi, horizontal });
  const valueAxis = { tickformat: tickFormat(measure), ticksuffix: isPct(measure) ? '%' : '', title: { text: multi && color ? humanize(measure) : '' } };
  const catAxis = { type: xIsText || !isLine ? 'category' : undefined, title: { text: humanize(x) } };
  return {
    data,
    layout: {
      ...base,
      hovermode: isLine ? 'x unified' : 'closest',
      barmode: multi ? 'group' : undefined,
      xaxis: { ...base.xaxis, ...(horizontal ? valueAxis : catAxis) },
      yaxis: { ...base.yaxis, ...(horizontal ? { ...catAxis, autorange: 'reversed', title: { text: '' } } : valueAxis) },
    },
  };
}

export function availableTypes(result) {
  const spec = result.chart;
  if (!result.rows.length) return ['table'];
  if (spec.type === 'kpi') return ['kpi', 'table'];
  if (spec.type === 'histogram') return ['histogram', 'table'];
  if (spec.type === 'scatter') return ['scatter', 'table'];
  if (!spec.x || !spec.y?.length) return ['table'];
  const types = ['bar', 'line', 'area'];
  if (!spec.color && spec.y.length === 1 && result.rows.length <= 12 && result.rows.every((r) => Number(r[result.columns.indexOf(spec.y[0])]) >= 0)) types.push('pie');
  types.push('table');
  if (spec.type === 'pie' && !types.includes('pie')) types.unshift('pie');
  return types;
}

function Kpi({ result }) {
  const y = result.chart.y?.[0] || result.columns.find((c, i) => typeof result.rows[0]?.[i] === 'number');
  const v = result.rows[0]?.[result.columns.indexOf(y)];
  const others = result.columns.filter((c) => c !== y);
  return (
    <div className="kpi">
      <span className="kpi-label">{humanize(y)}</span>
      <span className="kpi-value">{formatValue(v, y)}</span>
      {typeof v === 'number' && Math.abs(v) >= 1e4 && <span className="kpi-exact">{v.toLocaleString()}</span>}
      {others.length > 0 && (
        <span className="kpi-context">
          {others.map((c) => `${humanize(c)}: ${formatValue(result.rows[0][result.columns.indexOf(c)], c)}`).join(' · ')}
        </span>
      )}
    </div>
  );
}

const ChartView = forwardRef(function ChartView({ result, type }, ref) {
  const graph = useRef(null);
  const figure = useMemo(() => (['kpi', 'table'].includes(type) ? null : buildFigure(result, type)), [result, type]);

  useImperativeHandle(ref, () => ({
    downloadPng: (filename) => graph.current && Plotly.downloadImage(graph.current, { format: 'png', filename, width: 1400, height: 700, scale: 2 }),
  }), []);

  if (type === 'kpi') return <Kpi result={result} />;
  if (!figure) return null;
  const tall = figure.data[0]?.orientation === 'h' ? Math.min(760, 120 + (figure.data[0].y?.length || 0) * 26) : 380;
  return (
    <div className="chart-wrap">
      <Plot
        data={figure.data}
        layout={{ ...figure.layout, height: tall, autosize: true }}
        config={{ displayModeBar: false, responsive: true, scrollZoom: false }}
        useResizeHandler
        style={{ width: '100%', height: tall }}
        onInitialized={(_, div) => { graph.current = div; }}
        onUpdate={(_, div) => { graph.current = div; }}
      />
    </div>
  );
});

export default ChartView;
