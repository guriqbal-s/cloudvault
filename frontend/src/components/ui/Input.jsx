import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../utils/cn.js';

export const fieldClass = (error) => cn(
  'w-full rounded-xl border bg-surface px-3.5 text-base text-content sm:text-sm placeholder:text-content-faint transition-shadow',
  'focus:border-brand focus:shadow-ring disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-70',
  error ? 'border-danger' : 'border-border hover:border-border-strong'
);

/** Label + control + hint/error wrapper used by Input, Select and Textarea. */
export function Field({ id, label, hint, error, required, children, className }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-[13px] font-semibold">
          {label}{required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? <p id={`${id}-err`} role="alert" className="text-xs font-medium text-danger">{error}</p>
        : hint ? <p id={`${id}-hint`} className="text-xs text-content-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * <Input label hint error leftIcon={<Search/>} rightSlot revealable (password toggle) {...input props} />
 * `error` is a string message (shown below, field turns red).
 */
const Input = forwardRef(function Input(
  { label, hint, error, leftIcon, rightSlot, revealable, className, wrapperClassName, id: idProp, type = 'text', required, ...rest },
  ref
) {
  const auto = useId();
  const id = idProp ?? auto;
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} className={wrapperClassName}>
      <div className="relative">
        {leftIcon && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-content-faint [&>svg]:h-4 [&>svg]:w-4">{leftIcon}</span>}
        <input
          ref={ref} id={id} required={required}
          type={isPassword && revealable && shown ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          className={cn(fieldClass(error), 'h-10', leftIcon && 'pl-10', (rightSlot || (isPassword && revealable)) && 'pr-11', className)}
          {...rest}
        />
        {isPassword && revealable ? (
          <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-2 my-auto flex h-7 w-7 items-center justify-center rounded-md text-content-faint hover:text-content">
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : rightSlot ? <span className="absolute inset-y-0 right-3 flex items-center">{rightSlot}</span> : null}
      </div>
    </Field>
  );
});
export default Input;

/** <Textarea label error rows={3} /> */
export const Textarea = forwardRef(function Textarea({ label, hint, error, className, id: idProp, required, rows = 3, ...rest }, ref) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <textarea ref={ref} id={id} rows={rows} required={required} aria-invalid={error ? true : undefined}
        className={cn(fieldClass(error), 'py-2.5', className)} {...rest} />
    </Field>
  );
});
