/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void: '#181818',
        background: '#181818',
        surface: '#181818',
        card: '#222222',
        cardHover: '#262626',
        border: '#2c2c2c',
        borderLight: '#404040',
        accent: '#0ea5e9',
        accentGlow: '#38bdf8',
        purpleAccent: '#0369a1',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
