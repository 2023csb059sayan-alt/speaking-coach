/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#0b1020',
          800: '#111a33',
          700: '#18244a',
        },
        accent: {
          400: '#5eead4',
          500: '#2dd4bf',
          600: '#14b8a6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(2, 6, 23, 0.4), 0 12px 32px -12px rgba(2, 6, 23, 0.6)',
      },
    },
  },
  plugins: [],
};
