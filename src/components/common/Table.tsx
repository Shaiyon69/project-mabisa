import { useState, type ReactNode } from 'react';
import { formatCount } from '../../lib/utils';
import { Badge } from './Badge';
import { Button } from './Button';
import { EmptyState } from './StateMessage';

/** Rows per page, everywhere. The search box above a table narrows the list; the pager reaches the rest. */
export const ROWS_PER_PAGE = 10;

export type TableColumn<Row> = {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** A column of figures: right-aligned, and a bare number is grouped at the thousands. */
  numeric?: boolean;
};

type TableProps<Row> = {
  columns: TableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  emptyTitle: string;
  emptyText: string;
  limit?: number;
  /** Rows per page. Given, the table pages through every row rather than cutting the list short. */
  pageSize?: number;
  /** Numbers the rows. `startIndex` continues the count for a table paged on the server. */
  numbered?: boolean;
  startIndex?: number;
};

function cell<Row>(column: TableColumn<Row>, row: Row): ReactNode {
  const value = column.render(row);

  return column.numeric && typeof value === 'number' ? formatCount(value) : value;
}

export function Table<Row>({
  columns,
  rows,
  getRowKey,
  emptyTitle,
  emptyText,
  limit,
  pageSize,
  numbered,
  startIndex = 0,
}: TableProps<Row>) {
  const [page, setPage] = useState(1);
  const pageCount = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  // Clamped rather than reset: a filter that shortens the list past the current
  // page would otherwise leave the table on a page that no longer exists.
  const current = Math.min(page, pageCount);
  const offset = pageSize ? (current - 1) * pageSize : 0;
  const visibleRows = pageSize
    ? rows.slice(offset, offset + pageSize)
    : typeof limit === 'number'
      ? rows.slice(0, limit)
      : rows;

  // No rows means no table: the header strip and its 640px scrollbar over an
  // empty state read as a table that failed to load.
  if (!rows.length) {
    return <TableEmpty title={emptyTitle} text={emptyText} />;
  }

  return (
    <>
      <div className="ui-table-wrap">
        <table>
          <thead>
            <tr>
              {numbered ? <th data-numeric="">#</th> : null}
              {columns.map((column) => (
                <th key={column.key} data-numeric={column.numeric ? '' : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={getRowKey(row)}>
                {numbered ? <td data-numeric="">{formatCount(startIndex + offset + index + 1)}</td> : null}
                {columns.map((column) => (
                  <td key={column.key} data-numeric={column.numeric ? '' : undefined}>
                    {cell(column, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <TablePager page={current} pageCount={pageCount} onPage={setPage} />
      ) : null}
    </>
  );
}

type TablePagerProps = {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
};

/** Previous/next for a table paged in the browser. Server-paged screens bring their own. */
export function TablePager({ page, pageCount, onPage }: TablePagerProps) {
  return (
    <div className="admin-pager">
      <Button variant="ghost" onClick={() => onPage(page - 1)} disabled={page <= 1}>
        Previous
      </Button>
      <span className="muted">
        Page {page} of {pageCount}
      </span>
      <Button variant="ghost" onClick={() => onPage(page + 1)} disabled={page >= pageCount}>
        Next
      </Button>
    </div>
  );
}

type TableToolbarProps = {
  children: ReactNode;
};

export function TableToolbar({ children }: TableToolbarProps) {
  return <div className="ui-table-toolbar">{children}</div>;
}

type TableEmptyProps = {
  title: string;
  text: string;
};

function TableEmpty({ title, text }: TableEmptyProps) {
  return <EmptyState title={title} text={text} />;
}

type TableMetaProps = {
  shown: number;
  total: number;
  label: string;
};

export function TableMeta({ shown, total, label }: TableMetaProps) {
  return (
    <p className="ui-table-meta">
      Showing {formatCount(shown)} of {formatCount(total)} {label}.
    </p>
  );
}

type TableBadgeProps = {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
};

export function TableBadge({ label, tone }: TableBadgeProps) {
  return <Badge label={label} tone={tone} />;
}
