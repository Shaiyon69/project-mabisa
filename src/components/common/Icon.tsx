export type IconName =
  | 'home'
  | 'user'
  | 'users'
  | 'heart'
  | 'package'
  | 'check'
  | 'warning'
  | 'wifi'
  | 'logout'
  | 'plus'
  | 'save'
  | 'profile'
  | 'chevron'
  | 'chart'
  | 'shield'
  | 'clipboard';

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-7h6v7" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  // Two figures rather than one: this marks a registry of many residents, next
  // to `user`, which marks a single resident record.
  users: <><circle cx="9" cy="8" r="3.6" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.2 5.1a3.6 3.6 0 0 1 0 6.9M17.6 14.2A6.5 6.5 0 0 1 21.5 20" /></>,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  package: <><path d="m3 7.5 9-5 9 5v9l-9 5-9-5Z" /><path d="m3.3 7.3 8.7 5 8.7-5M12 22V12.3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  warning: <><path d="M10.3 3.7 2.6 18a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  wifi: <><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="19" r="1" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 3h7v18h-7" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  // Points right. The back link flips it in CSS rather than carrying a second path.
  chevron: <path d="m9 5 7 7-7 7" />,
  save: <><path d="M4 3h13l3 3v15H4Z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></>,
  // Circled, so it is not read as the plain `user` on the resident tab beside it.
  profile: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.6 18.6a6 6 0 0 1 10.8 0" /></>,
  chart: <><path d="M3 21h18" /><path d="M6.5 21v-8M11.5 21V4.5M16.5 21v-5M21 21v-10" /></>,
  // Access control, not protection: this marks the screen where roles and purok
  // assignments are granted.
  shield: <><path d="M12 2.6 4.5 5.6v6.1c0 4.6 3.1 8.4 7.5 9.7 4.4-1.3 7.5-5.1 7.5-9.7V5.6Z" /><path d="m9 12 2.2 2.2L15.4 10" /></>,
  clipboard: <><path d="M9 4.5H7.5A1.5 1.5 0 0 0 6 6v13.5A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15" /><rect x="9" y="2.5" width="6" height="4" rx="1.2" /><path d="M9.5 12.5h5M9.5 16.5h3" /></>,
};

export function Icon({ name, size = 18, className = '' }: IconProps) {
  return (
    <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
