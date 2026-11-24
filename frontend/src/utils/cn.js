/** Join class names, skipping falsy values. cn('a', cond && 'b', undefined) => 'a b' */
export function cn(...parts) {
  return parts.flat(Infinity).filter(Boolean).join(' ');
}
