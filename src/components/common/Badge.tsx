type BadgeProps = {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'info';
};

/** No icon on `info`: a tick beside "Household Head" or a row count reads as a verdict. */
const TONE_ICONS = { success: 'check', warning: 'warning', danger: 'warning' } as const;

export function Badge({ label, tone = 'info' }: BadgeProps) {
  const icon = tone === 'info' ? null : TONE_ICONS[tone];

  return (
    <span className={`status-pill tone-${tone}`}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {label}
    </span>
  );
}
import { Icon } from './Icon';
