# Facturación digital en Venezuela (Seniat): estado a noviembre de 2026

Investigación del 27 de noviembre de 2026 para decidir cómo Zetenta podría emitir facturas fiscales.

> **Advertencia:** se armó con prensa, consultoras y páginas de proveedores. **No se leyó el texto de las Gacetas.** Lo marcado **(por confirmar)** debe validarse con un contador y con el texto oficial antes de construir.

---

## 1. Resumen en una línea

Desde la nueva norma, una tienda puede facturar desde su propio sistema **sin máquina fiscal**. Para eso cada factura debe pasar por una **imprenta digital autorizada** por el Seniat, que le asigna el **número de control**.

- **No hace falta integrarse con el Seniat** (no publica una API).
- **Sí hay que integrarse con una imprenta digital.**
- **Ya no hace falta homologar el software.**

---

## 2. Normas y fechas

| Norma | Gaceta Oficial | Fecha | Qué hace |
|---|---|---|---|
| Providencia **SNAT/2024/000102** | N.º 43.032 | firmada 17-oct-2024, publicada 19-dic-2024 | Crea la factura por **medios digitales** y la figura de **imprenta digital autorizada**, que asigna los números de control. |
| Providencia **SNAT/2024/000121** | — | 2024 | Obligaba a que el software de facturación estuviera **homologado** por el Seniat y a darle al Seniat acceso directo al sistema y a su API (art. 3, literal h). **Derogada.** |
| Providencia **SNAT/2026/00084** | N.º 43.435 | 12-ago-2026, vigente de inmediato | **Deroga la 000121:** se acaba la homologación obligatoria del software. El Seniat anunció un "nuevo marco" para proveedores que aún no publica. |
| Providencia **SNAT/2026/00093** | N.º 43.484 | publicada 21-oct-2026 | **La máquina fiscal deja de ser obligatoria.** El contribuyente elige cómo facturar. 180 días continuos de adaptación. |
| Providencia **SNAT/2026/00099** | — | oct-2026 | Nuevos criterios para calificar contribuyentes especiales. Los emprendimientos nuevos no son especiales en sus primeros 3 años **(por confirmar)**. |

### Fechas clave

- **12 de agosto de 2026:** fin de la homologación obligatoria del software (00084).
- **21 de octubre de 2026:** se publica la 00093. Empiezan los 180 días de adaptación.
- **19 de abril de 2027:** **plena vigencia de la 00093.** Ese día quedan derogadas:
  - la Providencia **0071** de 2011 (facturas en papel y formas libres);
  - la Providencia **0141** (máquinas fiscales).

### Lo que cambia con la 00093

- **Opciones para facturar:**
  - medios digitales con una **imprenta digital autorizada**, usando el propio software;
  - el **portal o la app gratuita del Seniat**, pensados para pymes, sin API y con carga manual **(por confirmar)**;
  - **máquina fiscal**: quien ya la tiene puede seguir usándola.
- **Talonarios de papel:** quedan solo como **contingencia**, y hay que tenerlos en cada establecimiento.
- **Contradicción entre fuentes:** unas dicen que la **000102 sigue vigente sin cambios** y otras que quedó **integrada en la 00093** **(por confirmar)**.

### Antes y ahora

| Tema | Antes | Ahora |
|---|---|---|
| Tienda física | Máquina fiscal o formas libres de imprenta | Puede facturar desde su sistema con una imprenta digital |
| Software de facturación | Debía estar homologado (000121) | Sin homologación obligatoria (00084) |
| Acceso del Seniat al software | Clave de acceso al sistema y a su API | Ya no se exige |

---

## 3. Qué es la "homologación"

En este contexto, **homologar** era que el Seniat revisara y **aprobara un software o equipo de facturación** antes de que un negocio pudiera usarlo. El proveedor del sistema pedía la autorización y pasaba una evaluación técnica. También tenía que darle al Seniat una clave para consultar el sistema y su API.

- **Máquinas fiscales:** eran equipos homologados.
- **Software de facturación:** desde la 000121, también debía estarlo.

**La 00084 eliminó la homologación obligatoria del software.** Un sistema como Zetenta ya no necesita aprobación previa del Seniat. La factura sigue teniendo que cumplir los requisitos de forma y llevar el número de control de una imprenta digital.

---

## 4. Cómo funciona la factura digital (000102)

1. El sistema del negocio arma la factura y la **envía a la imprenta digital**, normalmente por API.
2. La imprenta **valida la estructura y los cálculos**.
3. La imprenta asigna el **número de control**, que es:
   - consecutivo y único por emisor;
   - formato: la frase "Nº de Control", un identificador de 2 dígitos y un secuencial de hasta 8 dígitos (ejemplo: `00-00000123`).
4. La imprenta **devuelve el documento** (PDF/A y XML, según los proveedores) y lo guarda. Una fuente habla de **10 años** de resguardo **(por confirmar)**.
5. El negocio entrega la factura a la clienta.

### Reglas que importan

- **Número de control:** sin el de una imprenta autorizada, la factura **no sirve para que el comprador deduzca el IVA** (art. 57 de la Ley del IVA, según una consultora) **(por confirmar)**.
- **Notas de crédito y de débito:** corrigen o anulan facturas emitidas. No se borra una factura emitida: se anula con nota de crédito.
- **Contingencia, si falla el sistema o la imprenta:**
  - se emite en el talonario de papel;
  - luego se carga al sistema y se avisa a la imprenta y a la Gerencia Regional de Tributos (al día hábil siguiente, según una fuente);
  - las fuentes no coinciden en el procedimiento exacto **(por confirmar)**.
- **Libro de Ventas:** si un negocio usa máquina fiscal y medio digital a la vez, cada uno se registra por separado.

### Contenido de la factura **(lista no oficial)**

Ninguna fuente transcribe el artículo de contenido. Según facturas de ejemplo de los proveedores:

- **Emisor:** razón social, RIF y domicilio fiscal.
- **Numeración:** número de factura (correlativo) y número de control (lo asigna la imprenta).
- **Comprador:** nombre o razón social, y RIF o cédula.
- **Fecha y hora** de emisión.
- **Por línea:** descripción, cantidad, precio unitario y total.
- **Impuestos:** base imponible e IVA por alícuota (16 % general; reducida y exento según el producto).
- **Moneda:** total en bolívares. Si se vende en divisas, la tasa BCV y su fecha.
- **Imprenta:** sus datos (RIF, providencia de autorización y rango de números asignado).
- **IGTF (3 % por pago en divisas):** no aparece en ninguna fuente revisada **(por confirmar con un contador)**.

---

## 5. ¿Hay que integrarse con el Seniat?

### La herramienta gratuita del SENIAT («Moda Seniat»)

- **Qué es:** el SENIAT anunció en octubre y noviembre de 2026 un portal web y una app móvil gratuitos para emitir facturas electrónicas, dirigidos a pequeños negocios, emprendedores y personas naturales. Reportan que permitiría facturar sin conexión y sincronizar después, ver el RIF y declarar impuestos.
- **Estado al 27-nov-2026:** **todavía no está disponible**. Se anunció para diciembre de 2026, sin fecha exacta.
- **Sin API:** según los reportes, la carga es manual (cliente, productos y alícuotas a mano). No sirve para que un sistema como Zetenta emita automáticamente: para eso sigue haciendo falta una imprenta digital.
- **Qué hacer cuando salga:**
  - revisarla con un usuario real del SENIAT (el dueño del negocio inicia sesión él mismo);
  - ver si exporta las facturas o si se puede usar como respaldo de contingencia.


- **No.** No se encontró ninguna API pública del Seniat para facturar. Su portal y su app gratuitos son de uso manual.
- **La integración es con una imprenta digital autorizada.** Cada imprenta tiene su propia API; no hay un estándar común.
- **Alternativa no recomendada para empezar:** que Zetenta sea imprenta digital. Exige:
  - autorización del Seniat (unos 30 días hábiles de trámite);
  - ser persona jurídica domiciliada en el país;
  - conexión permanente;
  - infraestructura de resguardo;
  - sistema de contingencia.

---

## 6. Imprentas digitales

La lista de imprentas revisadas (quién declara autorización, quién publica API y precios) está en `entregas/investigacion/imprentas-digitales.md`, fuera del repositorio. Resumen: solo una publica su API completa (REST con token, emisión de facturas, notas de crédito y débito, Libro de Ventas; cobra por documento); el resto ofrece integración bajo contacto.

---

## 7. Lo que ya tiene Zetenta y lo que falta

### Estado: beta, solo en Nácar

El módulo es la capacidad `invoicing` del negocio: la habilita la administración de la plataforma en Administración → Editar → Módulos («Facturación digital (beta)»). Sin ella no se ve nada de esto ni el servidor deja usarlo. Hoy está activa **solo en `nacar`** (la demo de pruebas).

### Ya implementado

Migraciones `20261202120000_fiscal_invoicing.sql` y `20261203120000_iva_igtf_debit_notes.sql`.

- **Activación (Negocio → Facturación):** asistente de 4 pasos con autoguardado.
  1. Tu negocio: persona natural o jurídica, contribuyente ordinario o especial, cómo factura hoy.
  2. Identidad y empresa: documentos según el tipo de persona y datos fiscales.
  3. Actividad: Certificado de Actividad del SENIAT (PDF) y logo.
  4. Revisar y firmar: resumen, borrador de la solicitud ante la Intendencia, firma, sello y autorización.

  Documentos en el bucket privado `fiscal-docs`. Estados: borrador → en revisión → activa (o «requiere cambios»).
- **Revisión (Administración → Facturación):** activar o pedir cambios con nota.
- **IVA por producto:** 16 %, 8 % o exento (16 % por defecto), congelado en cada línea vendida.
- **IVA e IGTF al cobrar (interruptores, como la plataforma de referencia):**
  - **IVA:** suma el IVA de cada producto encima del precio. Apagado, el precio se toma con IVA incluido y la factura lo separa.
  - **IGTF 3 %:** se cobra sobre lo que se paga en divisas; el monto en dólares lo trae incluido ($26,76 = $25,98 de la venta + $0,78 de IGTF).
  - Los descuentos de contado y especiales se calculan sobre el precio con IVA; los montos ya escritos se reajustan al tocar los interruptores.
  - La venta guarda `iva_added`, `iva_usd` (neto del descuento), `igtf_usd` e `igtf_base_usd`. El recibo muestra el IVA y el IGTF.
- **Facturas (`invoices`):** correlativo sin huecos por negocio y tipo; emisor y cliente congelados; totales en Bs por alícuota, descuento prorrateado, IGTF con su base; sin edición ni borrado.
- **Cobro:** interruptor «Factura fiscal» (exige cédula o RIF, y domicilio para empresas). Si la factura falla, la venta queda y se reintenta.
- **Detalle de la venta:** «Emitir factura» si salió sin factura.
- **Notas de crédito:** al anular una venta facturada sale sola; el administrador también la emite desde la factura.
- **Notas de débito:** desde la factura, con concepto, monto en Bs sin IVA y alícuota; correlativo propio.
- **Facturas (menú):** lista por mes y sucursal con buscador, KPIs y **Libro de Ventas en CSV** (las notas de crédito restan y las de débito suman).
- **Documento imprimible** (carta) con todos los campos; el número de control dice «Pendiente».

### Falta

1. **Conexión con la imprenta digital** (el paso que da validez fiscal): enviar cada documento al emitir, guardar `control_number`, `control_status = 'assigned'` y el PDF/XML en `provider_payload`, con reintentos idempotentes y `control_status = 'error'` si falla.
2. **Contingencia:** registrar las facturas hechas en talonario cuando no hay sistema y reportarlas.
3. **IGTF:** falta decidir con un contador si debe encenderse solo para contribuyentes especiales (agentes de percepción) y si va encendido por defecto.
4. **Valores por defecto:** los interruptores de IVA e IGTF arrancan apagados en cada venta. Falta una configuración por negocio («siempre sumar IVA»).
5. **Entrega por correo o WhatsApp** del PDF de la imprenta.
6. **Credenciales de la imprenta por negocio** (**por decidir:** cada negocio contrata la suya o Zetenta revende folios).
7. **Validación legal:** el borrador de la solicitud, la lista de campos y el IGTF, con un contador, contra las Gacetas 43.032 y 43.484.

### Resuelto después

- **Estadísticas sin impuestos:** las ventas netas, el estado de resultados, el gráfico por sucursal y el total contra gastos ya no cuentan el IVA sumado al cobrar; «Cómo se cobró» muestra el IVA y el IGTF cobrados aparte («es del SENIAT»).
- **Cierre del día:** el arqueo muestra cuánto del dinero del turno es IVA e IGTF (se cuenta igual, pero no es venta).
- **IGTF con vuelto:** el 3 % se calcula solo sobre lo pagado en divisas que se queda en la venta. Ejemplo: venta de $32,48 pagada con un billete de $50 → IGTF $0,97 (no $1,46) y vuelto $16,55. Migración `20261204120000_igtf_sin_vuelto.sql`.
- **Cashea con IVA:** probado. $32,48 con IVA = $19,49 financiados + $12,99 de inicial; con IGTF, la inicial en dólares sale en $13,38 y el IGTF es $0,39. La factura cuadra (Bs 13.148 a 400 Bs/$).

### Próximos pasos

1. Que un contador confirme con las Gacetas 43.484 y 43.032:
   - la lista de campos;
   - el IGTF;
   - si una tienda física está **obligada** o solo **puede** facturar digitalmente, y desde cuándo.
2. Pedir documentación de API, ambiente de pruebas y tarifas a 2 imprentas (ver la lista en entregas/).
3. Decidir el modelo comercial: cada negocio paga sus folios, o Zetenta los revende dentro de su plan.
4. Conectar la imprenta elegida (punto 1 de "Falta") antes del **19 de abril de 2027**.

---

## Fuentes

- [El Pitazo: facturación digital y contribuyentes especiales](https://elpitazo.net/economia/facturacion-digital-y-alivio-a-contribuyentes-especiales-que-cambia-con-las-recientes-medidas-del-seniat/)
- [El Pitazo: Consecomercio sobre las nuevas providencias](https://elpitazo.net/economia/consecomercio-nuevas-providencias-del-seniat-avanzan-a-la-simplificacion-y-automatizacion-de-tramites/)
- [Finanzas Digital: se levanta el uso obligatorio de máquinas fiscales](https://finanzasdigital.com/seniat-levanta-uso-obligatorio-maquinas-fiscales-gaceta-oficial/)
- [Finanzas Digital: se deroga la obligación de sistemas homologados](https://finanzasdigital.com/seniat-deroga-norma-sobre-proveedores-de-sistemas-fiscales/)
- [Finanzas Digital: Gaceta 43.032 (Providencia 000102)](https://finanzasdigital.com/gaceta-oficial-n-43-032-medios-digitales-emision-facturas/)
- [2001 Online: nuevas normas, plazos](https://2001online.com/nacionales/seniat-fija-nuevas-normas-de-facturacion-digital-para-comercios-plazos-y-como-funcionan-202610251500)
- [Consultores WHB: guía de la Providencia 00093](https://www.consultoreswhb.com/guia-definitiva-Facturacion-digital-SENIAT-2026/)
- [Contrapunto: derogada la exigencia de sistemas homologados](https://contrapunto.com/economia/impuestos/seniat-derogo-la-exigencia-de-sistemas-homologados-para-facturacion-electronica/)
- [Banca y Negocios: normas para facturar por medios digitales (2025)](https://www.bancaynegocios.com/claves-estas-son-las-normas-que-impone-el-seniat-para-facturar-por-medios-digitales/)
- [IVECOFI: texto de la Providencia 000102](https://tributos.ivecofi.net/informacion/legislacion/providencias/pa-2024-102)
- [Qué Pasa: la app de facturación del Seniat](https://www.quepasa.com.ve/economia/la-app-de-facturacion-que-promete-el-seniat-lo-que-se-sabe-y-lo-que-cambiaria-para-las-pymes/)
