import { defineConfig, type Plugin } from 'vite';

// The page may only load what ships with the app: no script, style, image or
// connection from anywhere else, so text from a ticket can never pull code
// in. Inline style attributes are allowed (positions and colours are set that
// way); inline scripts are not. Applied to the built app only: the development
// server needs its own injected scripts, and the prototype (mock mode) is
// shown inside other pages that bring their own rules.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'argusdesk-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// "mock" mode (npm run dev:mock / build:mock) runs the screen on made-up
// data without the Go backend, in any browser.
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __MOCK__: JSON.stringify(mode === 'mock') },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: { port: 9245, strictPort: true },
  plugins: mode === 'mock' && !process.env.ARGUSDESK_CSP_TEST ? [] : [csp()],
}));
