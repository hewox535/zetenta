import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// En producción la landing se publica dentro del mismo sitio que la app, en
// /l/, y Netlify la sirve en la raíz de zetenta.app (ver public/_redirects);
// los subdominios de las tiendas siguen yendo a la app. En local se sirve
// directo en /.
export default defineConfig(({ command }) => ({
  root: __dirname,
  base: command === 'build' ? '/l/' : '/',
  server: { port: 5180 },
  build: {
    target: 'es2020',
    outDir: resolve(__dirname, '../dist/l'),
    emptyOutDir: true,
  },
}));
