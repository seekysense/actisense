/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'bg-2': 'var(--bg-2)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        ink: 'var(--ink)',
        'ink-1': 'var(--ink-1)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        'ink-4': 'var(--ink-4)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        'accent-ink': 'var(--accent-ink)',
        ok: 'var(--ok)',
        alarm: 'var(--sev-alarm)',
        'alarm-bg': 'var(--sev-alarm-bg)',
        notify: 'var(--sev-notify)',
        'notify-bg': 'var(--sev-notify-bg)',
        statistic: 'var(--sev-statistic)',
        'statistic-bg': 'var(--sev-statistic-bg)',
        offline: 'var(--sev-offline)',
        border: 'var(--line)',
        input: 'var(--line)',
        ring: 'var(--accent)',
        background: 'var(--bg)',
        foreground: 'var(--ink)',
        primary: {
          DEFAULT: 'var(--accent)',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: 'var(--bg-2)',
          foreground: 'var(--ink-2)',
        },
        destructive: {
          DEFAULT: 'var(--sev-alarm)',
          foreground: '#FFFFFF',
        },
        muted: {
          DEFAULT: 'var(--bg-2)',
          foreground: 'var(--ink-3)',
        },
        popover: {
          DEFAULT: 'var(--surface)',
          foreground: 'var(--ink)',
        },
        card: {
          DEFAULT: 'var(--surface)',
          foreground: 'var(--ink)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
