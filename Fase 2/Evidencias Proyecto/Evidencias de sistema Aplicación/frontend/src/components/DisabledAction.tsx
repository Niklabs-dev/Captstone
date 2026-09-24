import { Button } from './ui/Button';

export function DisabledAction({
  label,
  sprint,
  primary = false,
}: {
  label: string;
  sprint: string;
  primary?: boolean;
}) {
  return (
    <span className="relative inline-block group">
      <Button variant={primary ? 'primary' : 'default'} disabled>
        {label}
      </Button>
      <span
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5
                   whitespace-nowrap rounded-md bg-ink px-2.5 py-1 text-[11px] text-white
                   opacity-0 group-hover:opacity-100 transition-opacity z-30"
      >
        Disponible en {sprint}
      </span>
    </span>
  );
}
