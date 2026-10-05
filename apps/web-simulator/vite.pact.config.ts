import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react()],
  build: { outDir: 'dist-pact', rolldownOptions: { input: 'pact.html' } },
});
