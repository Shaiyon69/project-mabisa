/**
 * The non-component half of the admin charts: the colours a series may take, the
 * shapes the marks are fed, and the axis maximum they are scaled against. Split
 * out so `Charts.tsx` exports components only, and so `niceMax` tests without a DOM.
 */

/**
 * The BMI rail's bands, so one nutrition status is one colour on the phone and in
 * the portal. A lookup by status, not a list indexed by position, so a filter
 * that leaves two bands does not repaint them.
 */
export const NUTRITION_COLORS: Record<string, string> = {
  underweight: 'var(--bmi-low)',
  normal: 'var(--primary)',
  overweight: 'var(--secondary)',
  obese: 'var(--danger)',
};

/** Fixed order, never cycled: a fourth series belongs in the table instead. */
export const SERIES_COLORS = ['var(--primary)', 'var(--secondary)', 'var(--bmi-low)'];

export type ChartSeries = {
  label: string;
  color: string;
};

/** A row of either bar-shaped chart: one label, one value per series. */
export type ChartRow = {
  label: string;
  values: number[];
  /** Stable key when the label is not unique; the label is used when absent. */
  key?: string;
};

/** The smallest round number at or above the largest value, so the top gridline reads as 20, 250 or 1000. */
export function niceMax(value: number): number {
  if (value <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];

  return magnitude * (steps.find((step) => value <= magnitude * step) ?? 10);
}

/**
 * The gridline positions for an axis topped at `max`, as whole numbers. Four
 * divisions when they come out even, then two, then one, so no scale is labelled
 * at fractions that round to repeats. Divisibility by 1 terminates the fallback.
 */
export function axisTicks(max: number): number[] {
  const divisions = [4, 2, 1].find((count) => Number.isInteger(max / count)) ?? 1;

  return Array.from({ length: divisions + 1 }, (_, index) => (max / divisions) * index);
}
