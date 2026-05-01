/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      colors: {
        terminal: {
          bg:      'rgb(var(--tw-c-bg) / <alpha-value>)',
          surface: 'rgb(var(--tw-c-surface) / <alpha-value>)',
          border:  'rgb(var(--tw-c-border) / <alpha-value>)',
          text:    'rgb(var(--tw-c-text) / <alpha-value>)',
          muted:   'rgb(var(--tw-c-muted) / <alpha-value>)',
          green:   'rgb(var(--tw-c-green) / <alpha-value>)',
          blue:    'rgb(var(--tw-c-blue) / <alpha-value>)',
          yellow:  'rgb(var(--tw-c-yellow) / <alpha-value>)',
          red:     'rgb(var(--tw-c-red) / <alpha-value>)',
          cyan:    'rgb(var(--tw-c-cyan) / <alpha-value>)',
        },
      },
      animation: {
        blink:     'blink 1s step-end infinite',
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up':'slideUp 0.2s ease-out',
      },
      keyframes: {
        blink:   { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
