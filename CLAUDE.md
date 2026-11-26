# Zetenta

Panel de ventas, inventario, caja y finanzas para negocios venezolanos, con marca blanca por
subdominio (`<slug>.zetenta.app`). React 19 + Vite (SPA) sobre Supabase (Postgres con RLS, Edge
Functions, Storage). Todo el texto de la interfaz está en español de Venezuela.

## Flujo de trabajo

- Una rama por cambio a partir de `origin/main` y un PR con `gh`. Antes de commitear, revisa si el PR
  anterior ya se mergeó; si sí, rama y PR nuevos.
- Cambios de base de datos: migración nueva en `supabase/migrations/` y `supabase db push --linked`.
  Parte siempre de la definición vigente en la base (`pg_get_functiondef`), no de migraciones viejas.
  Pruébalas antes contra los datos reales dentro de `begin; … rollback;` con
  `supabase db query --linked -f <archivo>` simulando al usuario (`request.jwt.claims` +
  `set local role authenticated`).
- Datos de un negocio (alta de clientes, configuración): `supabase db query`, nunca una migración.
  Credenciales y material del cliente van en `entregas/` (ignorado por git), jamás en el repo.
- Estado de un negocio (`businesses.status`): quien se registra queda `pending` (ve "Solicitar prueba
  gratuita") hasta que el admin de la plataforma lo aprueba en Administración. Un alta manual por SQL
  debe dejar `status = 'active'`. `current_business_id()` solo resuelve negocios activos y
  `get_branding()` solo da la marca de los activos: cualquier otro host muestra la página genérica de
  "no encontrado" (sin marca de nadie).
- No se nombran plataformas de terceros en la documentación: se habla de "plataforma de referencia".

## Definición de terminado: UX/UI

Ninguna funcionalidad, pantalla, modal o módulo nuevo se da por terminado (ni se abre su PR) si no
cumple **todo** lo siguiente. Aplica también a lo que se toque de paso.

### 1. Nunca scroll horizontal
- Ninguna vista, modal, menú o formulario puede generar scroll horizontal en ningún ancho, ni de la
  página ni dentro de un contenedor. Nada de carruseles de chips o pestañas que se deslizan de lado.
- Lo que no cabe **baja de línea** (`flex-wrap`), **se trunca** con elipsis o `line-clamp` (nombres
  largos: máximo 2 líneas) o **cambia de patrón** en el teléfono: tablas → tarjetas, barras de
  pestañas largas → lista → detalle (como Negocio), filtros → un botón "Filtros".
- Grids y flex: columnas con `minmax(0, 1fr)` (nunca `1fr` a secas si el contenido puede ser largo) e
  hijos con `min-width: 0`. Textos sin espacios (SKU, nombres en mayúsculas, montos): `overflow-wrap: anywhere`.
- Se verifica a **320, 360 y 390 px** (y 1440 en escritorio).

### 2. Móvil primero
- Objetivos táctiles de al menos 40 px. Acciones principales al alcance y de ancho completo en el teléfono.
- Modales: en el teléfono son hojas desde abajo (`FinModal`); con scroll vertical interno, nunca lateral.
- Nada de `autofocus` en campos dentro de modales en pantallas táctiles (abre el teclado y tapa el
  contenido); solo con `(pointer: fine)`.
- Los modales que se abren desde el menú lateral se montan en `document.body` (`createPortal`): el
  `backdrop-filter` del menú los encierra.

### 3. Listas, búsqueda y datos
- Las listas que pueden crecer muestran un resumen (top N) y un "Ver todos (N)" que abre la lista
  completa en un modal con buscador. Nunca "y 191 más" sin forma de verlos.
- Buscadores: lupa, botón × para borrar, `Escape` limpia, sin distinguir mayúsculas ni acentos
  (`norm` de `lib/finance`), resaltan la coincidencia, dicen cuántos resultados hay y tienen estado
  vacío con "Borrar búsqueda".
- Todo número tiene contexto: período ("del 28 oct al 26 nov"), unidad, comparación con el período
  anterior cuando aplica. Montos con signo tipográfico (−$12,00) y cifras tabulares.
- Estados vacíos, de carga y de error cuidados en cada sección (qué pasa y qué hacer).

### 4. Coherencia visual
- Mismo nivel que la landing: columnas alineadas, menús ⋯ por fila, filtros agrupados, nada recargado.
- Reutiliza lo existente antes de crear: `finance.css`, `FinUI.jsx` (`FinModal`, `RowMenu`, `SortHead`,
  `Toast`), `.switch`, `.fin-tabs`, `.fin-kpis`, `useConfirm`. Colores por tokens (`--accent`,
  `--text-2`, `--border`…): la marca de cada negocio cambia `--accent`.
- Gráficos: una métrica a la vez (nunca dos ejes), barras ordenadas para comparar categorías, valor
  en texto y detalle al pasar el mouse o tocar.
- Accesibilidad: `aria-label` en botones de solo ícono, roles en selectores propios (`listbox`,
  `radiogroup`, `switch`), foco visible, contraste AA del color de marca sobre blanco.

### 5. Verificación antes del PR
- Capturas en **Chrome y WebKit (Safari)**, escritorio (1440) y teléfono (390), revisadas a ojo.
- Auditoría de desborde en el teléfono (320/360/390) de cada vista **y de sus estados**: formularios,
  modales, menús abiertos, búsquedas, el cobro del POS. Debe dar 0 en todos. Medición:

  ```js
  // En la página (Playwright: page.evaluate). Debe devolver { page: 0, out: [] }.
  () => {
    const vw = document.documentElement.clientWidth;
    const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
      if (getComputedStyle(p).overflowX !== 'visible') return true; return false; };
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (r.right > vw + 1 && !clipped(el)) out.push(`sale: ${el.className}`);
      if (['auto', 'scroll'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1
          && !['TEXTAREA', 'INPUT', 'SELECT'].includes(el.tagName)) out.push(`scroll interno: ${el.className}`);
    }
    return { page: document.documentElement.scrollWidth - vw, out };
  }
  ```
- Vista previa con datos de prueba: `node_modules/.harness` (ignorado por git; Vite con alias a mocks,
  `npx vite --config node_modules/.harness/vite.config.mjs --force`, puerto 5191). Prueba con datos
  extremos: nombres largos, cientos de productos, varias sucursales. Vite no ve cambios en
  `node_modules`: reinicia tras editar los mocks.
- Si algo de esta lista no se pudo verificar, se dice en el PR; no se da por hecho.
