import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// En producción la landing se publica dentro del mismo sitio que la app, en
// /l/, y Netlify la sirve en la raíz de zetenta.app (ver public/_redirects);
// los subdominios de las tiendas siguen yendo a la app. En local se sirve
// directo en /.
export default defineConfig(({ command }) => ({
  root: __dirname,
  base: command === 'build' ? '/l/' : '/',
  // Caché propia: si comparte node_modules/.vite con la app y los dos
  // servidores corren a la vez, se pisan las dependencias optimizadas y la app
  // queda en blanco.
  cacheDir: resolve(__dirname, '../node_modules/.vite-landing'),
  server: { port: 5180 },
  build: {
    target: 'es2020',
    outDir: resolve(__dirname, '../dist/l'),
    emptyOutDir: true,
  },
}));
