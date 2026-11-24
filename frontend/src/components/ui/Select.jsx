import { forwardRef, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { Field, fieldClass } from './Input.jsx';

/**
 * Native select (accessible, mobile friendly).
 * <Select label value onChange options={[{value,label}]} placeholder="Any" error />  (or pass <option> children)
 */
const Select = forwardRef(function Select({ label, hint, error, options, placeholder, className, id: idProp, required, children, ...rest }, ref) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <div className="relative">
        <select ref={ref} id={id} required={required} aria-invalid={error ? true : undefined}
          className={cn(fieldClass(error), 'h-10 cursor-pointer appearance-none pr-9', className)} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options?.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
      </div>
    </Field>
  );
});
export default Select;
