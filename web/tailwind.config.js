/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#f2f6ff",
          100: "#e2ebff",
          200: "#c6d7ff",
          300: "#9fb9ff",
          400: "#6f8fff",
          500: "#4a63f5",
          600: "#3946d6",
          700: "#2f36ad",
          800: "#292f89",
          900: "#252b6e",
        },
        accent: {
          400: "#22d3b0",
          500: "#0fb896",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15, 23, 42, 0.06), 0 1px 3px 0 rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};
