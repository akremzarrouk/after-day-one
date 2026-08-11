import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev-only helper: lets the running game POST a framebuffer capture to disk so
 * it can be inspected outside the browser. Never included in a production
 * build (apply: 'serve').
 */
function screenshotEndpoint() {
  return {
    name: 'after-screenshot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { name = 'shot', data } = JSON.parse(body);
            const b64 = String(data).replace(/^data:image\/\w+;base64,/, '');
            const dir = process.env.AFTER_SHOT_DIR || path.resolve('.shots');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${name.replace(/[^a-z0-9_-]/gi, '')}.png`);
            fs.writeFileSync(file, Buffer.from(b64, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file }));
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [screenshotEndpoint()],
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
});
