/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: '#1C1C1E',       // Matte Charcoal
        surface: '#2C2C2E',    // Slate Gray
        focus: '#E5DACC',      // Warm Sand
        primary: '#F2F2F2',    // Bone White
        dimmed: '#8E8E93',     // Asphalt Text
        accent: '#FF5A00',     // Industrial Orange
        critical: '#FF3B30',   // Signal Red
      }
    },
  },
  plugins: [],
}
