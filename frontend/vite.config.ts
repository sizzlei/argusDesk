import { defineConfig } from 'vite';

// "mock" mode (npm run dev:mock / build:mock) runs the screen on made-up
// data without the Go backend, in any browser.
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __MOCK__: JSON.stringify(mode === 'mock') },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: { port: 9245, strictPort: true },
}));
