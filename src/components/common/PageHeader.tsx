import type { ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="header-copy">{description}</p> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
  );
}
