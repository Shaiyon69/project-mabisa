import { describe, expect, it } from 'vitest';
import { buildReportCsv, escapeCsvCell, reportFileName, toCsv, type CsvColumn } from './csv';

describe('escapeCsvCell', () => {
  it('leaves a plain value alone', () => {
    expect(escapeCsvCell('Juan')).toBe('Juan');
    expect(escapeCsvCell(21.4)).toBe('21.4');
  });

  it('renders null and undefined as an empty cell', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('quotes separators, quotes and newlines', () => {
    expect(escapeCsvCell('Cruz, Juan')).toBe('"Cruz, Juan"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvCell(' padded ')).toBe('" padded "');
  });

  it('defuses spreadsheet formulas typed into a field', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvCell('@import')).toBe("'@import");
    // A negative measurement is still data, but the spreadsheet cannot tell it
    // from a formula either, so the guard wins.
    expect(escapeCsvCell('-5')).toBe("'-5");
  });
});

type Row = { name: string; count: number };

const columns: CsvColumn<Row>[] = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Count', value: (row) => row.count },
];

describe('toCsv', () => {
  it('writes a header row even with no data', () => {
    expect(toCsv([], columns)).toBe('Name,Count');
  });

  it('writes one CRLF-delimited line per row', () => {
    expect(toCsv([{ name: 'Purok 1', count: 3 }], columns)).toBe('Name,Count\r\nPurok 1,3');
  });
});

describe('buildReportCsv', () => {
  const csv = buildReportCsv(
    {
      title: 'Nutrition Status Summary',
      barangay: 'Barangay San Isidro',
      from: '2026-01-01',
      to: '2026-08-22',
      filters: [{ label: 'Sex', value: 'Female' }],
    },
    [{ name: 'normal', count: 12 }],
    columns,
  );

  it('carries every field FR-09 requires on an export', () => {
    expect(csv).toContain('Report,Nutrition Status Summary');
    expect(csv).toContain('Barangay,Barangay San Isidro');
    expect(csv).toContain('Date range,2026-01-01 to 2026-08-22');
    expect(csv).toContain('Generated,');
    expect(csv).toContain('Filters,Sex: Female');
  });

  it('states the row count so a truncated file is visible', () => {
    expect(csv).toContain('Rows,1');
  });

  it('says so plainly when no filter beyond the date range is active', () => {
    const unfiltered = buildReportCsv({ title: 'All', barangay: 'Barangay San Isidro', from: '2026-01-01', to: '2026-08-22' }, [], columns);

    expect(unfiltered).toContain('Filters,None');
  });

  it('separates the preamble from the data with a blank line', () => {
    expect(csv).toContain('\r\n\r\nName,Count\r\n');
  });
});

describe('reportFileName', () => {
  it('slugs the title and stamps the date', () => {
    expect(reportFileName('Nutrition Status Summary')).toMatch(/^nutrition-status-summary-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
