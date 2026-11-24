/** @type {import('tailwindcss').Config} */
// Colours resolve from CSS variables (src/index.css) so light/dark is a variable swap.
const token = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: token('surface'), muted: token('surface-muted'), sunken: token('surface-sunken') },
        'surface-muted': token('surface-muted'),
        'surface-sunken': token('surface-sunken'),
        border: { DEFAULT: token('border'), strong: token('border-strong') },
        content: { DEFAULT: token('content'), muted: token('content-muted'), faint: token('content-faint') },
        'content-muted': token('content-muted'),
        brand: { DEFAULT: token('brand'), strong: token('brand-strong'), soft: token('brand-soft'), contrast: token('brand-contrast') },
        accent: { DEFAULT: token('accent'), soft: token('accent-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
        info: { DEFAULT: token('info'), soft: token('info-soft') },
      },
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.05), 0 1px 1px rgb(var(--shadow) / 0.03)',
        pop: '0 12px 32px -8px rgb(var(--shadow) / 0.22), 0 2px 6px rgb(var(--shadow) / 0.08)',
        ring: '0 0 0 3px rgb(var(--color-brand) / 0.22)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'pop-in': { from: { opacity: 0, transform: 'translateY(6px) scale(0.98)' }, to: { opacity: 1, transform: 'none' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'toast-in': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'pop-in': 'pop-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'toast-in': 'toast-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
