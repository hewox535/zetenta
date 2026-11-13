# Benchmark: plataforma de referencia vs Zetenta

> Prueba de punta a punta de un sistema de gestión de la competencia (la **plataforma de referencia**), hecha el 12-11-2026 para sacar ideas de funcionalidad y de UX para Zetenta.
> Se probó como lo usaría un dueño de negocio: se cargaron productos, se hicieron ventas, se abrió y cerró la caja, se registraron gastos, cobros, salidas de inventario, etc.

---

## 0. Qué se hizo en la referencia (datos de prueba que quedaron en esa cuenta)

| Acción | Resultado en la referencia |
|---|---|
| Producto simple: *Parabrisas Toyota Corolla 2015* (10 und, costo $80, margen 50 % → precio $160, SKU, categoría y ubicación nuevas, stock de seguridad 3) | Creado. El onboarding subió a 50 % |
| Producto con variaciones: *Vidrio puerta delantera Aveo* (Izquierdo 4 / Derecho 3, costo $25, precio $45), comprado **a crédito** al proveedor *Distribuidora Vidrios C.A.* a 15 días | Creado. Se generó sola una **cuenta por pagar** de $175 |
| Cliente nuevo creado desde el POS (*Cliente Prueba Taller*, V-12345678) | Creado sin salir del POS |
| Venta #1: parabrisas + vidrio izq., **con IVA**, **pago combinado** Bs + $ | $237,80, observación incluida |
| Venta #2: vidrio der., **a crédito** a 7 días | Se generó sola una cuenta por cobrar de $45 |
| Habilitar cierre de caja → abrir caja con 50.000 Bs → gasto de $12 pagado en Bs → cerrar contando 39.000 Bs | Cierre con diferencia de −146,60 Bs, con detalle |
| Abono parcial de $20 a la cuenta por cobrar | Recibo de cobro imprimible |
| Salida de inventario: 1 parabrisas «Vencido o dañado» | Generó solo un **gasto** de $80 en «salida de inventario» |
| Preguntas al asistente IA | Respondió con datos reales (y con algunos errores, ver §5) |

No se envió ninguna campaña, no se creó ningún usuario ni se compró nada.

---

## 1. Resumen: las 12 ideas de más valor

Ordenadas por impacto para nuestro cliente (comercio venezolano, multimoneda) y por lo que nos cuesta hacerlas.

| # | Idea | Por qué importa | Esfuerzo |
|---|---|---|---|
| 1 | **Compra de inventario conectada a cuentas**: al cargar mercancía se elige *No registrar pago / Pago de contado (sale de una cuenta) / Cuenta por pagar al proveedor con días de vencimiento* | Hoy el inventario y las finanzas van por separado. En la referencia una compra crea sola la CxP o el egreso, y el capital y la utilidad cuadran | M |
| 2 | **Salida de inventario con motivo → gasto automático** (merma, dañado, robo, consumo del dueño, regalo, devolución a proveedor, préstamo, error de carga) | Las pérdidas aparecen en la utilidad sin que nadie tenga que acordarse de anotarlas | S |
| 3 | **Cierre de caja «a ciegas»**: no mostrar lo esperado hasta que el cajero declara lo contado | Evita que el cajero «ajuste» el conteo. Nosotros mostramos «Sobra/Falta» en vivo mientras cuenta | S |
| 4 | **Detalle del cierre como línea de tiempo** por método: Apertura, Entradas (n), Salidas (n), Esperado, Contado, Diferencia, con cada movimiento listado | Explica *por qué* no cuadró | M |
| 5 | **Utilidad/Pérdida con «pérdida cambiaria»** + **Capital** (inventario + bancos + CxC − CxP) | Es la pregunta clave del dueño en Venezuela: «¿gané o la tasa se comió la ganancia?» | M–L |
| 6 | **IVA e IGTF (3 %) en la venta**, con interruptor en el checkout y desglose de IVA por línea | Muchos comercios lo necesitan para facturar. Nosotros solo manejamos retenciones | M |
| 7 | **Facturas leídas con IA** (foto o PDF de la factura del proveedor → revisar ítems → confirmar entrada al inventario), con una guía visual de cómo tomar la foto | Es el mayor ahorro de tiempo al cargar mercancía. La referencia lo destaca como «Nuevo» | L |
| 8 | **Asistente IA** con conversaciones guardadas, prompts sugeridos y respuestas con tablas | Diferenciador. Ojo: comete errores (§5) | L |
| 9 | **Campañas segmentadas a clientes** (activos/inactivos a 60 días, top N % por facturación, compradores de un producto o categoría, con deuda, cuentas por vencer o vencidas, personalizado) | Convierte la base de clientes en ventas. La referencia cobra los SMS aparte | L |
| 10 | **Onboarding con checklist** («Primeros pasos» 4 tareas, % en el header, se completa solo al hacer cada cosa) + tour guiado en el POS | Activación de cuentas nuevas | S |
| 11 | **Productos «hot» con días de inventario restantes** (stock ÷ ventas/día de 30 días → Críticos/Atención/OK) | Alerta de reposición mucho más útil que un umbral fijo | S |
| 12 | **Precios por canal de venta + cambio masivo de precios** (subir/bajar % o monto fijo o *fijar margen*, por categoría y canal) | Ajustar precios por inflación en un clic | M |

---

## 2. Comparativa por módulo

Leyenda: ✅ lo tenemos · 🟡 parcial · ❌ no lo tenemos · ⭐ lo hacemos mejor que la referencia

| Área | Capacidad en la referencia | Zetenta |
|---|---|---|
| **Onboarding** | Checklist de 4 pasos con % y tiempo estimado, siempre visible en el header. Tour guiado de 5 pasos en el POS. «Novedades» en el home | ❌ |
| **Acciones globales** | Botones fijos «Vender» y «Agregar gasto» en el header, desde cualquier pantalla | 🟡 (por menú) |
| **Dashboard** | KPIs del mes vs. mes anterior (facturación, ticket promedio, órdenes del día vs. ayer, utilidad neta), stock bajo, más vendidos, CxP/CxC por vencer, gráfico utilidad vs. facturación | 🟡 (Estadísticas) |
| **Alta de producto** | Costo unitario ↔ costo total y precio ↔ % sincronizados, «Utilidad estimada» en vivo, categoría y ubicación creadas en el mismo campo, IVA por producto (exento/8/16/31 %), fecha de vencimiento, stock de seguridad, descripción | ✅ ⭐ (fotos, variantes por ejes, catálogo público) |
| **Lotes y costeo** | Cada entrada es un lote con su costo. Costeo **FIFO o promedio ponderado** a elegir. Unir y dividir lotes | ❌ |
| **Reponer ítems** | Pestaña «Reponer items» dentro del mismo modal | ✅ (entradas) |
| **Compra → cuentas** | La compra genera una CxP al proveedor o un egreso de una cuenta | ❌ (idea #1) |
| **Salidas con motivo** | 9 motivos estándar + detalle, muestra el costo de la salida y genera un gasto | 🟡 (salida con nota, sin gasto automático) |
| **Traslados** | Entre ubicaciones, con historial | ✅ (sucursales) |
| **Recetas/combos** | Recetas por tanda (rendimiento), sub-recetas, «fabricar» suma lo producido al inventario | ❌ |
| **Servicios** | Catálogo de servicios con costo y precio, vendibles en el POS (ej.: instalación) | ❌ — **relevante para talleres** |
| **Carga masiva** | Excel de inventario, de precios y de clientes | ✅ (CSV) |
| **POS: búsqueda** | Chips de categorías, buscador, **escáner de código de barras con cámara**, sección «Recientes» | 🟡 (sin escáner) |
| **POS: vista** | «Personalizar vista»: mostrar descripción/SKU, ocultar agotados. Interruptor $/Bs | 🟡 |
| **POS: cotización** | «Descargar cotización» (PDF) desde el carrito | ❌ |
| **Checkout** | Fecha del pedido editable (ventas atrasadas), número de pedido editable, editar el precio de una línea en $ o Bs, observaciones con «recordar para próximos pedidos» | 🟡 |
| **Pagos** | Métodos como tarjetas, pago combinado de 2/3/4 métodos con reparto automático, referencia por método | ✅ ⭐ (Cashea con inicial, descuento de contado) |
| **Crédito** | Venta a crédito con días de vencimiento, todo a CxC (sin inicial) | ✅ ⭐ (nosotros permitimos abono inicial) |
| **Cargos extra** | Servicios adicionales en el pedido (delivery, comisión) ligados a «personal», con un ranking de comisiones por pagar | ❌ |
| **Descuentos** | Solo códigos promocionales (con límite de uso) | 🟡 ⭐ (ofertas y descuento de contado). ❌ códigos |
| **Impresión** | Carta / 80 mm / 58 mm | 🟡 (una sola plantilla) |
| **Mesas** | Salas con mesas y pedidos abiertos | ❌ (no aplica a nuestro nicho actual) |
| **Registro de ventas** | KPIs del rango, barra de métodos de pago, **columnas configurables** (mostrar/ocultar y reordenar arrastrando) | ✅ 🟡 (sin columnas configurables) |
| **Caja** | Interruptor «Abrir caja» fijo en el sidebar, apertura por método, cierre a ciegas en 2 pasos, historial con diferencia, detalle con línea de tiempo | ✅ 🟡 (sin conteo a ciegas ni línea de tiempo) |
| **Cuentas bancarias** | Totales Bs, USD y general; métodos de pago asociados a cada cuenta; transferir entre cuentas; ingresar/retirar saldo | ✅ |
| **CxC/CxP** | Agrupadas por cliente/proveedor, días restantes, «Cobrar todo» o por documento, abono parcial con recibo imprimible, pestaña Cashea | ✅ 🟡 (sin recibo de abono) |
| **Gastos** | Fijo/variable, 11 categorías, pago con varios métodos, tasa editable, filtros por mes y año | ✅ ⭐ (gastos fijos recurrentes) |
| **Utilidad/Pérdida** | Ingresos − costo − gastos con «vs. mes anterior», **pérdida cambiaria**, **capital** | 🟡 (sin cambiaria ni capital) |
| **Reportes** | Por rango de fecha **y hora** + por usuario; pestañas Pedidos/Cuentas/Métodos/Inventario; exportables | 🟡 |
| **Estadísticas** | Ventas, inventario y finanzas; buscador de un producto con sus stats; top clientes; días de inventario restantes | ✅ 🟡 |
| **Clientes** | Producto más comprado, última orden, ticket promedio, deuda, activo/inactivo | 🟡 |
| **Campañas** | Asistente de 3 pasos con segmentos, saldo de mensajes | ❌ |
| **Usuarios y permisos** | **72 permisos** agrupados por módulo y por tipo (Ver / Crear y editar / Eliminar o mover dinero), con buscador; ubicaciones por usuario. Ej.: «Cambiar precio en la venta», «Registrar pedidos con fecha anterior», «Realizar devoluciones», «Abrir/Cerrar caja» | 🟡 (permisos por módulo) |
| **Preferencias** | Datos y logo del recibo, método de costeo, margen vs. utilidad, tasa BCV USD/EUR o manual, IVA/IGTF, estatus de pedido, reiniciar inventario o comercio | ✅ |
| **IA** | Asistente de chat y lectura de facturas | ❌ |
| **Ayuda** | Botón «Ayuda» en cada pantalla, chat de soporte (Intercom), «Comparte tu idea», tooltips (?) en cada KPI | 🟡 |
| **Monetización** | Planes, paquetes de SMS, referidos («Invita y gana»), préstamos  | — |
| **Fiscal (retenciones)** | Menú «Fiscal» roto (redirige con error) | ✅ ⭐ (retenciones de IVA con formato oficial) |
| **Catálogo público** | No tiene | ✅ ⭐ |
| **Fotos de producto** | El formulario de producto no tiene campo de imagen | ✅ ⭐ |

---

## 3. Aprendizajes de UX (lo que hace bien la referencia)

1. **Todo se crea en el mismo campo.** Categoría, ubicación, proveedor y cliente se crean escribiéndolos en el combobox («+ Nueva: "Laterales"» y el aviso *«La categoría se creará al guardar el ítem»*). Nunca hay que salir del flujo.
2. **Cálculo en vivo y en ambos sentidos.** Costo unitario ↔ costo total; precio ↔ % de margen; monto $ ↔ Bs. Más la «Utilidad estimada: $80» en el encabezado del formulario.
3. **El formulario muestra primero lo esencial.** Lo básico arriba y en acordeones opcionales *Variaciones*, *Campos avanzados* e *Información de pago*.
4. **La cantidad del producto es la suma de sus variaciones**, sin escribirla dos veces.
5. **Cada acción tiene consecuencias contables explícitas, y lo dice.** El toast de la salida de inventario dice *«Se registró un gasto variable de $80 en "salida de inventario"»*. El usuario aprende cómo funciona el sistema.
6. **Educación en contexto.** Las configuraciones complejas se explican con pasos numerados (el cierre de caja tiene un bloque «¿Cómo funciona?» de 5 pasos). Hay ejemplos numéricos («Venta $2, Costo $1, Ganancia $1» y «Precio $10 + 50 % → $15»).
7. **El estado de la caja siempre está visible.** El interruptor «Caja abierta» está fijo arriba del menú lateral.
8. **Selector de variación como modal** con el stock de cada una al tocar el producto en el POS.
9. **Pantalla de éxito clara.** «¡Pedido completado!» con resumen, las 3 opciones de impresión y «Nuevo pedido» como acción principal.
10. **Columnas configurables y reordenables** en tablas grandes (registro de pedidos).
11. **Tarjetas de KPI con comparación** («vs. mes anterior», «vs. ayer») y tooltip (?) que explica cada métrica.
12. **Configurar al momento de usar.** Al entrar a Caja sin tenerla habilitada aparece un modal «¡Nuevo! Cierre de caja» con un enlace a un video y un botón «Ir a configuración».

---

## 4. Lo que hacemos mejor (no perder al copiar)

- **Cashea completo**: % de inicial, recálculo al cambiar el monto del otro método y precio de lista. La referencia solo tiene «Cashea Link» y una pestaña de CxC.
- **Venta a crédito con abono inicial.** La referencia manda el 100 % a CxC.
- **Descuento de contado y ofertas en lote.** La referencia solo tiene códigos promocionales.
- **Retenciones de IVA** con comprobante en formato oficial. Su módulo «Fiscal» está roto.
- **Catálogo público y fotos de producto.** La referencia no tiene ni catálogo ni imagen de producto.
- **Gastos fijos recurrentes** con próximo pago.
- **Sesiones, PIN y notificaciones push.**
- **Consistencia de datos.** No normalizamos mal los textos (ver errores de la referencia abajo).

---

## 5. Errores y debilidades de la referencia (para no repetirlos)

| Dónde | Problema |
|---|---|
| Registro de pedidos | La barra de «Métodos de pago» reparte la venta **sin IVA** ($102,50 + $102,50) cuando de verdad se cobraron $118,90 por método. **Mezcla bases con y sin impuesto** en la misma pantalla y en Estadísticas |
| Formularios | **Normaliza mal los textos**: los nombres de producto pasan a Title Case, las observaciones también («Venta De Prueba - Instalacion Incluida»), y los gastos y los productos aparecen en minúsculas en los detalles. El texto del usuario hay que guardarlo tal cual |
| Alta de producto | El % muestra «44,44444» sin redondear. La «Utilidad estimada» del encabezado muestra la unitaria aunque haya 7 unidades. El texto «Dato importante» habla de «este servicio» en un formulario de producto |
| CxC/CxP | Vencimiento de 7 días → «Quedan 6 días»; de 15 → «Quedan 14» (error de uno) |
| Recibo de abono | Dice «Restante a pagar: 0» cuando quedan $25 y la columna de método de cobro está vacía |
| Cobro de CxC | Ofrece «CUENTA POR COBRAR» como método para cobrar una cuenta por cobrar |
| Historial de cuentas | Montos sin redondear («BS 107,538.92665», tasa «904.4485»), formato de miles distinto al resto, y el texto «No hay registros… en dicho mes» aparece junto a 4 registros |
| Valor de inventario | El chip «Valor en inventario» no se actualizó tras la salida ($845 en vez de $765) |
| Estadísticas | Eje Y con etiquetas repetidas («2 uds. 2 uds. 2 uds. 1 uds.»), «Granularidad: day» sin traducir, puntitos rojos donde va un sparkline vacío, «Top cuentas por pagar» incluye clientes (que son por cobrar) |
| Dashboard | «CxP/CxC próximas a vencerse: no hay» con cuentas que vencen en 6 y 14 días (no dice cuál es el criterio) |
| Asistente IA | **Alucinó**: dijo que el vidrio estaba bajo el stock mínimo (no tenía mínimo) y que se vendió 1 unidad (fueron 2). Una IA que responde con números tiene que basarse en datos y mostrar la consulta o el período usado |
| Lectura con IA | Al entrar apareció un toast rojo de error vacío |
| Menú | «Fiscal» y «Comandas» redirigen con «Error: No se encontró el comercio»; «Cotizaciones», «Proveedores» y «Cashea Link» están en el DOM pero ocultos |
| Errores de texto | «Codigos de descuento», «Cantidadad usada», «Utlidad vs Facturación», «proporcion» |
| Layout | La burbuja de Intercom tapa el botón «Descargar cotización» y el borde de «Finalizar pedido» |
| Descuentos | No se puede dar un descuento puntual (en % o monto) en el checkout, solo con un código |
| Carga | Densidad de información alta y muchos banners de venta cruzada (préstamos, referidos, planes) que compiten con la tarea |

---

## 6. Backlog sugerido

### P1. Alto impacto, esfuerzo bajo o medio
1. **Salida de inventario con motivo estándar → gasto automático** (merma, dañado, robo, consumo propio, regalo, devolución a proveedor, préstamo, error de carga). Mostrar «Costo de la salida: $X» antes de confirmar.
2. **Entrada de inventario con forma de pago**: *No registrar / Contado (cuenta) / Por pagar a proveedor + días*. Conectar con `Suppliers` y `Accounts`.
3. **Conteo a ciegas en el arqueo** (`components/CashToggle.jsx`): ocultar el esperado hasta confirmar lo contado, y después mostrar la diferencia. Opcional por negocio.
4. **Detalle del cierre**: línea de tiempo de movimientos por método más las tarjetas Apertura/Entradas/Salidas/Esperado/Contado/Diferencia.
5. **Recibo imprimible de abono a CxC** (con saldo restante correcto).
6. **Checklist de onboarding** (producto, cuenta, primera venta, tasa) que se marca solo.
7. **Días de inventario restantes** en Estadísticas e Inventario (Críticos/Atención/OK).
8. **Comparación con el período anterior** en los KPIs de Estadísticas.

### P2. Diferenciadores
9. **IVA e IGTF en la venta** (interruptor + desglose por línea), coherentes en todos los reportes (definir bien *facturación sin impuesto* vs. *total cobrado*).
10. **Pérdida cambiaria y capital** en el resumen financiero.
11. **Servicios** vendibles en el POS (instalación, mano de obra), con costo opcional.
12. **Cotización PDF** desde el carrito y fecha de venta editable (con permiso).
13. **Cambio masivo de precios** por categoría (%, monto o fijar margen).
14. **Permisos más finos** en acciones sensibles: cambiar precio en la venta, venta a crédito, fecha anterior, eliminar venta, abrir/cerrar caja.
15. **Escáner de código de barras** con la cámara en el POS.
16. **Impresión térmica 58/80 mm** además de carta.

### P3. Grandes apuestas
17. **Lectura de facturas de proveedor con IA** → borrador de entrada de inventario para revisar.
18. **Asistente IA** sobre los datos del negocio, con respuestas que citen período y fuente para no inventar.
19. **Campañas por segmento** (WhatsApp) usando datos que ya tenemos: inactivos, deudores, compradores de un producto.
20. **Lotes y costeo FIFO o promedio ponderado** (solo si los clientes lo piden; tiene mucho impacto en el modelo de datos).
21. **Recetas/combos con fabricación** (solo para el nicho de alimentos).

---

## 7. No probado / pendiente

- La vista móvil de la referencia (todo se probó en escritorio).
- Imprimir y descargar PDFs (abren el diálogo del navegador).
- Ingreso por Excel, lectura de facturas con IA (no había archivo para subir) y recetas (requieren insumos).
- Cotizaciones, Proveedores, Cashea Link, Fiscal y Comandas (ocultos o no disponibles en esta cuenta).
- Envío real de campañas, creación de usuarios y compras (se evitaron a propósito).

---

## 8. Propuesta: módulo de Estadísticas (siguiente foco)

### Cómo lo tiene la referencia
Dos módulos separados en el menú:
- **Resumen financiero**: *Utilidad/Pérdida* por mes o año (Ingresos → Costo de lo vendido → Utilidad bruta → Gastos fijos y variables → Utilidad neta → Pérdida cambiaria), cada línea con «vs. mes anterior», más un gráfico anual. Incluye *Reportes* por rango de fecha y hora.
- **Estadísticas**: pestañas General / Ventas / Inventario / Finanzas con rango de fechas.

La pestaña *Finanzas* de Estadísticas repite casi todo el Resumen financiero (ingresos, costos, gastos, utilidad bruta y neta), y cada módulo tiene su propio selector de fechas. El usuario tiene que adivinar dónde buscar la utilidad.

### Decisión recomendada: un solo módulo con pestañas
**Estadísticas**, con un selector de período compartido arriba y estas pestañas:

| Pestaña | Contenido |
|---|---|
| **Resumen** | KPIs del período vs. período anterior, ventas por día y alertas (sin costo, por agotarse) |
| **Ventas** | Más y menos vendidos, buscador de producto, métodos de pago, ingreso por cuenta y moneda, top clientes |
| **Inventario** | Días de inventario restantes, baja rotación, valor del inventario (costo y precio) |
| **Utilidad** | Estado de resultados completo (lo que la referencia llama «Resumen financiero») |

Por qué:
- **Un solo lugar y un solo filtro de fechas.** Se elige el período una vez y vale para todas las pestañas.
- **Permisos por pestaña.** Un vendedor puede ver *Ventas* sin ver *Utilidad*. Ese es el único motivo real para separar, y se resuelve con permisos, no con otro módulo.
- **Una ruta por pestaña** (`/stats/ventas`, `/stats/utilidad`), para enlazar y recordar la última vista.
- Menos entradas en el menú.

### Qué hacer primero (fase 1) — ✅ implementada el 13-11-2026
Además se adelantó de la fase 2: días de inventario restantes, valor del inventario al costo y a precio de venta, gastos por categoría, el gráfico por hora/día/semana/mes y exportar por pestaña.

1. **Selector de período**: se mantienen *Hoy, 7 días, 30 días, Este mes, Todo* y se agregan *Mes anterior* y **Personalizado (desde/hasta)** con calendario. El período queda en la URL y se muestra el rango exacto («1 nov – 13 nov»). Se usan días completos en la hora del negocio.
2. **Comparación con el período anterior** del mismo largo en cada KPI (▲/▼ y %).
3. **Pestaña Utilidad con utilidad neta real.** Hoy la tarjeta «Utilidad» es *cobrado − costo de lo vendido* y **no resta los gastos**, así que sobrestima la ganancia. Cascada: Ingresos → Costo de lo vendido → **Utilidad bruta** → Gastos (fijos/variables por categoría) → **Utilidad neta**, con margen %. Los datos ya existen (`fetchExpenses`).
4. **Facturado vs. cobrado vs. por cobrar.** Hoy los ingresos solo cuentan los pagos hechos al momento de la venta. Las ventas a crédito y Cashea y los abonos posteriores (`debt_payments`) tienen que reflejarse con claridad.
5. **Reorganizar lo actual en pestañas** (Resumen / Ventas / Inventario / Utilidad).

### Fase 2
- Días de inventario restantes (stock ÷ venta diaria de 30 días) con niveles Crítico / Atención / OK.
- Ventas por categoría y top clientes.
- Buscador de producto con sus estadísticas (unidades, ingresos, utilidad, margen, tendencia).
- Gastos por categoría con su evolución.
- Gráfico anual mes a mes (ingresos vs. utilidad neta).
- Exportar el período (CSV/PDF).

### Fase 3
- Pérdida o ganancia cambiaria y vista de capital (inventario + bancos + por cobrar − por pagar).
- Agregación en el servidor (RPC/vista SQL). Hoy se descargan todas las órdenes del período al navegador, y con rangos largos o «Todo» se pone lento.

### Errores de la referencia que no hay que repetir
- Mezclar montos con y sin IVA en la misma vista. Cada número dice su base.
- Etiquetas sin traducir («Granularidad: day»), ejes con valores repetidos y gráficos vacíos que se ven como errores.
- Mostrar una deuda de cliente bajo «por pagar».
