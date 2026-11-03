import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// La landing se publica dentro del mismo sitio que la app, en /l/. Netlify
// sirve /l/index.html en la raíz de zetenta.app (ver public/_redirects); los
// subdominios de las tiendas siguen yendo a la app.
export default defineConfig({
  root: __dirname,
  base: '/l/',
  server: { port: 5180 },
  build: {
    target: 'es2020',
    outDir: resolve(__dirname, '../dist/l'),
    emptyOutDir: true,
  },
});
