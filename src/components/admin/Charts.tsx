import type { CSSProperties, ReactNode } from 'react';
import { axisTicks, niceMax, type ChartRow, type ChartSeries } from '../../lib/charts';
import { titleCase } from '../../lib/utils';
import type { Tally } from '../../services/adminData';

/**
 * The chart primitives the admin portal draws with: a donut for a distribution, a
 * line chart for a series over months, and grouped horizontal bars for a
 * comparison across barangays or items. Inline SVG, no charting library.
 *
 * Colour follows the entity, never its rank, so a category keeps its colour when
 * a filter removes its neighbours. The palette is muted, so every chart carries a
 * second encoding: values written beside their marks, and a legend on any chart
 * with more than one series. Colours and shapes live in `lib/charts.ts`.
 */

function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <ul className="chart-legend">
      {series.map((entry) => (
        <li key={entry.label}>
          <span className="chart-swatch" style={{ background: entry.color }} aria-hidden="true" />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A distribution as a ring, with the total in the middle. Segments are separated
 * by a gap in the surface colour, so adjacent bands are told apart by an edge as
 * well as by hue. `children` is where the caller puts the written breakdown.
 */
export function DonutChart({
  rows,
  colorFor,
  unit,
  children,
}: {
  rows: Tally[];
  colorFor: (row: Tally) => string;
  /** What the centre total counts, e.g. `assessments`. */
  unit: string;
  children?: ReactNode;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  // Viewbox units: a ~2px separator once the 200-unit box is drawn at card width.
  const gap = 2.6;
  const label = `${total} ${unit}: ${rows.map((row) => `${titleCase(row.label)} ${row.count}`).join(', ')}`;
  const arcs = rows.map((row) => (total ? (row.count / total) * circumference : 0));
  // Where each arc starts: everything before it. ponytail: quadratic, over the
  // four nutrition bands this draws.
  const starts = arcs.map((_, index) => arcs.slice(0, index).reduce((sum, arc) => sum + arc, 0));

  return (
    <div className="donut-chart">
      <svg viewBox="0 0 200 200" role="img" aria-label={label}>
        <circle className="donut-track" cx="100" cy="100" r={radius} />
        {rows.map((row, index) => {
          const dash = Math.max(arcs[index] - gap, 0);
          const rotation = (starts[index] / circumference) * 360 - 90;

          // A band nobody fell into gets no arc: a zero-length stroke still
          // paints its round cap as a dot.
          return row.count ? (
            <circle
              key={row.label}
              className="donut-segment"
              cx="100"
              cy="100"
              r={radius}
              stroke={colorFor(row)}
              strokeDasharray={`${dash} ${circumference - dash}`}
              transform={`rotate(${rotation} 100 100)`}
            >
              <title>{`${titleCase(row.label)}: ${row.count} of ${total} (${Math.round((row.count / total) * 100)}%)`}</title>
            </circle>
          ) : null;
        })}
        <text className="donut-total" x="100" y="98">
          {total}
        </text>
        <text className="donut-unit" x="100" y="120">
          {unit}
        </text>
      </svg>
      {children}
    </div>
  );
}

/**
 * Counts per period, one line per series. Every series counts the same kind of
 * thing, so they share one axis; a rate would need a second, and stays in the
 * table. Empty periods are drawn at zero rather than skipped.
 */
export function LineChart({ rows, series }: { rows: ChartRow[]; series: ChartSeries[] }) {
  const width = 720;
  const height = 240;
  const pad = { top: 14, right: 14, bottom: 30, left: 42 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...rows.flatMap((row) => row.values), 0));
  const step = rows.length > 1 ? plotWidth / (rows.length - 1) : 0;
  const x = (index: number) => pad.left + (rows.length > 1 ? index * step : plotWidth / 2);
  const y = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;
  // Every label when they fit, otherwise every nth.
  const labelEvery = Math.ceil(rows.length / 12);
  const label = rows
    .map((row) => `${row.label}: ${series.map((entry, index) => `${entry.label} ${row.values[index]}`).join(', ')}`)
    .join('. ');

  return (
    <figure className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              className="chart-gridline"
              x1={pad.left}
              x2={width - pad.right}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
            />
            <text className="chart-tick" x={pad.left - 8} y={y(max * fraction) + 4} textAnchor="end">
              {Math.round(max * fraction)}
            </text>
          </g>
        ))}
        {series.map((entry, index) => (
          <g key={entry.label}>
            <polyline
              className="chart-line"
              stroke={entry.color}
              points={rows.map((row, position) => `${x(position)},${y(row.values[index])}`).join(' ')}
            />
            {rows.map((row, position) => (
              <circle
                key={row.key ?? row.label}
                className="chart-point"
                fill={entry.color}
                cx={x(position)}
                cy={y(row.values[index])}
                r="4"
              />
            ))}
          </g>
        ))}
        {rows.map((row, position) => (
          <g key={row.key ?? row.label}>
            {position % labelEvery === 0 ? (
              <text className="chart-tick" x={x(position)} y={height - 10} textAnchor="middle">
                {row.label}
              </text>
            ) : null}
            {/* A column-wide target, so reading a month does not require landing
                the pointer on an 8px dot. */}
            <rect
              className="chart-hit"
              x={x(position) - (step || plotWidth) / 2}
              y={pad.top}
              width={step || plotWidth}
              height={plotHeight}
            >
              <title>
                {`${row.label}: ${series
                  .map((entry, index) => `${row.values[index]} ${entry.label.toLowerCase()}`)
                  .join(', ')}`}
              </title>
            </rect>
          </g>
        ))}
      </svg>
      <Legend series={series} />
    </figure>
  );
}

/**
 * Grouped horizontal bars on one shared scale — horizontal because the labels are
 * barangay and item names, and one scale so a bar twice as long is twice as many.
 * Each bar carries its own value.
 *
 * Gridlines sit behind the tracks with their numbers underneath; `axisTicks`
 * picks how many divisions the maximum splits into evenly.
 */
export function BarChart({ rows, series }: { rows: ChartRow[]; series: ChartSeries[] }) {
  const max = niceMax(Math.max(...rows.flatMap((row) => row.values), 0));
  const ticks = axisTicks(max);
  const trackStyle = { '--bar-grid': `${100 / (ticks.length - 1)}%` } as CSSProperties;

  return (
    <figure className="bar-chart">
      <ul>
        {rows.map((row) => (
          <li key={row.key ?? row.label}>
            <span className="bar-chart-label">{row.label}</span>
            <div className="bar-chart-group">
              {series.map((entry, index) => (
                <div className="bar-chart-row" key={entry.label}>
                  <div className="bar-chart-track" style={trackStyle}>
                    <div
                      className="bar-chart-fill"
                      data-zero={row.values[index] ? undefined : ''}
                      style={{ width: `${(row.values[index] / max) * 100}%`, background: entry.color }}
                      role="img"
                      aria-label={`${row.label}, ${entry.label}: ${row.values[index]}`}
                      title={`${row.label} — ${entry.label}: ${row.values[index]}`}
                    />
                  </div>
                  <small>{row.values[index]}</small>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {/* The axis the lengths are read against. Drawn once under the rows rather
          than repeated per bar, and hidden from assistive technology because
          every bar already carries its own value in its label. */}
      <div className="bar-chart-axis" aria-hidden="true">
        {ticks.map((tick, index) => (
          <span key={index}>{tick}</span>
        ))}
      </div>
      {series.length > 1 ? <Legend series={series} /> : null}
    </figure>
  );
}

/**
 * One share as a ring: a part of a whole of the same kind, such as residents
 * assessed out of residents registered. One hue for every row, since this encodes
 * magnitude rather than identity. The raw counts sit under the label, because a
 * share with no denominator is not a finding.
 */
export function GaugeRing({
  value,
  total,
  label,
  caption,
  color = 'var(--primary)',
}: {
  value: number;
  total: number;
  label: string;
  /** The counts behind the share, written under the label. */
  caption: string;
  color?: string;
}) {
  const share = total > 0 ? Math.min(value / total, 1) : 0;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const arc = share * circumference;

  return (
    <figure className="gauge">
      <svg viewBox="0 0 128 128" role="img" aria-label={`${label}: ${caption}`}>
        <circle className="gauge-track" cx="64" cy="64" r={radius} />
        {/* A zero share draws no arc at all: a round cap on an empty stroke
            still paints a dot, which reads as a small non-zero value. */}
        {arc > 0 ? (
          <circle
            className="gauge-arc"
            cx="64"
            cy="64"
            r={radius}
            stroke={color}
            strokeDasharray={`${arc} ${circumference - arc}`}
            transform="rotate(-90 64 64)"
          />
        ) : null}
        <text className="gauge-value" x="64" y="72">
          {Math.round(share * 100)}%
        </text>
      </svg>
      <figcaption>
        <strong>{label}</strong>
        <small>{caption}</small>
      </figcaption>
    </figure>
  );
}
