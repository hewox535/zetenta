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

### Ya implementado (migración `20261202120000_fiscal_invoicing.sql`)

- **Activación (Negocio → Facturación):** asistente de 4 pasos con autoguardado.
  1. Tu negocio: persona natural o jurídica, contribuyente ordinario o especial, cómo factura hoy.
  2. Identidad y empresa: documentos según el tipo de persona y datos fiscales (razón social, RIF, representante, domicilio, actividad principal).
  3. Actividad: Certificado de Actividad del SENIAT (PDF) y logo de la factura.
  4. Revisar y firmar: resumen, borrador de la solicitud ante la Intendencia armado con los datos, firma (dibujada o imagen), sello y autorización.

  Los documentos van a un bucket privado (`fiscal-docs`, carpeta = negocio). Estados: borrador → en revisión → activa (o "requiere cambios" con nota).
- **Revisión (Administración → Facturación):** el equipo de Zetenta ve datos y documentos y activa o pide cambios.
- **IVA por producto:** alícuota 16 %, 8 % o exento (16 % por defecto). El precio incluye el IVA; la alícuota queda congelada en cada línea vendida.
- **Facturas (`invoices`):**
  - numeración correlativa sin huecos por negocio y tipo (factura, nota de crédito, nota de débito);
  - datos del emisor y del cliente congelados al emitir;
  - líneas con código, descripción, cantidad, precio y alícuota;
  - totales en bolívares por alícuota (exento, base e IVA 16 %, base e IVA 8 %), descuento prorrateado y equivalente en dólares con la tasa de la venta;
  - nadie las puede editar ni borrar (sin políticas de escritura; solo funciones del servidor).
- **Cobro:** interruptor "Factura fiscal" (activo por defecto). Exige cédula o RIF y, para empresas (J, G, C), domicilio fiscal. Si la factura falla, la venta queda y se reintenta.
- **Detalle de la venta:** "Emitir factura" para una venta que salió sin factura.
- **Anulación:** al anular una venta facturada se emite sola la nota de crédito; el administrador también puede emitirla desde la factura.
- **Facturas (menú):** lista por mes y sucursal con buscador, KPIs (facturado, base, IVA débito fiscal) y **Libro de Ventas en CSV**.
- **Documento imprimible** (carta) con todos los campos; el número de control aparece como "Pendiente".

### Falta (último paso: la imprenta digital)

1. **Conexión con la imprenta:** una función del servidor que, al emitir, envíe la factura a la imprenta, guarde `control_number`, `control_status = 'assigned'` y lo que devuelva (PDF/XML) en `provider_payload`, con reintentos idempotentes y `control_status = 'error'` si falla. La tabla ya tiene esos campos.
2. **Contingencia:** registrar facturas del talonario de papel y reportarlas.
3. **IGTF (3 % en pagos en divisas):** las columnas existen (`igtf_base_ves`, `igtf_ves`), pero el cobro no lo calcula. **Por confirmar con un contador** para qué negocios aplica.
4. **Notas de débito:** el tipo y su correlativo existen; falta la pantalla.
5. **Entrega por correo o WhatsApp** del PDF de la imprenta.
6. **Precios sin IVA:** hoy se asume que el precio de venta incluye el IVA.
7. **Credenciales por negocio:** dónde guardar las de la imprenta (**por decidir** si cada negocio contrata la suya o Zetenta revende folios).

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
