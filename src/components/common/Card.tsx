import type { HTMLAttributes, ReactNode } from 'react';

type CardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: 'section' | 'article' | 'div';
};

export function Card({ as: Component = 'section', className = '', children, ...props }: CardProps) {
  return (
    <Component className={`screen-panel ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}
