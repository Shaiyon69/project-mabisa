type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = 'Loading records' }: LoadingStateProps) {
  return (
    <div className="loading-state" role="status">
      <span aria-hidden="true" />
      <strong>{label}</strong>
    </div>
  );
}
