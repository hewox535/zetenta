import { calcLine, calcTotals, money, formatDate } from '../lib/calc';

// Réplica exacta del formato oficial (Google Sheet original): una sola tabla
// de 15 columnas (A–O) con los mismos anchos, celdas combinadas, bordes,
// rellenos y textos. Se usa en pantalla y para imprimir / PDF (legal horizontal).

// Anchos de columna del sheet (unidades Excel convertidas a %)
const WIDTHS = [5.77, 6.64, 5.85, 6.25, 6.32, 5.22, 6.32, 6.32, 8.06, 6.32, 10.35, 4.66, 7.43, 6.4, 8.06];

export default function WithholdingPrint({ business, withholding }) {
  const lines = [...(withholding.withholding_lines || [])].sort((a, b) => a.line_number - b.line_number);
  const totals = calcTotals(lines);
  const rows = [...lines];
  while (rows.length < 5) rows.push(null); // el formato oficial muestra 5 filas

  const period = withholding.fiscal_period || '';

  return (
    <div className="comprobante">
      <table className="sheet">
        <colgroup>
          {WIDTHS.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
        </colgroup>
        <tbody>
          {/* Fila 1: nombre de la empresa sobre fondo azul */}
          <tr>
            <td colSpan={5} className="s-titulo">{business.name}</td>
            <td colSpan={10} />
          </tr>
          <tr style={{ height: 8 }}><td colSpan={15} /></tr>

          {/* Filas 3-5: texto legal + Nro. de comprobante + fecha */}
          <tr>
            <td colSpan={6} rowSpan={3} className="s-legal">
              LEY DE IVA ART.11 &quot;SERAN RESPONSABLES DEL PAGO DEL IMPUESTO EN CALIDAD<br />
              DE AGENTES DE RETENCION, LOS COMPRADORES O ADQUIRIENTES DE DETERMINADOS<br />
              BIENES MUEBLES E INMUEBLES Y LOS RECEPTORES DE CIERTOS SERVICIOS A QUIENES<br />
              LA ADMINISTRACION TRIBUTARIA DESIGNE COMO TAL&quot;
            </td>
            <td colSpan={4} className="b s-lbl-nro">Nro. DE COMPROBANTE</td>
            <td />
            <td colSpan={2} className="b negrita centro">1. FECHA</td>
            <td colSpan={2} />
          </tr>
          <tr>
            <td colSpan={4} className="b gris centro s-nro">{withholding.number}</td>
            <td />
            <td colSpan={2} className="b gris centro">{formatDate(withholding.issue_date)}</td>
            <td colSpan={2} />
          </tr>
          <tr><td colSpan={9} /></tr>
          <tr style={{ height: 32 }}><td colSpan={15} /></tr>

          {/* Filas 9-10: agente de retención, RIF y período fiscal */}
          <tr>
            <td colSpan={5} className="b negrita">2. NOMBRE O RAZON SOCIAL DEL AGENTE DE RETENCION</td>
            <td />
            <td colSpan={5} className="b negrita centro">3. REGISTRO DE INFORMACION FISCAL AGENTE DE RETENCION</td>
            <td colSpan={2} className="b negrita centro">4. PERIODO FISCAL</td>
            <td colSpan={2} />
          </tr>
          <tr>
            <td colSpan={5} className="b gris">{business.name}</td>
            <td />
            <td colSpan={5} className="b gris negrita">{business.rif}</td>
            <td colSpan={2} className="b gris centro">AÑO {period.slice(0, 4)}/{period.slice(4)}</td>
            <td colSpan={2} />
          </tr>
          <tr style={{ height: 12 }}><td colSpan={15} /></tr>

          {/* Filas 12-13: dirección del agente */}
          <tr>
            <td colSpan={11} className="bt negrita">5. DIRECCION FISCAL DEL AGENTE DE RETENCION</td>
            <td colSpan={4} />
          </tr>
          <tr>
            <td colSpan={11} className="bb gris">{business.fiscal_address}</td>
            <td colSpan={4} />
          </tr>
          <tr style={{ height: 12 }}><td colSpan={15} /></tr>

          {/* Filas 15-16: sujeto retenido y su RIF */}
          <tr>
            <td colSpan={6} className="bt negrita">6. NOMBRE O RAZON SOCIAL DEL SUJETO RETENIDO</td>
            <td />
            <td colSpan={6} className="b negrita centro">7. REGISTRO DE INFORMACION FISCAL DEL SUJETO RETENIDO</td>
            <td colSpan={2} />
          </tr>
          <tr>
            <td colSpan={6} className="bb gris negrita">{withholding.supplier_name}</td>
            <td />
            <td colSpan={6} className="b gris negrita">{withholding.supplier_rif}</td>
            <td colSpan={2} />
          </tr>
          <tr style={{ height: 22 }}><td colSpan={15} /></tr>

          {/* Fila 19: cabecera de la tabla de operaciones */}
          <tr className="t-head">
            <th>OPER.</th>
            <th>FECHA</th>
            <th>Nº DE FACTURA</th>
            <th>Nº DE CONTROL</th>
            <th>Nº NOTA DEBITO</th>
            <th>Nº NOTA CREDITO</th>
            <th>TIPO DE TRANS.</th>
            <th>Nº DOC AFECTADO</th>
            <th>TOTAL COMPRA CON IVA</th>
            <th>EXENTO</th>
            <th>BASE IMPONIBLE</th>
            <th>% ALICUOTA</th>
            <th>IMPUESTO I.V.A</th>
            <th>% DE RETENCION</th>
            <th>I.V.A RETENIDO</th>
          </tr>

          {/* Filas 20-24: operaciones (siempre 5 filas como el formato oficial) */}
          {rows.map((l, i) => {
            const c = l ? calcLine(l) : null;
            return (
              <tr key={i} className="t-fila">
                <td className="num">{l ? i + 1 : ' '}</td>
                <td>{l && formatDate(l.operation_date)}</td>
                <td className="num">{l?.invoice_number}</td>
                <td>{l?.control_number}</td>
                <td>{l?.debit_note}</td>
                <td>{l?.credit_note}</td>
                <td className="centro">{l?.transaction_type}</td>
                <td>{l?.affected_document}</td>
                <td className="num">{l && money(l.total_with_vat)}</td>
                <td className="num">{l && Number(l.exempt_amount) ? money(l.exempt_amount) : ''}</td>
                <td className="num">{l && money(c.base)}</td>
                <td className="num">{l && money(l.vat_rate)}</td>
                <td className="num">{l && money(c.vat)}</td>
                <td className="num">{l && `${Number(l.retention_rate)}%`}</td>
                <td className="num">{l && money(c.withheld)}</td>
              </tr>
            );
          })}

          {/* Fila 25: total compra + total IVA retenido */}
          <tr className="t-tot">
            <td colSpan={8} />
            <td className="b num">{money(totals.totalPurchase)}</td>
            <td className="b" />
            <td colSpan={4} className="tot-iva negrita centro">TOTAL IVA RETENIDO</td>
            <td className="tot-iva-val num">{money(totals.totalWithheld)}</td>
          </tr>
          <tr style={{ height: 10 }}><td colSpan={15} /></tr>

          {/* Fila 27: total a pagar */}
          <tr className="t-tot">
            <td colSpan={10} />
            <td colSpan={4} className="tot-pagar negrita">TOTAL A PAGAR. . . .</td>
            <td className="tot-pagar-val num negrita">{money(totals.totalPayable)}</td>
          </tr>

          {/* Filas 33-36: firmas */}
          <tr style={{ height: 60 }}><td colSpan={15} /></tr>
          <tr>
            <td colSpan={2} />
            <td colSpan={6} className="s-firma">POR LA EMPRESA</td>
            <td colSpan={7} className="s-firma">RECIBE:</td>
          </tr>
          <tr style={{ height: 29 }}><td colSpan={15} /></tr>
          <tr>
            <td colSpan={2} />
            <td colSpan={6} className="s-firma">{business.name}</td>
            <td colSpan={7} className="s-firma">FECHA DE RECEPCION</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
