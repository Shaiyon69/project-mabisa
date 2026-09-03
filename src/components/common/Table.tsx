import type { ReactNode } from 'react';
import { Badge } from './Badge';
import { EmptyState } from './StateMessage';

export type TableColumn<Row> = {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
};

type TableProps<Row> = {
  columns: TableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  emptyTitle: string;
  emptyText: string;
  limit?: number;
};

export function Table<Row>({ columns, rows, getRowKey, emptyTitle, emptyText, limit }: TableProps<Row>) {
  const visibleRows = typeof limit === 'number' ? rows.slice(0, limit) : rows;

  return (
    <div className="ui-table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <TableEmpty title={emptyTitle} text={emptyText} /> : null}
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
      Showing {shown} of {total} {label} row(s).
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
