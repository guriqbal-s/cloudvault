import { forwardRef } from 'react';
import { cn } from '../../utils/cn.js';
import Spinner from './Spinner.jsx';

const VARIANTS = {
  primary: 'bg-brand text-brand-contrast shadow-card hover:bg-brand-strong hover:text-brand-contrast focus-visible:shadow-ring',
  secondary: 'bg-surface text-content border border-border shadow-card hover:bg-surface-muted hover:border-border-strong',
  ghost: 'text-content-muted hover:bg-surface-sunken hover:text-content',
  danger: 'bg-danger text-white shadow-card hover:opacity-90',
  'danger-ghost': 'text-danger hover:bg-danger-soft',
  soft: 'bg-brand-soft text-brand hover:bg-brand-soft/70',
};
const SIZES = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-[13px]',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-12 gap-2 rounded-xl px-6 text-base',
};
const ICON_SIZES = { sm: 'h-8 w-8 rounded-lg', md: 'h-10 w-10 rounded-xl', lg: 'h-12 w-12 rounded-xl' };
// Icons passed as leftIcon/rightIcon are sized to match the label (lucide defaults to 24px).
const iconSlot = (size) => cn('inline-flex shrink-0', size === 'lg' ? '[&>svg]:h-5 [&>svg]:w-5' : size === 'sm' ? '[&>svg]:h-3.5 [&>svg]:w-3.5' : '[&>svg]:h-[18px] [&>svg]:w-[18px]');

/**
 * <Button variant="primary|secondary|ghost|danger|danger-ghost|soft" size="sm|md|lg"
 *   loading leftIcon={<Plus/>} rightIcon icon (square icon-only: pass aria-label) as={Link} to="/x" />
 */
const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, leftIcon, rightIcon, icon = false, as: As = 'button', className, children, type, ...rest },
  ref
) {
  const isButton = As === 'button';
  return (
    <As
      ref={ref}
      type={isButton ? type ?? 'button' : undefined}
      disabled={isButton ? disabled || loading : undefined}
      aria-disabled={!isButton && (disabled || loading) ? true : undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
        VARIANTS[variant], icon ? ICON_SIZES[size] : SIZES[size], className
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4 text-current" /> : leftIcon && <span className={iconSlot(size)}>{leftIcon}</span>}
      {children}
      {!loading && rightIcon && <span className={iconSlot(size)}>{rightIcon}</span>}
    </As>
  );
});
export default Button;
