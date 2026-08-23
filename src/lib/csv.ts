import { logDev } from './utils';

export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => string | number | boolean | null | undefined;
};

/**
 * One cell, quoted only when it has to be.
 *
 * The leading apostrophe on `=`, `+`, `-` and `@` is not cosmetic: a spreadsheet
 * treats a cell starting with one as a formula, so a resident whose occupation
 * was typed as `=cmd|...` becomes code the moment an LGU officer opens the file.
 * Every value here originates in a free-text field a BHW filled in on a phone,
 * which makes the export the trust boundary.
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
 * What an export has to say about itself before its first data row, from FR-09:
 * report title, barangay, date range, generation timestamp, and the filters that
 * were active. Without these a saved CSV is a column of numbers nobody can tie
 * back to a question.
 */
export type ReportContext = {
  title: string;
  /**
   * The area covered, per FR-09. Travels with the rows rather than coming from
   * the build: this used to read `VITE_BARANGAY_NAME`, which was right while one
   * deployment served one barangay and wrong the moment the database began
   * holding several — an RHU export spanning all of them printed whichever name
   * that bundle happened to be compiled with. `describeBarangayScope` derives it
   * from the same query that produced the numbers.
   */
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

/** `report-title-2026-08-22.csv`, with anything a filesystem dislikes removed. */
export function reportFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return `${slug || 'report'}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Hands the finished CSV to the browser's download flow.
 *
 * The BOM is what makes Excel read the file as UTF-8 rather than the local code
 * page; without it a resident named Peña arrives mangled in the LGU's copy.
 */
export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  URL.revokeObjectURL(url);
  logDev('Exported report', fileName);
}
