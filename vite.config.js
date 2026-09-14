import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';

const PART_LAB_PACK_FILE = 'public/part-lab/pack.json';
const PART_LAB_PACK_LIMIT = 48 * 1024 * 1024;

// Dev-only source promotion for the part lab: "save all" posts the pack here
// and it lands in public/ so the next build ships the promoted sounds and art.
function partLabPromotion() {
  return {
    name: 'part-lab-promotion',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__part-lab/promote', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end();
          return;
        }
        const chunks = [];
        let size = 0;
        request.on('data', (chunk) => {
          size += chunk.length;
          if (size > PART_LAB_PACK_LIMIT) request.destroy();
          else chunks.push(chunk);
        });
        request.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            const pack = JSON.parse(raw);
            if (pack?.version !== 1 || typeof pack.visuals !== 'object' || !Array.isArray(pack.sounds) || !Array.isArray(pack.bindings)) {
              throw new Error('invalid part lab pack');
            }
            const target = resolve(server.config.root, PART_LAB_PACK_FILE);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, raw);
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: true, path: PART_LAB_PACK_FILE }));
          } catch (error) {
            response.statusCode = 400;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
          }
        });
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [partLabPromotion()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true
  }
});
