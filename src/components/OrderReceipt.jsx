import { usd, bs, money, formatDate } from '../lib/calc';
import { useBranch } from '../context/BranchContext';

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
  const credit = Number(order.credit_usd) || 0;
  const iva = Number(order.iva_usd) || 0;
  const igtf = Number(order.igtf_usd) || 0;
  // El IGTF va encima de la venta: se paga, pero no es vuelto.
  const change = credit > 0 ? 0 : paidUsd - effectiveTotal - igtf;
  // La sucursal solo se imprime si el negocio tiene más de una.
  const { allBranches, branchById } = useBranch();
  const branch = allBranches.length > 1 ? branchById.get(order.branch_id) : null;

  return (
    <div className="receipt">
      <div className="receipt-head">
        <div className="receipt-biz">{business?.name || 'Venta'}</div>
        {business?.rif && <div className="receipt-muted">{business.rif}</div>}
        {branch && <div className="receipt-muted">Sucursal {branch.name}{branch.address ? ` · ${branch.address}` : ''}</div>}
        <div className="receipt-muted">Venta Nº {order.number}</div>
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
                <div className="receipt-muted receipt-unitprice">
                  {usd(it.unit_price_usd)} c/u{it.offer_percent ? ` (oferta −${Number(it.offer_percent)}%)` : it.offer_price ? ' (oferta)' : ''}
                </div>
              </td>
              <td className="receipt-amt">{usd(it.line_total_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-divider" />

      <div className="receipt-totals">
        <div className={`receipt-total-row${discount > 0.005 ? '' : ' grand'}`}>
          <span>{discount > 0.005 ? 'Subtotal' : 'Total'}</span>
          <span>{usd(order.total_usd)}</span>
        </div>
        {discount > 0.005 && (
          <>
            <div className="receipt-total-row">
              <span>{order.discount_name ? `${order.discount_name} (−${Number(order.discount_percent)}%)` : 'Descuento de contado'}</span>
              <span>−{usd(discount)}</span>
            </div>
            <div className="receipt-total-row grand">
              <span>Total a pagar</span>
              <span>{usd(effectiveTotal)}</span>
            </div>
          </>
        )}
        {order.iva_added && iva > 0.004 && (
          <div className="receipt-total-row receipt-muted"><span>Incluye IVA</span><span>{usd(iva)}</span></div>
        )}
        {igtf > 0.004 && (
          <div className="receipt-total-row"><span>IGTF 3 % (pago en divisas)</span><span>{usd(igtf)}</span></div>
        )}
        <div className="receipt-total-row grand bs">
          <span>Total Bs</span>
          <span>{bs(rate > 0 ? (effectiveTotal + igtf) * rate : order.total_ves)}</span>
        </div>
        <div className="receipt-total-row receipt-muted">
          <span>Tasa aplicada</span>
          <span>{money(rate)} Bs/$</span>
        </div>
      </div>

      {(payments.length > 0 || credit > 0) && (
        <>
          <div className="receipt-divider" />
          <div className="receipt-totals">
            {payments.map((p) => (
              <div className="receipt-total-row" key={p.id}>
                <span>
                  {p.method_name || p.account_name || 'Pago'}
                  {p.kind === 'cashea' && ' (a cuotas)'}
                </span>
                <span>{p.currency === 'USD' ? usd(p.amount) : bs(p.amount)}</span>
              </div>
            ))}
            {credit > 0 && (
              <div className="receipt-total-row"><span>A crédito (por pagar)</span><span>{usd(credit)}</span></div>
            )}
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
