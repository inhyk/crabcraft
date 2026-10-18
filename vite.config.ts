import { defineConfig } from 'vite';
import { attachRooms } from './server/rooms.ts';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const root = fileURLToPath(new URL('.', import.meta.url));
// Run the local page against one Node process for accounts, presence and monitor snapshots.
const nodeServer = process.env.CC_SERVER_URL;
const apiProxy = { '/world': { target: nodeServer || 'http://127.0.0.1:8795', ws: true }, '/api/account': { target: nodeServer || 'http://127.0.0.1:8795' }, ...(nodeServer ? { '/multiplayer': { target: nodeServer, ws: true } } : {}) };
const monitorRoute = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
  const [path, query] = (req.url ?? '').split('?');
  if (path !== '/monitor') { next(); return; }
  res.writeHead(308, { Location: '/monitor/' + (query ? '?' + query : '') }); res.end();
};

// Every dev/*.html page is a standalone harness (crab turntable, motion viewer, world fly-through...).
// `pnpm dev` serves them as they are; a production build leaves them (and their dev/assets) out
// unless CC_DEV_PAGES=1 is set: CC_DEV_PAGES=1 pnpm build.
const withDevPages = process.env.CC_DEV_PAGES === '1';
const devPages = withDevPages
  ? Object.fromEntries(
      readdirSync(resolve(root, 'dev'))
        .filter((f: string) => f.endsWith('.html'))
        .map((f: string) => [`dev-${f.replace(/\.html$/, '')}`, resolve(root, 'dev', f)]),
    )
  : {};

export default defineConfig({
  base: './',
  plugins: [{
    name: 'crabcraft-multiplayer',
    configureServer(server) { server.middlewares.use(monitorRoute); if (server.httpServer && !nodeServer) attachRooms(server.httpServer); },
    configurePreviewServer(server) { server.middlewares.use(monitorRoute); if (!nodeServer) attachRooms(server.httpServer); },
  }],
  // The account server sees the page's own Host, so Google sign-in returns through this proxy.
  preview:{proxy:apiProxy},
  server: {
    // Videos and posters live on the game server, not in public/ (VITE_MEDIA_BASE, default /media).
    proxy:{...apiProxy,'/media/':{target:'https://crab-dev.seonn.dev',changeOrigin:true}},
    headers: {
      // SharedArrayBuffer for MuJoCo WASM threads and onnxruntime-web.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { main: resolve(root, 'index.html'), monitor: resolve(root, 'monitor/index.html'), ...devPages },
    },
  },
});
