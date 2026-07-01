type StatCardProps = {
  label: string;
  value: number;
  detail: string;
  tone: 'blue' | 'green' | 'amber' | 'red';
};

export function StatCard({ label, value, detail, tone }: StatCardProps) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
