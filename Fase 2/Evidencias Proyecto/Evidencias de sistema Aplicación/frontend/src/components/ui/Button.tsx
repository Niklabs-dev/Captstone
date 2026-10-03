import { ButtonHTMLAttributes } from 'react';

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const VARIANTS = {
  default: 'border border-line2 bg-bg text-ink hover:bg-tint disabled:hover:bg-bg',
  primary: 'bg-salmon border border-salmon text-white hover:bg-salmon-deep disabled:hover:bg-salmon',
  danger: 'bg-crit border border-crit text-white hover:bg-[#c2432f]',
} as const;

const SIZES = {
  sm: 'text-[12.5px] px-2.5 py-1.5',
  md: 'text-sm px-3.5 py-2.5',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}

export function Button({ variant = 'default', size = 'sm', className = '', ...props }: ButtonProps) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...props} />
  );
}
