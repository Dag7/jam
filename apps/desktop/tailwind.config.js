/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../node_modules/streamdown/dist/*.js",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#09090b',
          raised: '#18181b',
          overlay: '#27272a',
        },
        agent: {
          blue: '#3b82f6',
          purple: '#8b5cf6',
          green: '#22c55e',
          orange: '#f97316',
          pink: '#ec4899',
          cyan: '#06b6d4',
        },
        status: {
          idle: '#6b7280',
          listening: '#3b82f6',
          thinking: '#a855f7',
          speaking: '#22c55e',
          working: '#f59e0b',
          error: '#ef4444',
          offline: '#374151',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      spacing: {
        titlebar: '38px',
      },
    },
  },
  plugins: [],
};
