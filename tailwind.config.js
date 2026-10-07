/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.tsx',
    './screens/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './constants/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#121214',
        surface: '#1C1C1E',
        line: '#2C2C2E',
        muted: '#A0A0A5',
        pulse: '#FF3B30',
        flow: '#007AFF',
        surge: '#39FF14',
      },
    },
  },
  plugins: [],
};
