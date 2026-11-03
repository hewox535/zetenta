# Landing de Zetenta

Sitio de marketing de zetenta.app, separado de la app (que es white-label y
ocupa todas las rutas de su dominio). Vite + GSAP (ScrollTrigger) + Lenis, sin
framework.

```bash
cd landing
npm install
npm run dev      # http://localhost:5180
npm run build    # sale en landing/dist
```

## Configuración

- `VITE_APP_URL`: dónde vive la app; los botones "Prueba gratis" e "Iniciar
  sesión" van a `${VITE_APP_URL}/register` y `/login`. Por defecto
  `https://zetenta.app`.
- Netlify: crear un sitio nuevo con **Base directory = `landing`** (el
  `netlify.toml` de esta carpeta pone el comando y la carpeta de salida).

## Estructura

- `index.html`: todo el contenido (textos según la voz del manual de marca).
- `src/main.js`: loader, scroll suave y animaciones por sección.
- `src/brand.js`: la Z (13 cuadros de la matriz 5 × 5) y el wordmark,
  tomados de los archivos maestros del paquete de marca.
- `src/style.css`: tokens del manual (azul `#2323FF`, tinta, papel, noche,
  medianoche, cielo) y estilos.
- `public/fonts`: Geist, Geist Mono y Doto del paquete de marca (OFL).
- `public/img`: mockups del paquete de marca en WebP y la versión con
  tratamiento LED del punto de venta (`herramientas/zetenta_led.py`).

Con `prefers-reduced-motion` no hay loader ni secciones fijadas: el contenido
se muestra en su estado final.
