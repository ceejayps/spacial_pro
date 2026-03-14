import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#258cf4',
        'background-light': '#f5f7f8',
        'background-dark': '#101922',
      },
    },
  },
  plugins: [],
} satisfies Config;
