type EmptyStateProps = {
  title: string;
  text: string;
};

export function EmptyState({ title, text }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}
