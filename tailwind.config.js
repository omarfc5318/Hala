/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#7C3AED',
        'primary-light': '#EDE9FE',
        accent: '#8B5CF6',
        bg: '#FFFFFF',
        text: '#1C1C1E',
        muted: '#8E8E93',
      },
    },
  },
  plugins: [],
};
