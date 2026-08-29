import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

type PageHeaderProps = {
  /** Optional. On the portal the rail already names the section, so an eyebrow
      repeating it is a second line saying where you already know you are. */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Optional subject mark, shown beside the title. Pairs the page with the rail
      item that led here, so the icon in the sidebar and the icon on the page are
      the same shape. */
  icon?: IconName;
};

export function PageHeader({ eyebrow, title, description, actions, icon }: PageHeaderProps) {
  return (
    <header className="app-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className={icon ? 'header-title-icon' : undefined}>
          {icon ? <Icon name={icon} size={26} /> : null}
          {title}
        </h1>
        {description ? <p className="header-copy">{description}</p> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
  );
}
