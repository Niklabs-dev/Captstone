const VARIANTS = {
  salmon: 'bg-tint2 text-salmon-ink',
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  crit: 'bg-crit-bg text-crit',
  info: 'bg-info-bg text-info',
  gray: 'bg-tint text-ink2',
} as const;

export type PillVariant = keyof typeof VARIANTS;

export function Pill({
  children,
  variant = 'salmon',
  pulse = false,
  className = '',
}: {
  children: React.ReactNode;
  variant?: PillVariant;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold ${VARIANTS[variant]} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-current ${pulse ? 'animate-pulse' : ''}`} />
      {children}
    </span>
  );
}
