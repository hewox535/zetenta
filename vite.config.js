import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Puerto fijo para no cruzarse con otros proyectos en el 5173; la landing
  // local (5180) manda los botones de cuenta aquí.
  server: { port: 5181, strictPort: true },
})
