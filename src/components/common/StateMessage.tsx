type StateTone = 'empty' | 'error';

type StateMessageProps = {
  title: string;
  text?: string;
  tone?: StateTone;
};

function StateMessage({ title, text, tone = 'empty' }: StateMessageProps) {
  return (
    <div className={`ui-state ui-state-${tone}`}>
      <strong>{title}</strong>
      {text ? <small>{text}</small> : null}
    </div>
  );
}

export function EmptyState({ title, text }: Omit<StateMessageProps, 'tone'>) {
  return <StateMessage title={title} text={text} tone="empty" />;
}

export function ErrorState({ title, text }: Omit<StateMessageProps, 'tone'>) {
  return <StateMessage title={title} text={text} tone="error" />;
}
