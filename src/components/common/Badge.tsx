type BadgeProps = {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'info';
};

export function Badge({ label, tone = 'info' }: BadgeProps) {
  return (
    <span className={`status-pill tone-${tone}`}>
      <Icon name={tone === 'warning' || tone === 'danger' ? 'warning' : 'check'} size={13} />
      {label}
    </span>
  );
}
import { Icon } from './Icon';
