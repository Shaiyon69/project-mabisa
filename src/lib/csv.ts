import { logDev } from './utils';

export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => string | number | boolean | null | undefined;
};

/**
 * One cell, quoted only when it has to be. The leading apostrophe on `=+-@` guards
 * against formula injection from a resident's free-text field.
 */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return /[",\n\r]/.test(guarded) || guarded !== guarded.trim() ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const header = columns.map((column) => escapeCsvCell(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(column.value(row))).join(','));

  return [header, ...body].join('\r\n');
}

/**
 * What an export says about itself before its first data row: title, barangay,
 * date range, generation timestamp and active filters.
 */
type ReportContext = {
  title: string;
  /** The area covered — derived from the same query that produced the numbers, not the build. */
  barangay: string;
  from: string;
  to: string;
  /** Any filter beyond the date range, as label/value pairs already formatted. */
  filters?: { label: string; value: string }[];
};

export function buildReportCsv<Row>(context: ReportContext, rows: Row[], columns: CsvColumn<Row>[]): string {
  const filters = context.filters?.length
    ? context.filters.map((filter) => `${filter.label}: ${filter.value}`).join('; ')
    : 'None';

  const preamble = [
    ['Report', context.title],
    ['Barangay', context.barangay],
    ['Date range', `${context.from} to ${context.to}`],
    ['Generated', new Date().toISOString()],
    ['Filters', filters],
    ['Rows', rows.length],
  ]
    .map(([label, value]) => `${escapeCsvCell(label)},${escapeCsvCell(value)}`)
    .join('\r\n');

  return `${preamble}\r\n\r\n${toCsv(rows, columns)}`;
}

/** Build and hand over in one call, so the file name comes from the title the preamble carries. */
export function exportReport<Row>(context: ReportContext, rows: Row[], columns: CsvColumn<Row>[]): void {
  downloadCsv(reportFileName(context.title), buildReportCsv(context, rows, columns));
}

/** `report-title-2026-08-22.csv`, with anything a filesystem dislikes removed. */
export function reportFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return `${slug || 'report'}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/** Hands the finished CSV to the browser's download flow. The BOM makes Excel read it as UTF-8. */
function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  URL.revokeObjectURL(url);
  logDev('Exported report', fileName);
}
