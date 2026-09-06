import type { ReactNode } from 'react';
import { formatCount } from '../../lib/utils';
import { Badge } from './Badge';
import { EmptyState } from './StateMessage';

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
};

function cell<Row>(column: TableColumn<Row>, row: Row): ReactNode {
  const value = column.render(row);

  return column.numeric && typeof value === 'number' ? formatCount(value) : value;
}

export function Table<Row>({ columns, rows, getRowKey, emptyTitle, emptyText, limit }: TableProps<Row>) {
  const visibleRows = typeof limit === 'number' ? rows.slice(0, limit) : rows;

  // No rows means no table: the header strip and its 640px scrollbar over an
  // empty state read as a table that failed to load.
  if (!rows.length) {
    return <TableEmpty title={emptyTitle} text={emptyText} />;
  }

  return (
    <div className="ui-table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} data-numeric={column.numeric ? '' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={getRowKey(row)}>
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
