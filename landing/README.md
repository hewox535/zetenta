# Landing de Zetenta

Sitio de marketing de zetenta.app. Vive en el mismo repo y en el mismo sitio
de Netlify que la app: se compila en `dist/l/` y Netlify la sirve en la raíz
del dominio principal (ver `public/_redirects`). Vite + GSAP (ScrollTrigger) +
Lenis, sin framework.

```bash
npm run dev:landing   # http://localhost:5180
npm run build         # compila la app y luego la landing en dist/l
```

En local los botones "Prueba gratis" e "Iniciar sesión" van a la app en
`http://localhost:5181` (`landing/.env.development`): levántala con `npm run dev`.

## Cómo convive con la app

- Solo `https://zetenta.app/` (y `www.`) muestran la landing. Los subdominios
  de las tiendas (`roma.zetenta.app`…) y todas las demás rutas (`/login`,
  `/orders`, `/catalogo`…) siguen siendo la app.
- Quien ya tiene sesión, o abre la app instalada, no ve la landing: un script
  en el `<head>` lo manda a `/inicio` (o a `/login`), la entrada del panel.
- Los botones "Prueba gratis" e "Iniciar sesión" son rutas internas
  (`/register`, `/login`). `VITE_APP_URL` permite apuntarlos a otro dominio.

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
- `public/img/productos`: fotos de producto de Unsplash (licencia libre, uso
  comercial sin atribución): franela `1778671394516-8270eac13c42`, pulsera
  `1676291055501-286c48bb186f`, jean `1637069585336-827b298fe84a`, gorra
  `1691256676359-20e5c6d4bc92`, vestido `1747396206869-75ea57b325ce`
  (`images.unsplash.com/photo-<id>`).
- Teléfonos del hero, cobro y escenas de la dueña y el café: generados con
  Higgsfield (GPT Image 2.5) usando capturas de estas mismas pantallas como
  referencia.

Con `prefers-reduced-motion` no hay loader ni secciones fijadas: el contenido
se muestra en su estado final.
