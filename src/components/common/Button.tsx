import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'secondary';
  children: ReactNode;
};

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`${variant}-button ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}
