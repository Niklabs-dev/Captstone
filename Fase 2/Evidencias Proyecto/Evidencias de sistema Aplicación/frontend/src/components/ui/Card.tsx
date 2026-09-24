export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-bg border border-line rounded-2xl p-4 ${className}`}>{children}</div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-3.5 gap-3">
      <div>
        <div className="text-sm font-bold">{title}</div>
        {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
