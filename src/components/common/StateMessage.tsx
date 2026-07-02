type StateTone = 'empty' | 'loading' | 'error' | 'offline';

type StateMessageProps = {
  title: string;
  text?: string;
  tone?: StateTone;
};

export function StateMessage({ title, text, tone = 'empty' }: StateMessageProps) {
  return (
    <div className={`ui-state ui-state-${tone}`} role={tone === 'loading' ? 'status' : undefined}>
      {tone === 'loading' ? <span aria-hidden="true" /> : null}
      <strong>{title}</strong>
      {text ? <small>{text}</small> : null}
    </div>
  );
}

export function EmptyState({ title, text }: Omit<StateMessageProps, 'tone'>) {
  return <StateMessage title={title} text={text} tone="empty" />;
}

export function LoadingState({ title = 'Loading records', text }: Partial<Omit<StateMessageProps, 'tone'>>) {
  return <StateMessage title={title} text={text} tone="loading" />;
}

export function ErrorState({ title, text }: Omit<StateMessageProps, 'tone'>) {
  return <StateMessage title={title} text={text} tone="error" />;
}

export function OfflineState({ title, text }: Omit<StateMessageProps, 'tone'>) {
  return <StateMessage title={title} text={text} tone="offline" />;
}
