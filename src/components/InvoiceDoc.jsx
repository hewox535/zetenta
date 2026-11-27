import { bs, usd, money } from '../lib/calc';
import { DOC_TITLES, invoiceNo } from '../lib/fiscal';
import './invoices.css';

const dateVE = (iso) => new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Caracas' });
const timeVE = (iso) => new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' });
const qty = (q) => Number(q).toLocaleString('es-VE', { maximumFractionDigits: 3 });

// Factura, nota de crédito o de débito con todo lo que pide la norma
// (Providencia SNAT/2024/000102 y SNAT/2011/0071):
//   * emisor: razón social, RIF y domicilio fiscal;
//   * documento: tipo, número correlativo, número de control, fecha y hora;
//   * cliente: nombre o razón social, RIF o cédula y domicilio;
//   * líneas: descripción, cantidad, precio y monto, con su alícuota;
//   * totales en bolívares por alícuota, y el equivalente en divisas con la tasa BCV.
// related: la factura afectada (para notas).
export default function InvoiceDoc({ inv, logoUrl, related }) {
  const isNote = inv.doc_type !== 'factura';
  const lines = inv.lines || [];
  const subtotal = lines.reduce((s, l) => s + Number(l.amount_ves || 0), 0);
  const disc = Number(inv.discount_ves) || 0;
  const pendingControl = inv.control_status !== 'assigned' || !inv.control_number;

  return (
    <article className="inv-doc" aria-label={`${DOC_TITLES[inv.doc_type]} ${invoiceNo(inv.number)}`}>
      <header className="inv-head">
        <div className="inv-issuer">
          {logoUrl && <img className="inv-logo" src={logoUrl} alt="" />}
          <strong className="inv-legal">{inv.issuer?.legal_name}</strong>
          <span>RIF {inv.issuer?.rif}</span>
          <span>{inv.issuer?.fiscal_address}{inv.issuer?.city ? `, ${inv.issuer.city}` : ''}</span>
          {inv.issuer?.phone && <span>Tel. {inv.issuer.phone}</span>}
        </div>
        <div className="inv-box">
          <span className="inv-kind">{DOC_TITLES[inv.doc_type]}</span>
          <dl>
            <dt>Nº</dt><dd className="inv-num">{invoiceNo(inv.number)}</dd>
            <dt>Nº de Control</dt>
            <dd className={pendingControl ? 'inv-pending' : 'inv-num'}>{pendingControl ? 'Pendiente' : inv.control_number}</dd>
            <dt>Fecha</dt><dd>{dateVE(inv.issued_at)}</dd>
            <dt>Hora</dt><dd>{timeVE(inv.issued_at)}</dd>
          </dl>
        </div>
      </header>

      <section className="inv-party">
        <div><span>Nombre o razón social</span><strong>{inv.customer?.name}</strong></div>
        <div><span>RIF / C.I.</span><strong>{inv.customer?.document}</strong></div>
        {inv.customer?.address && <div className="wide"><span>Domicilio fiscal</span><strong>{inv.customer.address}</strong></div>}
        {inv.customer?.phone && <div><span>Teléfono</span><strong>{inv.customer.phone}</strong></div>}
      </section>

      {isNote && (
        <section className="inv-affects">
          Afecta a la factura Nº <b>{related ? invoiceNo(related.number) : '—'}</b>
          {related?.control_number ? <> · control <b>{related.control_number}</b></> : null}
          {related ? <> del {dateVE(related.issued_at)}</> : null}
          {inv.reason && <><br />Motivo: {inv.reason}</>}
        </section>
      )}

      <div className="inv-lines" role="table" aria-label="Detalle">
        <div className="inv-row inv-row-head" role="row">
          <span role="columnheader">Código</span>
          <span role="columnheader">Descripción</span>
          <span role="columnheader" className="r">Cant.</span>
          <span role="columnheader" className="r">Precio unit. Bs</span>
          <span role="columnheader" className="r">Monto Bs</span>
        </div>
        {lines.map((l, i) => (
          <div className="inv-row" role="row" key={i}>
            <span role="cell" className="inv-code">{l.code || '—'}</span>
            <span role="cell" className="inv-desc">{l.description}</span>
            <span role="cell" className="r inv-qty">{qty(l.quantity)} {l.unit && l.unit !== 'und' ? l.unit : ''}</span>
            <span role="cell" className="r inv-unit">{money(l.unit_price_ves)}</span>
            <span role="cell" className="r inv-amt">{money(l.amount_ves)} <em>({l.tax_code})</em></span>
          </div>
        ))}
      </div>

      <section className="inv-bottom">
        <div className="inv-notes">
          <p><b>(G)</b> Alícuota general 16 % · <b>(R)</b> reducida 8 % · <b>(E)</b> exento.</p>
          <p>
            Equivalente: <b>{usd(inv.total_usd)}</b> a la tasa {inv.rate_source?.includes('bcv') || !inv.rate_source ? 'BCV' : 'aplicada'} de {money(inv.rate)} Bs/$ del {dateVE(inv.issued_at)}.
          </p>
          {(inv.payments || []).length > 0 && (
            <p>Forma de pago: {inv.payments.map((p) => `${p.method} (${p.currency === 'USD' ? usd(p.amount) : bs(p.amount)})`).join(' · ')}.</p>
          )}
        </div>
        <dl className="inv-totals">
          <dt>Subtotal</dt><dd>{money(subtotal)}</dd>
          {disc > 0.004 && <><dt>Descuento</dt><dd>−{money(disc)}</dd></>}
          {Number(inv.exempt_ves) > 0 && <><dt>Exento (E)</dt><dd>{money(inv.exempt_ves)}</dd></>}
          {Number(inv.base_g_ves) > 0 && <><dt>Base imponible (G) 16 %</dt><dd>{money(inv.base_g_ves)}</dd><dt>IVA 16 %</dt><dd>{money(inv.iva_g_ves)}</dd></>}
          {Number(inv.base_r_ves) > 0 && <><dt>Base imponible (R) 8 %</dt><dd>{money(inv.base_r_ves)}</dd><dt>IVA 8 %</dt><dd>{money(inv.iva_r_ves)}</dd></>}
          {Number(inv.igtf_ves) > 0 && <><dt>IGTF 3 %</dt><dd>{money(inv.igtf_ves)}</dd></>}
          <dt className="inv-grand">{isNote ? 'Total de la nota Bs' : 'Total a pagar Bs'}</dt><dd className="inv-grand">{money(inv.total_ves)}</dd>
        </dl>
      </section>

      <footer className="inv-foot">
        {pendingControl
          ? 'Documento emitido por medios digitales. El número de control lo asigna la imprenta digital autorizada por el SENIAT; mientras esté pendiente, este documento no sustituye a la factura fiscal.'
          : `Documento emitido por medios digitales (Providencia SNAT/2024/000102). Número de control asignado por la imprenta digital autorizada${inv.provider_payload?.provider ? ` ${inv.provider_payload.provider}` : ''}.`}
      </footer>
    </article>
  );
}
