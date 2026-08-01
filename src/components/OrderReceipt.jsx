import { usd, bs, money, formatDate } from '../lib/calc';

// Recibo de pedido con formato de ticket. Se usa tanto en la pantalla de
// confirmación como en la vista de un pedido guardado. Imprimible directamente
// (window.print) gracias a las reglas .receipt en print media.
export default function OrderReceipt({ business, order }) {
  const items = order.order_items || [];
  const payments = order.order_payments || [];
  const rate = Number(order.rate) || 0;
  const discount = Number(order.discount_usd) || 0;
  const effectiveTotal = (Number(order.total_usd) || 0) - discount;
  const paidUsd = payments.reduce((s, p) => s + (Number(p.amount_usd) || 0), 0);
  const change = paidUsd - effectiveTotal;

  return (
    <div className="receipt">
      <div className="receipt-head">
        <div className="receipt-biz">{business?.name || 'Pedido'}</div>
        {business?.rif && <div className="receipt-muted">{business.rif}</div>}
        <div className="receipt-muted">Pedido Nº {order.number}</div>
        <div className="receipt-muted">{formatDate(order.created_at)}</div>
        {order.customer_name && <div className="receipt-muted">Cliente: {order.customer_name}</div>}
        {order.created_by_name && <div className="receipt-muted">Atendido por: {order.created_by_name}</div>}
      </div>

      <div className="receipt-divider" />

      <table className="receipt-items">
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td className="receipt-qty">{Number(it.quantity)}×</td>
              <td>
                {it.name}{it.variant_label ? ` · ${it.variant_label}` : ''}
                <div className="receipt-muted receipt-unitprice">{usd(it.unit_price_usd)} c/u</div>
              </td>
              <td className="receipt-amt">{usd(it.line_total_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-divider" />

      <div className="receipt-totals">
        <div className={`receipt-total-row${discount > 0.005 ? '' : ' grand'}`}>
          <span>Total</span>
          <span>{usd(order.total_usd)}</span>
        </div>
        {discount > 0.005 && (
          <>
            <div className="receipt-total-row">
              <span>Descuento divisa</span>
              <span>−{usd(discount)}</span>
            </div>
            <div className="receipt-total-row grand">
              <span>Total a pagar</span>
              <span>{usd(effectiveTotal)}</span>
            </div>
          </>
        )}
        <div className="receipt-total-row grand bs">
          <span>Total Bs</span>
          <span>{bs(order.total_ves)}</span>
        </div>
        <div className="receipt-total-row receipt-muted">
          <span>Tasa aplicada</span>
          <span>{money(rate)} Bs/$</span>
        </div>
      </div>

      {payments.length > 0 && (
        <>
          <div className="receipt-divider" />
          <div className="receipt-totals">
            {payments.map((p) => (
              <div className="receipt-total-row" key={p.id}>
                <span>{p.method_name}</span>
                <span>{p.currency === 'USD' ? usd(p.amount) : bs(p.amount)}</span>
              </div>
            ))}
            {change > 0.001 && (
              <div className="receipt-total-row"><span>Vuelto</span><span>{usd(change)}</span></div>
            )}
          </div>
        </>
      )}

      <div className="receipt-foot receipt-muted">¡Gracias por su compra!</div>
    </div>
  );
}
