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
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      // Échelle typographique Socle (tokens.json → typography), × --text-scale (110 %, règle Socle).
      // N'utiliser que ces tailles : plus de text-[11px], text-xs, text-sm… dans les composants.
      fontSize: {
        caption: ['calc(10px * var(--text-scale))', { lineHeight: '1.4' }],
        meta: ['calc(11px * var(--text-scale))', { lineHeight: '1.375' }],
        body: ['calc(12px * var(--text-scale))', { lineHeight: '1.35' }],
        'body-lg': ['calc(14px * var(--text-scale))', { lineHeight: '1.43' }],
        title: ['calc(14px * var(--text-scale))', { lineHeight: '1.43', letterSpacing: '0.025em' }],
        reading: ['calc(15px * var(--text-scale))', { lineHeight: '1.625' }],
        heading: ['calc(16px * var(--text-scale))', { lineHeight: '1.5', letterSpacing: '0.025em' }],
        display: ['calc(20px * var(--text-scale))', { lineHeight: '1.4', letterSpacing: '0.025em' }],
      },
    },
  },
  plugins: [],
}
