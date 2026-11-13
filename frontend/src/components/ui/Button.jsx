const VARIANTS = {
  primary:
    'bg-accent-600 text-white shadow-sm hover:bg-accent-700 disabled:bg-surface-strong disabled:text-ink-muted disabled:shadow-none',
  secondary:
    'bg-white text-ink ring-1 ring-inset ring-line hover:bg-surface disabled:bg-surface disabled:text-ink-muted',
  ghost: 'text-ink-soft hover:bg-surface disabled:text-ink-muted',
  success:
    'bg-success-600 text-white hover:bg-success-700 disabled:bg-surface-strong disabled:text-ink-muted',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 disabled:bg-surface-strong disabled:text-ink-muted',
  'danger-outline':
    'bg-white text-danger-700 ring-1 ring-inset ring-danger-200 hover:bg-danger-50 disabled:bg-surface disabled:text-ink-muted',
};

const SIZES = {
  md: 'min-h-11 px-4 text-sm sm:min-h-10',
  sm: 'min-h-10 px-3 text-sm sm:min-h-9',
  lg: 'min-h-11 px-5 text-sm',
};

export default function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
