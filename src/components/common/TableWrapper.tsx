import type { ReactNode } from 'react';

type TableWrapperProps = {
  children: ReactNode;
};

export function TableWrapper({ children }: TableWrapperProps) {
  return <div className="table-wrap">{children}</div>;
}
