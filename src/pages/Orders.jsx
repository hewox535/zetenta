import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import {
  fetchProducts, fetchTaxonomies, fetchBankAccounts, fetchCustomers,
  createCustomer, createOrder, fetchOrder, mediaUrl, fetchOpenCashSession, fetchDiscounts,
} from '../lib/api';
import { discountStatus, todayVE } from '../lib/discounts';
import { fetchBcvRates, resolveRate } from '../lib/rates';
import { notifySale } from '../lib/push';
import { usd, bs, money, variantLabel, offerPrice, hasOffer, offerTag } from '../lib/calc';
import OrderReceipt from '../components/OrderReceipt';
import OpenCashModal from '../components/OpenCashModal';
import { CASH_EVENT, notifyCashChanged } from '../lib/cashEvents';
import { FinModal } from '../components/FinUI';
import { findByDoc } from '../lib/customerDoc';

const EMPTY_CUST = { name: '', docType: 'V', document: '', phone: '', email: '' };
// Cédula/RIF: V (venezolano), J (jurídico), E (extranjero) + solo números.
const DOC_TYPES = [['V', 'Venezolano'], ['J', 'Jurídico'], ['E', 'Extranjero']];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const docOf = (c) => (c.document.trim() ? `${c.docType}-${c.document.trim()}` : '');

// Bloque de cliente de la venta: buscar existente o crear nuevo. Se monta dos
// veces (resumen desktop y hoja de pago móvil) compartiendo el mismo estado.
function CustomerBlock({ desktop, required, fieldReq, selectedCustomer, resetCustomer,
  showNewCust, setShowNewCust, newCust, setNew, setNewCust, custSearch, setCustSearch,
  custMatches, pickCustomer, issue, dupCustomer }) {
  const emailBad = !!newCust.email.trim() && !EMAIL_RE.test(newCust.email.trim());
  return (
    <div className={`order-customer-block${desktop ? '' : ' oc-mobile'}`}>
      <div className="oc-label">Cliente{required ? '' : ' (opcional)'}</div>
      {selectedCustomer ? (
        <div className="oc-selected">
          <div>
            <strong>{selectedCustomer.name}</strong>
            {selectedCustomer.document && <span className="muted"> · {selectedCustomer.document}</span>}
          </div>
          <button type="button" className="btn ghost sm" onClick={resetCustomer}>Quitar</button>
        </div>
      ) : showNewCust ? (
        <div className="oc-new">
          <input placeholder="Nombre" value={newCust.name} onChange={setNew('name')} autoFocus={desktop} />
          <div className="oc-doc">
            <select value={newCust.docType} aria-label="Tipo de documento"
              onChange={(e) => setNewCust((f) => ({ ...f, docType: e.target.value }))}>
              {DOC_TYPES.map(([k, l]) => <option key={k} value={k} title={l}>{k}</option>)}
            </select>
            <input placeholder={`Cédula o RIF${fieldReq('document') ? '' : ' (opcional)'}`} inputMode="numeric"
              value={newCust.document} aria-label="Número de documento"
              onChange={(e) => setNewCust((f) => ({ ...f, document: e.target.value.replace(/\D/g, '') }))} />
          </div>
          <input placeholder={`Teléfono${fieldReq('phone') ? '' : ' (opcional)'}`}
            value={newCust.phone} onChange={setNew('phone')} inputMode="tel" />
          <input placeholder="Correo (opcional)" value={newCust.email} onChange={setNew('email')} type="email"
            className={emailBad ? 'oc-invalid' : ''} aria-invalid={emailBad} />
          {emailBad && <span className="oc-field-error">Escribe un correo válido, por ejemplo nombre@correo.com</span>}
          {dupCustomer && (
            <div className="oc-dup" role="alert">
              <span>Ya está registrado: <strong>{dupCustomer.name}</strong> · {dupCustomer.document}</span>
              <button type="button" className="btn sm" onClick={() => pickCustomer(dupCustomer)}>Usar este cliente</button>
            </div>
          )}
          <button type="button" className="btn ghost sm" onClick={() => { setShowNewCust(false); setNewCust(EMPTY_CUST); }}>
            Cancelar
          </button>
        </div>
      ) : (
        <>
          <input className="oc-search" placeholder="Buscar cliente por nombre o documento…"
            value={custSearch} onChange={(e) => setCustSearch(e.target.value)} />
          {custMatches.length > 0 && (
            <div className="oc-results">
              {custMatches.map((c) => (
                <button type="button" key={c.id} onClick={() => pickCustomer(c)}>
                  {c.name}{c.document && <span className="muted"> · {c.document}</span>}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn sm oc-new-btn" onClick={() => setShowNewCust(true)}>+ Nuevo cliente</button>
        </>
      )}
      {issue && !dupCustomer && <div className="oc-issue" role="alert">{issue}</div>}
    </div>
  );
}

const variantsOf = (p) => p.product_variants || [];
// Stock de la variante en la sucursal actual (0 si no hay fila para esa sucursal).
const branchStock = (v, branchId) => {
  const vs = (v.variant_stock || []).find((x) => x.branch_id === branchId);
  return vs ? Number(vs.stock) : 0;
};
const totalStock = (p, branchId) => variantsOf(p).reduce((s, v) => s + branchStock(v, branchId), 0);
// Productos sin control de inventario (helados…): no tienen cantidad, solo un
// interruptor Disponible/Agotado por sucursal (sin fila = disponible).
const tracksStock = (p) => p.track_stock !== false;
const availableIn = (v, branchId) => (v.variant_stock || []).find((x) => x.branch_id === branchId)?.available !== false;
const sellable = (p, v, branchId) => (tracksStock(p) ? branchStock(v, branchId) > 0 : availableIn(v, branchId));
// Agotado sin control de inventario: no se puede vender (el servidor también lo rechaza).
const blockedOut = (p, v, branchId) => !tracksStock(p) && !availableIn(v, branchId);
const isSimple = (p) => variantsOf(p).length <= 1 && (p.variant_axes || []).length === 0;
// Qué tallas y colores tiene el producto a la vista: los de las variantes con
// stock en esta sucursal (es lo vendible). Si no queda ninguna, se muestran
// todos en gris, para saber de qué es el producto aunque esté agotado.
const AXIS_MAX = 5;
// Un producto con muchos colores no debe estirar la tarjeta: se muestran los
// primeros y el resto se cuenta ("+3"); al tocarlo salen todos igual.
const axisRow = (axis, values, soldOut) => ({
  axis, values: values.slice(0, AXIS_MAX), rest: Math.max(0, values.length - AXIS_MAX), soldOut,
});
const axisValues = (p, branchId) => {
  const axes = p.variant_axes || [];
  if (axes.length === 0) return [];
  const withStock = variantsOf(p).filter((v) => sellable(p, v, branchId));
  const source = withStock.length > 0 ? withStock : variantsOf(p);
  return axes.map((axis) =>
    axisRow(axis, [...new Set(source.map((v) => v.attributes?.[axis]).filter(Boolean))], withStock.length === 0),
  ).filter((x) => x.values.length > 0);
};
// Lo que se ve en la tarjeta: las variaciones del producto y, además, las
// etiquetas de las taxonomías de variación (Talla, Color…). Un producto sin
// variaciones puede tener su talla puesta como etiqueta —así la carga Roma— y
// esa talla también tiene que verse. La categoría no: es para organizar, no
// para identificar la prenda.
const cardAttrs = (p, branchId, varTax) => {
  const rows = axisValues(p, branchId);
  const yaEstan = new Set(rows.map((r) => r.axis.toLowerCase()));
  const soldOut = !variantsOf(p).some((v) => sellable(p, v, branchId));
  const porTax = new Map();
  (p.product_terms || []).forEach((pt) => {
    const t = varTax.get(pt.term_id);
    if (!t || yaEstan.has(t.taxonomy.toLowerCase())) return;
    if (!porTax.has(t.taxonomy)) porTax.set(t.taxonomy, { order: t.order, values: [] });
    porTax.get(t.taxonomy).values.push(t.name);
  });
  return rows.concat(
    [...porTax.entries()]
      .sort((a, b) => a[1].order - b[1].order)
      .map(([taxonomy, x]) => axisRow(taxonomy, x.values, soldOut)),
  );
};
const defaultVariant = (p) =>
  variantsOf(p).find((v) => Object.keys(v.attributes || {}).length === 0) || variantsOf(p)[0];
const variantPrice = (p, v) => (v.price != null ? Number(v.price) : Number(p.price));
// Precio efectivo: el de la variante (o producto) con la oferta aplicada.
const effPrice = (p, v) => offerPrice(variantPrice(p, v), p);
const mediaOf = (p) => (p.product_media || []).slice().sort((a, b) => a.sort_order - b.sort_order);
const productImg = (p) => { const m = mediaOf(p).find((x) => !x.variant_id) || mediaOf(p)[0]; return m ? mediaUrl(m) : null; };
const variantImg = (p, v) => {
  const m = mediaOf(p).find((x) => x.variant_id === v.id);
  return m ? mediaUrl(m) : productImg(p);
};

// Aplana cuentas bancarias a opciones de pago para el POS: una cuenta sin
// métodos es una opción en sí; una cuenta con métodos aporta una opción por
// método ("Cuenta · Método"). Cada opción lleva account_id/method_id y la moneda
// de su cuenta, para que create_order registre a qué cuenta entró el dinero.
function payOptionsFromAccounts(accounts) {
  const opts = [];
  for (const a of (accounts || []).filter((x) => x.active)) {
    const ms = (a.payment_methods || [])
      .filter((m) => m.active !== false)
      .sort((x, y) => (x.sort_order - y.sort_order) || String(x.created_at).localeCompare(String(y.created_at)));
    if (ms.length === 0) {
      opts.push({ id: `a:${a.id}`, name: a.name, currency: a.currency, kind: 'normal',
        account_id: a.id, method_id: null, account_name: a.name, method_name: '' });
    } else {
      for (const m of ms) {
        // Cashea es un método especial (una sola cuenta por negocio): se
        // muestra solo como "Cashea", no "Cuenta · Método".
        opts.push({ id: `m:${m.id}`, name: m.kind === 'cashea' ? 'Cashea' : `${a.name} · ${m.name}`, currency: a.currency,
          kind: m.kind || 'normal',
          account_id: a.id, method_id: m.id, account_name: a.name, method_name: m.name });
      }
    }
  }
  return opts;
}

// Cashea (compra a cuotas): el cliente paga una inicial en la tienda y Cashea
// financia el resto, que llega después en cuotas. El % de la inicial lo dice
// la app de Cashea en cada compra, así que se escribe a mano; lo que se
// registra en el método Cashea es el resto.
const isCashea = (m) => m?.kind === 'cashea';
// El descuento por pagar en divisa premia el efectivo en dólares; lo que
// financia Cashea no lo gana, aunque su cuenta sea en USD (igual que el servidor).
// El contado en bolívares tiene su propio descuento (local_discount_percent).
const isForeignCash = (m) => m?.currency === 'USD' && !isCashea(m);

// Helpers de monto (aceptan coma o punto decimal).
const parseAmt = (s) => Number(String(s ?? '').replace(',', '.')) || 0;
const round2 = (x) => Math.round(x * 100) / 100;
const fmtAmt = (x) => (x ? String(round2(x)) : '');

// Fila de monto de un método de pago. Los métodos en Bs muestran DOS inputs
// sincronizados (Bs y su equivalente en $) para capturar cómodo; los métodos en
// dólares muestran solo el input en $. El monto que se envía a create_order se
// guarda SIEMPRE en la moneda del método (el input secundario es solo captura).
function PayAmountRow({
  m, rate, amount, onAmount, onExact, initialPct = null, onInitialPct = null, totalUsd = 0,
}) {
  const cashea = !!onInitialPct;
  const [focus, setFocus] = useState(null); // 'main' | 'alt' | null
  const [draft, setDraft] = useState('');
  const isVes = m.currency !== 'USD';
  const toAlt = (canon) => {                    // moneda-método → otra moneda
    const v = parseAmt(canon);
    if (!v || !rate) return '';
    return fmtAmt(isVes ? v / rate : v * rate);
  };
  const toCanon = (alt) => {                    // otra moneda → moneda-método
    const v = parseAmt(alt);
    if (!v || !rate) return '';
    return fmtAmt(isVes ? v * rate : v / rate);
  };
  const mainCur = isVes ? 'Bs' : 'USD';
  const altCur = isVes ? 'USD' : 'Bs';
  const mainVal = focus === 'main' ? draft : (amount ?? '');
  const altVal = focus === 'alt' ? draft : toAlt(amount);
  // Cashea: con el % de inicial a la vista, cuánto paga hoy el cliente y
  // cuánto queda financiado (que es lo que va en el monto de abajo).
  const pct = parseAmt(initialPct);
  const splitOk = onInitialPct && pct > 0 && pct < 100 && totalUsd > 0;
  const initialUsd = splitOk ? round2(totalUsd * (pct / 100)) : 0;
  const financedUsd = splitOk ? round2(totalUsd - initialUsd) : 0;

  // Cashea: solo el % de inicial y el reparto. Lo financiado no se escribe ni
  // tiene "Exacto": sale del % y del total.
  if (cashea) {
    const financedMain = splitOk ? (isVes ? financedUsd * rate : financedUsd) : 0;
    return (
      <div className="pay-input-row pay-row-cashea">
        <div className="pay-cashea-head">
          <span className="pay-input-name">{m.name}</span>
          <label className="pay-pct">
            <span>Inicial</span>
            <span className="pay-pct-field">
              <input inputMode="decimal" placeholder="40" value={initialPct}
                onChange={(e) => onInitialPct(e.target.value)} aria-label="Porcentaje de inicial" />
              <span className="pay-pct-sign">%</span>
            </span>
          </label>
        </div>
        {splitOk ? (
          <div className="pay-cashea-split">
            <div>
              <span>Paga hoy el cliente</span>
              <strong>{usd(initialUsd)}</strong>
              {rate > 0 && <em>{bs(initialUsd * rate)}</em>}
            </div>
            <div>
              <span>Financia Cashea</span>
              <strong>{usd(financedUsd)}</strong>
              {isVes && <em>{bs(financedMain)}</em>}
            </div>
          </div>
        ) : (
          <span className="pay-split muted">Escribe el % de inicial que indica la app de Cashea.</span>
        )}
      </div>
    );
  }

  return (
    <div className={`pay-input-row${cashea ? ' pay-row-cashea' : ''}`}>
      <div className="pay-input-label">
        <span className="pay-input-name">{m.name}</span>
        <button type="button" className="pay-exact" onClick={onExact}
          title={cashea ? 'Lo que financia Cashea según el % de inicial' : 'Lo que falta por cobrar, en este método'}>
          Exacto
        </button>
      </div>
      <div className={`pay-dual${isVes ? '' : ' single'}`}>
        <label className="pay-amt main">
          <span className="pay-amt-cur">{isVes ? 'Bs' : '$'}</span>
          <input inputMode="decimal" placeholder="0,00" value={mainVal} aria-label={`Monto en ${mainCur}`}
            onFocus={() => { setFocus('main'); setDraft(amount ?? ''); }}
            onBlur={() => setFocus(null)}
            onChange={(e) => { setDraft(e.target.value); onAmount(e.target.value); }} />
        </label>
        {isVes && (
          <label className="pay-amt alt" title="Equivalente en dólares">
            <span className="pay-amt-cur">$</span>
            <input inputMode="decimal" placeholder="0,00" value={altVal} aria-label={`Equivalente en ${altCur}`}
              onFocus={() => { setFocus('alt'); setDraft(toAlt(amount)); }}
              onBlur={() => setFocus(null)}
              onChange={(e) => { setDraft(e.target.value); onAmount(toCanon(e.target.value)); }} />
          </label>
        )}
      </div>
    </div>
  );
}

export default function Orders() {
  const { business, capabilities, permissions, isBusinessAdmin } = useAuth();
  const { branchId, currentBranch, branches } = useBranch();
  const [products, setProducts] = useState(null);
  const [taxonomies, setTaxonomies] = useState([]);
  // Si la caja está cerrada, lo que se venda no entra en el cierre del día.
  const [cajaCerrada, setCajaCerrada] = useState(false);
  const [openingCash, setOpeningCash] = useState(false);
  const [methods, setMethods] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [rates, setRates] = useState(null);
  const [rateError, setRateError] = useState(null);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});          // { taxonomyId: termId }
  const [offerOnly, setOfferOnly] = useState(false);   // filtro "En oferta"

  const [cart, setCart] = useState([]);                // [{ id(variantId), productId, name, label, price, unit, stock, qty }]
  const [picker, setPicker] = useState(null);          // producto cuyo selector de variante está abierto
  const [stage, setStage] = useState('shop');          // 'shop' | 'pay' | 'done'
  const [panelOpen, setPanelOpen] = useState(false);   // hoja inferior en móvil

  // Cliente del pedido: existente (selectedCustomer) o nuevo (newCust)
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [custSearch, setCustSearch] = useState('');
  const [showNewCust, setShowNewCust] = useState(false);
  const [newCust, setNewCust] = useState(EMPTY_CUST);

  const [selectedMethods, setSelectedMethods] = useState([]); // ids de métodos activos
  const [payments, setPayments] = useState({});        // { methodId: 'monto' }
  const [initialPct, setInitialPct] = useState({});    // { methodId: '% inicial' } en Cashea
  // Inicial de Cashea por defecto (estándar 40%; el negocio la cambia en Ventas).
  const casheaDefault = Number(business?.cashea_initial_percent) || 40;
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(null);      // pedido guardado (con ítems/pagos)

  const puedeCaja = capabilities.cash && (isBusinessAdmin || !!permissions?.cash);
  useEffect(() => {
    if (!puedeCaja || !branchId) return undefined;
    const check = () => fetchOpenCashSession(branchId).then((s) => setCajaCerrada(!s)).catch(() => {});
    check();
    // La caja se abre y se cierra desde el menú lateral: el aviso se entera.
    window.addEventListener(CASH_EVENT, check);
    return () => window.removeEventListener(CASH_EVENT, check);
  }, [puedeCaja, branchId]);

  // Venta a crédito: lo que no se cobre queda como cuenta por cobrar del cliente.
  // Descuentos de contado de ESTA venta: arrancan con los del negocio y la
  // vendedora puede desmarcarlos o cambiar el % en el cobro.
  const [discCfg, setDiscCfg] = useState(() => ({
    usd: { on: true, pct: String(Number(business?.foreign_discount_percent) || 0) },
    ves: { on: true, pct: String(Number(business?.local_discount_percent) || 0) },
  }));
  const [itemsOpen, setItemsOpen] = useState(false);   // modal con los artículos de la venta
  // Descuentos especiales vigentes (Negocio → Ventas) y el que eligió la
  // cajera para esta venta (uno por venta; queda guardado en la venta).
  const [discounts, setDiscounts] = useState([]);
  // choice: 'cash' (descuento de contado), 'none' (sin descuento) o el id de
  // un descuento especial. Es un radio: la cajera elige cuál usa la venta.
  const [choice, setChoice] = useState('cash');
  const [discPick, setDiscPick] = useState(null);   // modal del descuento: opción marcada (sin aplicar)
  const promoId = !['cash', 'none', 'custom'].includes(choice) ? choice : null;
  // Descuento personalizado: un % para toda la venta y un nombre opcional.
  const [custom, setCustom] = useState({ pct: '', name: '' });
  const [customDraft, setCustomDraft] = useState({ pct: '', name: '' });
  const customDsOf = (c) => ({ id: 'custom', name: c.name.trim() || 'Personalizado', cash_percent: parseAmt(c.pct), cashea_percent: parseAmt(c.pct), term_ids: [] });

  useEffect(() => {
    Promise.all([fetchProducts(), fetchTaxonomies(), fetchBankAccounts(), fetchCustomers()])
      .then(([p, t, accts, c]) => {
        setProducts(p); setTaxonomies(t); setMethods(payOptionsFromAccounts(accts)); setCustomers(c);
      })
      .catch((e) => setError(e.message));
    fetchDiscounts()
      // Solo los vigentes (activos y dentro de sus fechas).
      .then((list) => { const t = todayVE(); setDiscounts(list.filter((x) => discountStatus(x, t) === 'live')); })
      .catch(() => {});
    fetchBcvRates().then(setRates).catch((e) => setRateError(e.message));
  }, []);

  const rate = useMemo(() => resolveRate(business?.rate_config, rates), [business, rates]);

  // ------- carrito (por variante) -------
  const addVariant = (p, v) => {
    if (blockedOut(p, v, branchId)) return;
    setCart((prev) => {
      const found = prev.find((c) => c.id === v.id);
      if (found) return prev.map((c) => (c.id === v.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, {
        id: v.id, productId: p.id, name: p.name, label: variantLabel(v.attributes, p.variant_axes),
        price: effPrice(p, v), unit: p.unit, stock: branchStock(v, branchId), qty: 1,
      }];
    });
  };
  // Tocar un producto: si es simple lo agrega directo; si tiene variantes abre el selector.
  const onTapProduct = (p) => {
    if (isSimple(p)) {
      const dv = defaultVariant(p);
      if (dv) addVariant(p, dv);
    } else {
      setPicker(p);
    }
  };
  const cartQtyForProduct = (p) => cart.filter((c) => c.productId === p.id).reduce((s, c) => s + c.qty, 0);
  const setQty = (id, qty) => {
    if (qty <= 0) return setCart((prev) => prev.filter((c) => c.id !== id));
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty } : c)));
  };
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const totalUsd = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const totalVes = totalUsd * rate.value;

  // ------- pagos (solo los métodos seleccionados) -------
  // Tolerancia de 1 céntimo, idéntica a create_order() en el servidor: el pedido
  // se considera cubierto cuando paidUsd + PAY_EPS >= total. Sin esto, el redondeo
  // a céntimos del monto en divisa (amplificado al dividir por 1-d) dejaba un
  // restante < 1 céntimo que se mostraba como $0,00 pero mantenía deshabilitado
  // "Finalizar". Los Bs se normalizan a USD redondeando cada pago, como el servidor.
  const PAY_EPS = 0.01;
  // Descuentos de contado: el pago en divisa "rinde" amt / (1-d) y el de
  // bolívares amt / (1-dv). Lo que financia Cashea va a precio de lista, y si
  // la venta lleva Cashea no hay descuentos (igual que el servidor).
  // listUsd: lo de Cashea (a precio de lista). bsUsd: el contado en Bs, en $.
  // usdPaid: el contado en divisa.
  const toUsd = (m, amt) => (m.currency === 'USD' ? amt : (rate.value ? round2(amt / rate.value) : 0));
  const sumBy = (pred) => selectedMethods.reduce((acc, id) => {
    const m = methods.find((x) => x.id === id);
    return m && pred(m) ? acc + toUsd(m, parseAmt(payments[id])) : acc;
  }, 0);
  const listUsd = sumBy((m) => isCashea(m));
  // Con Cashea elegido la venta va a precio de lista, desde el momento en que
  // se toca el método (aunque todavía no tenga monto). El servidor mira lo mismo.
  const clampPct = (v) => Math.min(0.99, Math.max(0, (Number(v) || 0) / 100));
  const baseD = choice === 'none' ? 0 : clampPct(discCfg.usd.pct);
  const baseDv = choice === 'none' ? 0 : clampPct(discCfg.ves.pct);
  // El negocio usa descuentos de contado (si no, no se muestra la sección).
  const bizD = clampPct(business?.foreign_discount_percent);
  const bizDv = clampPct(business?.local_discount_percent);
  const casheaSelected = selectedMethods.some((id) => isCashea(methods.find((x) => x.id === id)));
  // Descuento especial elegido: aplica a toda la venta o, si tiene
  // categorías, solo a sus artículos (el resto conserva el de contado). De
  // contado no se suma al de la moneda: en cada artículo, el mayor. Con Cashea
  // rebaja el precio de lista con su % de Cashea. Igual que create_order().
  const promoDs = choice === 'custom' ? customDsOf(custom) : discounts.find((x) => x.id === promoId) || null;
  const promoPct = (ds, cashea) => clampPct(cashea ? ds?.cashea_percent : ds?.cash_percent);
  const productsById = useMemo(() => new Map((products || []).map((p) => [p.id, p])), [products]);
  const qualifies = (ds, productId) => {
    const terms = ds?.term_ids || [];
    if (!terms.length) return true;
    return (productsById.get(productId)?.product_terms || []).some((pt) => terms.includes(pt.term_id));
  };
  const ratesFor = (dU, dB, ds) => {
    let tV = 0; let tU = 0; let off = 0; let hits = 0;
    if (ds) {
      const pc = promoPct(ds, false); const pk = promoPct(ds, true);
      cart.forEach((c) => {
        const amt = c.price * c.qty;
        const q = qualifies(ds, c.productId);
        const lp = q ? pc : 0;
        if (q) { hits += c.qty; off += round2(amt * pk); }
        tV += amt * (1 - Math.max(lp, dB));
        tU += amt * (1 - Math.max(lp, dU));
      });
    }
    const eff = (t, base) => (hits && totalUsd > 0 ? Math.min(0.99, Math.max(0, 1 - t / totalUsd)) : base);
    return { d: eff(tU, dU), dv: eff(tV, dB), casheaOff: off, hits };
  };
  const promo = ratesFor(baseD, baseDv, promoDs);
  const effD = promo.d;
  const effDv = promo.dv;
  const casheaOffFor = (ds) => ratesFor(0, 0, ds).casheaOff;
  const casheaOff = casheaSelected ? promo.casheaOff : 0;
  const dueUsd = totalUsd - casheaOff;
  const d = casheaSelected ? 0 : effD;
  const dv = casheaSelected ? 0 : effDv;
  const bsUsd = sumBy((m) => !isCashea(m) && !isForeignCash(m));
  const usdPaid = sumBy((m) => isForeignCash(m));
  const vesCredit = listUsd + bsUsd;   // todo lo que no es divisa (para los totales)
  const paidUsd = listUsd + (dv > 0 ? bsUsd / (1 - dv) : bsUsd) + (d > 0 ? usdPaid / (1 - d) : usdPaid);
  const rawRemaining = dueUsd - paidUsd;
  // Cubierto (habilita Finalizar) cuando el restante cae dentro de la tolerancia.
  const isCovered = cart.length > 0 && rawRemaining <= PAY_EPS;
  // Descuento concedido: Cashea primero, luego Bs, luego divisa (igual que el servidor).
  let discountUsd = casheaOff;
  {
    let pending = dueUsd - listUsd;
    if (pending > 0 && bsUsd > 0) {
      if (bsUsd + PAY_EPS >= round2(pending * (1 - dv))) { discountUsd += pending * dv; pending = 0; }
      else { discountUsd += (bsUsd * dv) / (1 - dv); pending -= bsUsd / (1 - dv); }
    }
    if (pending > 0 && usdPaid > 0) {
      discountUsd += usdPaid + PAY_EPS >= round2(pending * (1 - d)) ? pending * d : (usdPaid * d) / (1 - d);
    }
  }
  const promoOn = promo.hits > 0 && promoPct(promoDs, casheaSelected) > 0;
  const discountLabel = promoOn ? promoDs.name : d > 0 && dv > 0 ? 'Descuento de contado' : dv > 0 ? 'Descuento en bolívares' : 'Descuento por divisa';
  // Lo que el cliente realmente paga (neto = lista − descuento) y lo realmente
  // recibido en efectivo (Bs a USD + USD), para no mostrar "pagado 90$" cuando el
  // descuento hace que se cobren menos. Cuando está cubierto, recibido == a pagar.
  const netTotalUsd = Math.max(0, totalUsd - discountUsd);
  const receivedUsd = vesCredit + usdPaid;
  // Lo que financia Cashea cubre la venta, pero no es plata que entre hoy:
  // en los totales va aparte para no leerlo como "ya pagó".
  const casheaUsd = selectedMethods.reduce((s, id) => {
    const m = methods.find((x) => x.id === id);
    if (!isCashea(m)) return s;
    const amt = parseAmt(payments[id]);
    return s + (m.currency === 'USD' ? amt : (rate.value ? round2(amt / rate.value) : 0));
  }, 0);
  const cashedUsd = Math.max(0, receivedUsd - casheaUsd);
  const remainingNet = Math.max(0, netTotalUsd - receivedUsd);
  const changeNet = Math.max(0, receivedUsd - netTotalUsd);

  // Al entrar o salir Cashea cambian los descuentos de contado: los montos ya
  // escritos en los otros métodos se reescriben para cubrir la misma parte de
  // la venta (con descuento → a precio de lista, o al revés).
  const rescaleForCashea = (on, keepIds) => setPayments((prev) => {
    const n = { ...prev };
    keepIds.forEach((id) => {
      const om = methods.find((x) => x.id === id);
      if (!om || isCashea(om) || !n[id]) return;
      const dm = isForeignCash(om) ? effD : effDv;
      if (!dm) return;
      const amt = parseAmt(n[id]);
      n[id] = (on ? amt / (1 - dm) : amt * (1 - dm)).toFixed(2);
    });
    return n;
  });

  // Estado del cobro, al lado del botón de finalizar.
  const payStatus = cashedUsd <= PAY_EPS && casheaUsd <= PAY_EPS
    ? { tone: 'idle', label: 'A pagar', usd: netTotalUsd }
    : !isCovered
      ? { tone: 'warn', label: casheaUsd > PAY_EPS ? 'Falta cobrar la inicial' : 'Falta por cobrar', usd: remainingNet }
      : changeNet > PAY_EPS
        ? { tone: 'change', label: 'Vuelto', usd: changeNet }
        : { tone: 'ok', label: 'Cobro completo', usd: netTotalUsd };

  // Cambiar el descuento (marcar/desmarcar o el %) reescribe los montos ya
  // escritos en esa moneda para que sigan cubriendo la misma parte de la venta.
  // Lo mismo al marcar/desmarcar un descuento especial: cambia lo que rinde
  // cada moneda según la mezcla de productos.
  const rescaleCash = (next) => setPayments((prev) => {
    const n = { ...prev };
    selectedMethods.forEach((id) => {
      const om = methods.find((x) => x.id === id);
      if (!om || isCashea(om) || !n[id]) return;
      const oldD = isForeignCash(om) ? effD : effDv;
      const newD = isForeignCash(om) ? next.d : next.dv;
      if (oldD === newD || newD >= 1) return;
      n[id] = ((parseAmt(n[id]) * (1 - newD)) / (1 - oldD)).toFixed(2);
    });
    return n;
  });
  // Cambiar el % de contado reescribe los montos ya escritos en esa moneda.
  const changeDisc = (kind, patch) => {
    const nextCfg = { ...discCfg, [kind]: { ...discCfg[kind], ...patch } };
    setDiscCfg(nextCfg);
    if (!casheaSelected && choice !== 'none') {
      rescaleCash(ratesFor(clampPct(nextCfg.usd.pct), clampPct(nextCfg.ves.pct), promoDs));
    }
  };
  // Elegir el descuento de la venta (radio): los montos ya escritos se ajustan
  // para seguir cubriendo la misma parte de la venta.
  const pickChoice = (next, dsOverride) => {
    const ds = dsOverride || discounts.find((x) => x.id === next) || null;
    const off = next === 'none';
    setChoice(next);
    // Con Cashea el efecto de abajo recalcula lo financiado y la inicial.
    if (!casheaSelected) {
      rescaleCash(ratesFor(off ? 0 : clampPct(discCfg.usd.pct), off ? 0 : clampPct(discCfg.ves.pct), ds));
    }
  };

  const hasUsdCash = selectedMethods.some((id) => isForeignCash(methods.find((x) => x.id === id)));
  const hasBsCash = selectedMethods.some((id) => {
    const m = methods.find((x) => x.id === id);
    return m && !isCashea(m) && !isForeignCash(m);
  });
  const termName = useMemo(() => {
    const m = new Map();
    taxonomies.forEach((t) => (t.taxonomy_terms || []).forEach((x) => m.set(x.id, x.name)));
    return m;
  }, [taxonomies]);
  const hasContado = bizD > 0 || bizDv > 0;
  const contadoMeta = [bizD > 0 && `Divisa ${Number(discCfg.usd.pct) || 0}%`, bizDv > 0 && `Bs ${Number(discCfg.ves.pct) || 0}%`].filter(Boolean).join(' · ');
  // Opciones del modal de descuento y resumen de la elegida (fila del cobro).
  const pctLabel = (ds) => { const v = Math.round(promoPct(ds, casheaSelected) * 10000) / 100; return v > 0 ? `−${v}%` : null; };
  const termsOf = (ds) => (ds?.term_ids || []).map((id) => termName.get(id)).filter(Boolean);
  const discOptions = [
    hasContado && { id: 'cash', name: 'Contado', meta: casheaSelected ? 'No aplica con Cashea' : contadoMeta },
    ...discounts.map((ds) => {
      const t = termsOf(ds);
      const hits = ratesFor(0, 0, ds).hits;
      return {
        id: ds.id, name: ds.name, pct: pctLabel(ds),
        meta: !pctLabel(ds) ? (casheaSelected ? 'No aplica con Cashea' : 'Solo con Cashea')
          : t.length ? `Solo ${t.join(', ')} · ${hits ? `${hits} ${hits === 1 ? 'art.' : 'arts.'} en esta venta` : 'ninguno en esta venta'}` : 'Toda la venta',
      };
    }),
    { id: 'custom', name: 'Personalizado', meta: 'Un % propio para esta venta, con nombre opcional',
      pct: choice === 'custom' && parseAmt(custom.pct) > 0 ? `−${parseAmt(custom.pct)}%` : null },
    { id: 'none', name: 'Ninguno', meta: 'La venta va a precio de lista' },
  ].filter(Boolean);
  const customOk = parseAmt(customDraft.pct) > 0 && parseAmt(customDraft.pct) < 100;
  const discSummary = (() => {
    if (choice === 'none') return { name: 'Ninguno' };
    if (choice === 'cash') {
      const rows = casheaSelected ? [] : [bizD > 0 && hasUsdCash && `${Number(discCfg.usd.pct) || 0}%`, bizDv > 0 && hasBsCash && `${Number(discCfg.ves.pct) || 0}%`].filter(Boolean);
      return { name: 'Contado', pct: rows.length === 1 ? `−${rows[0]}` : null,
        detail: casheaSelected ? 'Con Cashea no hay descuento de contado.' : rows.length === 1 ? null : contadoMeta };
    }
    const t = termsOf(promoDs);
    return {
      name: promoDs?.name || 'Descuento', pct: pctLabel(promoDs),
      detail: !pctLabel(promoDs) ? (casheaSelected ? 'Este descuento no aplica con Cashea.' : 'Este descuento solo aplica con Cashea.')
        : t.length ? (promo.hits ? `Solo ${t.join(', ')} (${promo.hits} ${promo.hits === 1 ? 'art.' : 'arts.'})${casheaSelected ? '' : '; el resto, con el de contado'}.` : `Ningún artículo de ${t.join(', ')} en esta venta.`)
          : null,
    };
  })();
  const discRows = casheaSelected ? [] : [
    hasUsdCash && bizD > 0 && { kind: 'usd', label: 'Contado en divisa' },
    hasBsCash && bizDv > 0 && { kind: 'ves', label: 'Contado en bolívares' },
  ].filter(Boolean);

  // Imagen de un artículo del carrito (la de su variante o la del producto).
  const cartImg = (c) => {
    const p = (products || []).find((x) => x.id === c.productId);
    if (!p) return null;
    const v = (p.product_variants || []).find((x) => x.id === c.id);
    return v ? variantImg(p, v) : productImg(p);
  };

  // Monto que cubre TODA la venta con un método (con su descuento de contado,
  // salvo que haya Cashea), en la moneda del método.
  const fullAmountFor = (om, withCashea) => {
    const dm = withCashea ? 0 : (isForeignCash(om) ? effD : effDv);
    const net = (withCashea ? totalUsd - casheaOffFor(promoDs) : totalUsd) * (1 - dm);
    return (om.currency === 'USD' ? net : net * rate.value).toFixed(2);
  };

  // Al escribir un monto con dos métodos de contado elegidos, el otro se
  // ajusta solo con lo que falta (cada uno con su descuento).
  const onAmountChange = (m, val) => {
    const cashIds = selectedMethods.filter((id) => !isCashea(methods.find((x) => x.id === id)));
    // Cashea + un solo método de contado: lo que paga el cliente ES la inicial.
    // Al cambiarlo se recalculan el % de inicial y lo que financia Cashea.
    const casheaM = methods.find((x) => selectedMethods.includes(x.id) && isCashea(x));
    if (casheaM && !isCashea(m) && cashIds.length === 1 && rate.value && dueUsd > 0) {
      const amt = parseAmt(val);
      const initialUsd = m.currency === 'USD' ? amt : amt / rate.value;
      if (initialUsd > 0 && initialUsd < dueUsd - PAY_EPS) {
        const financedUsd = dueUsd - initialUsd;
        const pct = Math.round((initialUsd / dueUsd) * 10000) / 100;
        setInitialPct((prev) => ({ ...prev, [casheaM.id]: String(pct) }));
        setPayments((prev) => ({
          ...prev,
          [m.id]: val,
          [casheaM.id]: (casheaM.currency === 'USD' ? financedUsd : financedUsd * rate.value).toFixed(2),
        }));
        return;
      }
    }
    if (isCashea(m) || cashIds.length !== 2) {
      setPayments((prev) => ({ ...prev, [m.id]: val }));
      return;
    }
    const other = methods.find((x) => x.id === cashIds.find((id) => id !== m.id));
    const dmOf = (om) => (casheaSelected ? 0 : isForeignCash(om) ? effD : effDv);
    const dm = dmOf(m); const dOther = dmOf(other);
    const thisUsd = toUsd(m, parseAmt(val));
    const covered = dm > 0 ? thisUsd / (1 - dm) : thisUsd;
    const left = Math.max(0, dueUsd - listUsd - covered);
    const otherNet = left * (1 - dOther);
    const otherAmt = left > PAY_EPS ? (other.currency === 'USD' ? otherNet : otherNet * rate.value).toFixed(2) : '';
    setPayments((prev) => ({ ...prev, [m.id]: val, [other.id]: otherAmt }));
  };

  const toggleMethod = (m) => {
    if (selectedMethods.includes(m.id)) {
      const rest = selectedMethods.filter((x) => x !== m.id);
      const restCashea = rest.some((id) => isCashea(methods.find((x) => x.id === id)));
      const restCash = rest.filter((id) => !isCashea(methods.find((x) => x.id === id)));
      setSelectedMethods(rest);
      // Si queda un solo método de contado (y no hay Cashea), queda como si se
      // hubiera elegido de primero: cubre toda la venta con su descuento.
      if (!restCashea && restCash.length === 1) {
        const om = methods.find((x) => x.id === restCash[0]);
        setPayments((p) => { const n = { ...p }; delete n[m.id]; n[om.id] = fullAmountFor(om, false); return n; });
        return;
      }
      setPayments((p) => { const n = { ...p }; delete n[m.id]; return n; });
      // Se quitó el último Cashea con varios métodos: vuelven los descuentos.
      if (isCashea(m) && !restCashea) rescaleForCashea(false, rest);
      return;
    }
    if (isCashea(m) && !casheaSelected) rescaleForCashea(true, selectedMethods);
    // Al agregar un método adicional (ya hay al menos uno seleccionado),
    // autocompleta su input con el saldo exacto pendiente en la moneda del
    // método —con o sin descuento por divisa— sin tener que pulsar "Exacto".
    // Cashea se rellena con su % de inicial aunque sea el primero, para que al
    // volver a seleccionarlo no quede el % puesto y el monto vacío.
    // Cashea entra con la inicial ya puesta (la del negocio, 40% por defecto,
    // o la que se escribió antes en esta venta).
    // Cualquier otro método se llena con lo que falta: el primero, con toda la
    // venta (no hace falta tocar "Exacto").
    if (isCashea(m)) setCasheaPct(m, initialPct[m.id] || String(casheaDefault));
    else fillExact(m);
    setSelectedMethods((prev) => [...prev, m.id]);
  };

  const fillExact = (m) => {
    // En Cashea, "exacto" es lo que financia según el % de inicial escrito.
    if (isCashea(m)) {
      const pct = parseAmt(initialPct[m.id]);
      if (pct > 0 && pct < 100) { setCasheaPct(m, initialPct[m.id]); return; }
    }
    // Restante en USD (lista) sin contar lo ya escrito en este método.
    const cur = parseAmt(payments[m.id]);
    // Descuento que le toca a este método: divisa d, Bs dv, Cashea ninguno.
    const dm = isCashea(m) ? 0 : isForeignCash(m) ? d : dv;
    const curUsd = toUsd(m, cur);
    const creditOfThis = dm > 0 ? curUsd / (1 - dm) : curUsd;
    const remaining = dueUsd - (paidUsd - creditOfThis);
    if (remaining <= PAY_EPS) return;
    // Se cobra el saldo con el descuento del método: remaining*(1-dm).
    const net = remaining * (1 - dm);
    const amount = m.currency === 'USD' ? net : net * rate.value;
    setPayments((prev) => ({ ...prev, [m.id]: amount.toFixed(2) }));
  };

  // Lo que financia Cashea no se escribe: sale del % y del total. Si cambia el
  // total, la tasa o un descuento especial, se recalcula solo (y la inicial,
  // si la cobra un solo método).
  useEffect(() => {
    selectedMethods.forEach((id) => {
      const m = methods.find((x) => x.id === id);
      if (!isCashea(m)) return;
      const pct = parseAmt(initialPct[id]);
      if (!(pct > 0 && pct < 100)) return;
      setCasheaPct(m, initialPct[id]);
    });
  }, [dueUsd, rate.value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reparte la venta con el % de inicial que escribe la vendedora: la inicial
  // la cobra la tienda con sus métodos y el resto queda financiado por Cashea.
  const setCasheaPct = (m, value) => {
    setInitialPct((prev) => ({ ...prev, [m.id]: value }));
    const pct = parseAmt(value);
    if (!(pct > 0 && pct < 100)) { setPayments((prev) => ({ ...prev, [m.id]: '' })); return; }
    const financedUsd = dueUsd * (1 - pct / 100);
    const amount = m.currency === 'USD' ? financedUsd : financedUsd * rate.value;
    // Si hay un solo método más, ese cobra la inicial (a precio de lista: con
    // Cashea no hay descuento de contado).
    const others = selectedMethods.filter((id) => id !== m.id && !isCashea(methods.find((x) => x.id === id)));
    const initialUsd = dueUsd - financedUsd;
    setPayments((prev) => {
      const n = { ...prev, [m.id]: amount.toFixed(2) };
      if (others.length === 1) {
        const om = methods.find((x) => x.id === others[0]);
        n[om.id] = (om.currency === 'USD' ? initialUsd : initialUsd * rate.value).toFixed(2);
      }
      return n;
    });
  };

  // ------- cliente -------
  const custMatches = custSearch.trim()
    ? customers.filter((c) => {
        const q = custSearch.trim().toLowerCase();
        const qd = q.replace(/[^a-z0-9]/g, '');
        return c.name.toLowerCase().includes(q)
          || (qd && (c.document || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(qd));
      }).slice(0, 6)
    : [];

  const pickCustomer = (c) => { setSelectedCustomer(c); setCustSearch(''); setShowNewCust(false); };
  const setNew = (k) => (e) => setNewCust((f) => ({ ...f, [k]: e.target.value }));
  const resetCustomer = () => { setSelectedCustomer(null); setCustSearch(''); setShowNewCust(false); setNewCust(EMPTY_CUST); };

  // Configuración del negocio: cliente obligatorio y qué datos exige al
  // crearlo desde el POS (el nombre siempre es obligatorio al crear).
  const custCfg = business?.customer_config || {};
  const custRequired = !!custCfg.required;
  const custFieldReq = (k) => !!custCfg.fields?.[k];

  // Qué le falta al cliente para poder finalizar (se muestra en rojo debajo del
  // bloque antes de tocar "Finalizar venta", que queda deshabilitado).
  const creatingCustNow = !selectedCustomer && showNewCust && !!newCust.name.trim();
  // El documento es único: si ya hay un cliente con esa cédula/RIF, se ofrece
  // usarlo en vez de registrarlo otra vez.
  const dupCustomer = !selectedCustomer && showNewCust ? findByDoc(customers, docOf(newCust)) : null;
  const custIssue = (() => {
    if (!selectedCustomer && showNewCust) {
      const anyTyped = newCust.name.trim() || newCust.document.trim() || newCust.phone.trim() || newCust.email.trim();
      if (dupCustomer) return `Ya existe un cliente con el documento ${dupCustomer.document}: toca «Usar este cliente».`;
      if (!newCust.name.trim()) return custRequired || anyTyped ? 'Escribe el nombre del cliente.' : null;
      if (custFieldReq('document') && !newCust.document.trim()) return 'El documento del cliente es obligatorio.';
      if (custFieldReq('phone') && !newCust.phone.trim()) return 'El teléfono del cliente es obligatorio.';
      if (newCust.email.trim() && !EMAIL_RE.test(newCust.email.trim())) return 'El correo no es válido.';
      return null;
    }
    if (custRequired && !selectedCustomer) return 'Este negocio requiere el cliente: búscalo o toca «Nuevo cliente» para registrarlo.';
    return null;
  })();

  // Props compartidas del bloque de cliente: se renderiza en el resumen
  // (desktop) y dentro de la hoja de pago (móvil, donde el resumen queda
  // tapado por la hoja).
  const customerBlockProps = {
    required: custRequired, fieldReq: custFieldReq,
    selectedCustomer, resetCustomer, showNewCust, setShowNewCust,
    newCust, setNew, setNewCust, custSearch, setCustSearch, custMatches, pickCustomer, dupCustomer,
    issue: stage === 'pay' ? custIssue : null,
  };

  // ------- categorías / filtros -------
  const filterables = taxonomies.filter((t) => t.taxonomy_terms.length > 0);

  // term_id → a qué taxonomía de variación pertenece, para pintar la talla y el
  // color en la tarjeta de los productos que los llevan como etiqueta.
  const varTax = useMemo(() => {
    const m = new Map();
    taxonomies.filter((t) => t.kind === 'variant').forEach((t, order) => {
      (t.taxonomy_terms || []).forEach((term) => m.set(term.id, { taxonomy: t.name, name: term.name, order }));
    });
    return m;
  }, [taxonomies]);

  const visible = (products || []).filter((p) => {
    if (offerOnly && !hasOffer(p)) return false;
    const q = search.toLowerCase();
    if (search && !p.name.toLowerCase().includes(q)
      && !(p.sku || '').toLowerCase().includes(q)
      && !(p.product_variants || []).some((v) => (v.sku || '').toLowerCase().includes(q))) return false;
    return Object.entries(filters).every(([, termId]) =>
      !termId || (p.product_terms || []).some((pt) => pt.term_id === termId));
  });

  async function onFinish() {
    setError(null);
    if (!rate.value) { setError('No hay tasa de cambio disponible. Configúrala en Negocio → Ventas.'); return; }
    // Validación del cliente según la configuración del negocio.
    if (custIssue) { setError(custIssue); return; }
    setBusy(true);
    try {
      // Resuelve el cliente: existente, nuevo (se crea) o ninguno.
      let customerId = selectedCustomer?.id || null;
      let customerName = selectedCustomer?.name || '';
      if (creatingCustNow) {
        const created = await createCustomer(business.id, {
          name: newCust.name.trim(), document: docOf(newCust),
          phone: newCust.phone.trim(), email: newCust.email.trim(),
        });
        setCustomers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        // Queda seleccionado: si la venta falla y se reintenta, no se vuelve a crear.
        setSelectedCustomer(created); setShowNewCust(false); setNewCust(EMPTY_CUST);
        customerId = created.id; customerName = created.name;
      }

      const items = cart.map((c) => ({ variant_id: c.id, quantity: c.qty }));
      const pays = selectedMethods
        .map((id) => methods.find((x) => x.id === id))
        .filter(Boolean)
        .map((m) => ({ m, amount: parseAmt(payments[m.id]) }))
        // Cashea va aunque no tenga monto: le avisa al servidor que no hay descuentos.
        .filter((x) => x.amount > 0 || isCashea(x.m))
        .map((x) => ({
          account_id: x.m.account_id, method_id: x.m.method_id,
          account_name: x.m.account_name, method_name: x.m.method_name,
          currency: x.m.currency, amount: x.amount,
        }));

      const created = await createOrder({
        items, payments: pays, rate: rate.value, rateSource: rate.source, customerId, customerName, branchId,
        foreignDiscount: Math.round(baseD * 10000) / 100,
        localDiscount: Math.round(baseDv * 10000) / 100,
        discountId: promoId,
        customPercent: choice === 'custom' ? parseAmt(custom.pct) : null,
        customName: choice === 'custom' ? custom.name.trim() : null,
      });
      notifySale(created.id); // push a los admins del negocio (fuego y olvido)
      const full = await fetchOrder(created.id);
      setFinished(full);
      setStage('done');
      setCart([]); setPayments({}); setSelectedMethods([]); setChoice('cash'); setCustom({ pct: '', name: '' }); resetCustomer(); setPanelOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function newOrder() {
    setFinished(null); setStage('shop'); setSearch(''); setFilters({});
  }

  // ============ Confirmación ============
  if (stage === 'done' && finished) {
    return (
      <div className="page">
        <header className="page-head no-print">
          <div>
            <h1>Venta finalizada</h1>
            <p className="page-sub">Venta Nº {finished.number} registrada.</p>
          </div>
          <div className="page-actions">
            <button className="btn ghost" onClick={newOrder}>Nueva venta</button>
            <button className="btn primary" onClick={() => window.print()}>Imprimir venta</button>
          </div>
        </header>
        <div className="receipt-wrap">
          <OrderReceipt business={business} order={finished} />
        </div>
        <div className="no-print" style={{ textAlign: 'center', marginTop: 20 }}>
          <button className="btn primary lg" onClick={newOrder}>+ Nueva venta</button>
        </div>
      </div>
    );
  }

  const rateBadge = rateError && !rate.value
    ? <span className="rate-chip warn">Sin tasa · configúrala en Negocio</span>
    : <Link to="/settings" className="rate-chip">{rate.label} · {money(rate.value)} Bs/$</Link>;

  return (
    <div className="page pos-page">
      <header className="page-head">
        <div>
          <h1>Nueva venta</h1>
          <p className="page-sub">Toca un producto para agregarlo a la venta.</p>
        </div>
        <div className="page-actions">
          {branches.length > 1 && currentBranch && <span className="rate-chip">🏬 {currentBranch.name}</span>}
          {rateBadge}
          <Link to="/orders/history" className="btn ghost">Historial</Link>
        </div>
      </header>

      {error && <div className="form-error no-print">{error}</div>}

      {cajaCerrada && (
        <div className="pos-cash-warn no-print">
          La caja está cerrada: lo que vendas ahora no va a entrar en el cierre del día.{' '}
          <button type="button" className="link-btn" onClick={() => setOpeningCash(true)}>Abrir caja</button>
        </div>
      )}
      {openingCash && (
        <OpenCashModal branchId={branchId} onClose={() => setOpeningCash(false)}
          onOpened={() => { setOpeningCash(false); setCajaCerrada(false); notifyCashChanged(); }} />
      )}

      <div className="pos">
        {/* -------- Área principal: catálogo o resumen -------- */}
        <section className="pos-main">
          {stage === 'shop' ? (
            <>
              <div className="pos-toolbar">
                <input className="pos-search" placeholder="Buscar producto o SKU…"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
                {(filterables.length > 0 || (products || []).some(hasOffer)) && (
                  <div className="filters">
                    {(products || []).some(hasOffer) && (
                      <button type="button" className={`chip-btn${offerOnly ? ' active' : ''}`}
                        onClick={() => setOfferOnly((v) => !v)}>🏷 En oferta</button>
                    )}
                    {filterables.map((t) => (
                      <select key={t.id} value={filters[t.id] || ''}
                        onChange={(e) => setFilters((f) => ({ ...f, [t.id]: e.target.value }))}>
                        <option value="">{t.name}: todas</option>
                        {t.taxonomy_terms.map((term) => (
                          <option key={term.id} value={term.id}>{term.name}</option>
                        ))}
                      </select>
                    ))}
                  </div>
                )}
              </div>

              {products === null ? (
                <div className="empty">Cargando…</div>
              ) : visible.length === 0 ? (
                <div className="empty">
                  {products.length === 0
                    ? <>Aún no tienes productos. Agrégalos en <Link to="/inventory">Inventario</Link>.</>
                    : 'Ningún producto coincide con la búsqueda.'}
                </div>
              ) : (
                <div className="product-grid">
                  {visible.map((p) => {
                    const qty = cartQtyForProduct(p);
                    const stock = totalStock(p, branchId);
                    const tracked = tracksStock(p);
                    const agotado = !tracked && !variantsOf(p).some((v) => availableIn(v, branchId));
                    const simple = isSimple(p);
                    const dv = simple ? defaultVariant(p) : null;
                    const img = productImg(p);
                    const inCartLine = dv ? cart.find((c) => c.id === dv.id) : null;
                    return (
                      <div key={p.id} className={`product-card${qty ? ' in-cart' : ''}${agotado ? ' sold-out' : ''}`} aria-disabled={agotado || undefined}
                        onClick={() => (simple && inCartLine ? setQty(dv.id, 0) : onTapProduct(p))}
                        role="button" tabIndex={0}>
                        {qty > 0 && <span className="product-qty-badge">{qty}</span>}
                        <div className="product-card-thumb">
                          {img ? <img src={img} alt="" loading="lazy" /> : <span className="thumb-ph">{p.name.slice(0, 1)}</span>}
                        </div>
                        <div className="product-card-head">
                          <div className="product-card-name">{p.name}</div>
                          {cardAttrs(p, branchId, varTax).map(({ axis, values, rest, soldOut }) => (
                            <div className={`product-card-axis${soldOut ? ' out' : ''}`} key={axis}>
                              <span className="pca-name">{axis}</span>
                              {values.map((v) => <span className="pca-value" key={v}>{v}</span>)}
                              {rest > 0 && <span className="pca-more">+{rest}</span>}
                            </div>
                          ))}
                        </div>
                        <div className="product-card-meta">
                          {tracked
                            ? <span className={`stock-badge${stock <= 0 ? ' out' : ''}`}>{stock} {p.unit}</span>
                            : agotado && <span className="stock-badge out">Agotado</span>}
                          {!simple && <span className="variant-count">{variantsOf(p).length} variantes</span>}
                        </div>
                        {hasOffer(p) && <span className="offer-flag">🏷 {offerTag(p)}</span>}
                        <div className="product-card-prices">
                          {hasOffer(p) ? (
                            <>
                              <strong>{usd(offerPrice(p.price, p))}</strong>
                              <span className="offer-old">{usd(p.price)}</span>
                              <span className="product-card-bs">{bs(offerPrice(p.price, p) * rate.value)}</span>
                            </>
                          ) : (
                            <>
                              <strong>{usd(p.price)}</strong>
                              <span className="product-card-bs">{bs(Number(p.price) * rate.value)}</span>
                            </>
                          )}
                        </div>
                        {simple && inCartLine && (
                          <div className="qty-stepper card-stepper" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => setQty(dv.id, inCartLine.qty - 1)} aria-label="Quitar uno">−</button>
                            <input value={inCartLine.qty} inputMode="numeric"
                              onChange={(e) => setQty(dv.id, Math.max(0, parseInt(e.target.value, 10) || 0))} />
                            <button onClick={() => addVariant(p, dv)} aria-label="Agregar uno">+</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* -------- Etapa de pago: ticket con todo el desglose -------- */
            <div className="pos-ticket-col">
              <div className="pos-ticket">
                <div className="pos-ticket-head">
                  <span className="pos-ticket-eyebrow">Resumen de la venta</span>
                  <button className="btn ghost sm" onClick={() => setStage('shop')}>← Seguir agregando</button>
                </div>

                {/* Artículos: contador y miniaturas; el detalle, en un modal */}
                <button type="button" className="pos-items-row" onClick={() => setItemsOpen(true)}>
                  <span className="pos-items-thumbs" aria-hidden="true">
                    {cart.slice(0, 4).map((c) => {
                      const img = cartImg(c);
                      return (
                        <span className="pos-items-thumb" key={c.id}>
                          {img ? <img src={img} alt="" loading="lazy" /> : <span>{c.name.slice(0, 1)}</span>}
                        </span>
                      );
                    })}
                    {cart.length > 4 && <span className="pos-items-thumb more">+{cart.length - 4}</span>}
                  </span>
                  <span className="pos-items-text">
                    <strong>{cartCount} {cartCount === 1 ? 'artículo' : 'artículos'}</strong>
                    <span>Ver detalle</span>
                  </span>
                  <span className="pos-items-total">{usd(totalUsd)}</span>
                  <svg className="pos-items-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>

                {/* Desglose de totales: una línea por concepto, como en el panel */}
                <div className="pos-ticket-sum totals">
                  {discountUsd > 0.005 ? (
                    <>
                      <div className="totals-row"><span>Total lista</span><span>{usd(totalUsd)}</span></div>
                      <div className="totals-row ok"><span>{discountLabel}</span><span>−{usd(discountUsd)}</span></div>
                      <div className="totals-row grand"><span>A pagar</span><span>{usd(netTotalUsd)}</span></div>
                      <div className="totals-row"><span className="muted">A pagar en Bs</span><span className="muted">{bs(netTotalUsd * rate.value)}</span></div>
                    </>
                  ) : (
                    <>
                      <div className="totals-row grand"><span>Total</span><span>{usd(totalUsd)}</span></div>
                      <div className="totals-row"><span>Total Bs</span><span>{bs(totalVes)}</span></div>
                    </>
                  )}
                  {casheaUsd > PAY_EPS ? (
                    <>
                      <div className="totals-row"><span>Cobrado ahora</span><span>{usd(cashedUsd)}</span></div>
                      <div className="totals-row"><span className="muted">Financia Cashea</span><span className="muted">{usd(casheaUsd)}</span></div>
                    </>
                  ) : (
                    <div className="totals-row"><span>Pagado</span><span>{usd(receivedUsd)}</span></div>
                  )}
                  {!isCovered
                    ? (
                      <div className="totals-row warn">
                        <span>{casheaUsd > PAY_EPS ? 'Falta cobrar la inicial' : 'Restante'}</span>
                        <span>{usd(remainingNet)}</span>
                      </div>
                    )
                    : changeNet > PAY_EPS && <div className="totals-row ok"><span>Vuelto</span><span>{usd(changeNet)}</span></div>}
                </div>
              </div>

              {/* -------- Cliente: elegir existente o crear nuevo -------- */}
              <div className="card pos-ticket-customer">
                <CustomerBlock desktop {...customerBlockProps} />
              </div>
            </div>
          )}
        </section>

        {/* -------- Panel lateral: pedido o pago -------- */}
        <aside className={`pos-panel${panelOpen ? ' open' : ''}`}>
          {/* Barra resumen (móvil) para abrir/cerrar la hoja */}
          <button className="pos-panel-bar" onClick={() => setPanelOpen((v) => !v)}>
            <span>{cartCount} {cartCount === 1 ? 'artículo' : 'artículos'}</span>
            <span>{usd(totalUsd)} · {bs(totalVes)}</span>
          </button>

          <div className="pos-panel-body">
            <div className="pos-panel-scroll">
              {stage === 'shop' ? (
                <>
                  <div className="pos-panel-head">
                    <h2>Venta</h2>
                    {cart.length > 0 && <button className="btn ghost sm" onClick={() => setCart([])}>Vaciar</button>}
                  </div>
                  {cart.length === 0 ? (
                    <div className="pos-panel-empty">Aún no has agregado productos.</div>
                  ) : (
                    <div className="cart-lines">
                      {cart.map((c) => (
                        <div className="cart-line" key={c.id}>
                          <div className="cart-line-info">
                            <div className="cart-line-name">{c.name}{c.label && <span className="muted"> · {c.label}</span>}</div>
                            <div className="muted">{usd(c.price)} · {bs(c.price * rate.value)}</div>
                          </div>
                          <div className="qty-stepper">
                            <button onClick={() => setQty(c.id, c.qty - 1)} aria-label="Quitar uno">−</button>
                            <input value={c.qty} inputMode="numeric"
                              onChange={(e) => setQty(c.id, Math.max(0, parseInt(e.target.value, 10) || 0))} />
                            <button onClick={() => setQty(c.id, c.qty + 1)} aria-label="Agregar uno">+</button>
                          </div>
                          <div className="cart-line-total">{usd(c.price * c.qty)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="pos-panel-head">
                    <h2>Pago</h2>
                  </div>
                  {methods.length === 0 ? (
                    <div className="pos-panel-empty">
                      No hay métodos de pago. Agrégalos en <Link to="/settings">Negocio → Ventas</Link>.
                    </div>
                  ) : (
                    <>
                      {/* Métodos como pills: se pueden seleccionar varios */}
                      <div className="pay-block">
                        {/* Con Cashea elegido falta cobrar la inicial: el aviso
                            manda al cajero a los métodos de aquí abajo. */}
                        {casheaUsd > PAY_EPS && !isCovered && (
                          <div className="pay-warn">
                            Cobra la inicial <strong>{usd(remainingNet)}</strong>
                            {rate.value ? ` · ${bs(remainingNet * rate.value)}` : ''} — elige el método.
                          </div>
                        )}
                        <div className="pay-pills">
                          {/* Cashea primero: es la forma de pago que cambia la venta (precio de lista) */}
                          {[...methods].sort((x, y) => Number(isCashea(y)) - Number(isCashea(x))).map((m) => (
                            <button type="button" key={m.id}
                              className={`pay-pill${selectedMethods.includes(m.id) ? ' active' : ''}`}
                              onClick={() => toggleMethod(m)}>
                              {m.name}
                              <span className="pay-pill-cur">{m.currency === 'USD' ? '$' : 'Bs'}</span>
                            </button>
                          ))}
                        </div>
                        {selectedMethods.length === 0 && (
                          <div className="pay-hint">Selecciona uno o varios métodos de pago.</div>
                        )}
                      </div>

                      {/* Descuento de la venta: una sola fila con el elegido; al
                          tocarla se abre un modal para elegir otro y aplicarlo. */}
                      {(discounts.length > 0 || hasContado) && (
                        <div className="pay-dsel-wrap">
                          <span className="pay-dsel-title">Descuento</span>
                          {/* Vista previa: las opciones como pills en una fila (la
                              elegida primero y resaltada); toda la fila abre el
                              selector, por eso la flecha al borde. */}
                          <button type="button" className="pay-dsel" onClick={() => { setDiscPick(choice); setCustomDraft(custom); }}
                            aria-haspopup="dialog" aria-label={`Descuento: ${discSummary.name}. Cambiar`}>
                            <span className="pay-dsel-pills">
                              {[...discOptions].sort((a, b) => Number(b.id === choice) - Number(a.id === choice)).map((o) => (
                                <span key={o.id} className={`pay-dsel-pill${o.id === choice ? ' on' : ''}`}>
                                  {o.id === choice ? discSummary.name : o.name}{(o.id === choice ? discSummary.pct : o.pct) && <b>{o.id === choice ? discSummary.pct : o.pct}</b>}
                                </span>
                              ))}
                            </span>
                            <svg className="pay-dsel-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                          {discSummary.detail && <p className="pay-disc-detail">{discSummary.detail}</p>}
                        </div>
                      )}

                      {/* Un input por cada método seleccionado, con su equivalente en la otra moneda */}
                      {selectedMethods.length > 0 && (
                        <div className="pay-inputs">
                          {selectedMethods
                            .map((id) => methods.find((x) => x.id === id))
                            .filter(Boolean)
                            .sort((a, b) => Number(isCashea(b)) - Number(isCashea(a)))
                            .map((m) => (
                              <PayAmountRow key={m.id} m={m} rate={rate.value}
                                amount={payments[m.id] || ''}
                                onAmount={(val) => onAmountChange(m, val)}
                                onExact={() => fillExact(m)}
                                initialPct={isCashea(m) ? (initialPct[m.id] ?? '') : null}
                                onInitialPct={isCashea(m) ? (val) => setCasheaPct(m, val) : null}
                                totalUsd={dueUsd} />
                            ))}
                        </div>
                      )}
                    </>
                  )}
                  {/* En móvil el resumen queda tapado por esta hoja: el
                      cliente se captura aquí mismo. */}
                  <CustomerBlock {...customerBlockProps} />
                </>
              )}
            </div>

            {/* Totales y acción (fijos abajo) */}
            <div className="pos-panel-foot">
              {error && stage === 'pay' && <div className="form-error">{error}</div>}
              {stage === 'shop' ? (
                <div className="totals">
                  <div className="totals-row grand"><span>Total</span><span>{usd(totalUsd)}</span></div>
                  <div className="totals-row"><span>Total Bs</span><span>{bs(totalVes)}</span></div>
                </div>
              ) : (
                /* Lo único que hace falta mirar mientras se cobra: cuánto falta o
                   cuánto hay que dar de vuelto. El desglose está en el ticket. */
                <div className={`pay-status ${payStatus.tone}`} role="status" aria-live="polite">
                  <span className="pay-status-label">{payStatus.label}</span>
                  <span className="pay-status-amt">
                    <strong>{usd(payStatus.usd)}</strong>
                    {rate.value > 0 && <small>{bs(payStatus.usd * rate.value)}</small>}
                  </span>
                </div>
              )}
              {stage === 'shop' ? (
                <button className="btn primary lg block" disabled={cart.length === 0}
                  onClick={() => { setStage('pay'); setPanelOpen(true); }}>
                  Ir al pago
                </button>
              ) : (
                <button className="btn primary lg block"
                  disabled={busy || !isCovered || !!custIssue}
                  onClick={onFinish}>
                  {busy ? 'Guardando…' : 'Finalizar venta'}
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* -------- Artículos de la venta (desde el ticket) -------- */}
      {discPick && (
        <FinModal title="Descuento de la venta" sub="Elige cuál se aplica a esta venta. Queda guardado en la venta."
          onClose={() => setDiscPick(null)}
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setDiscPick(null)}>Cancelar</button>
              {discPick === 'custom' && !customOk && <span className="fm-foot-note">Escribe un % entre 1 y 99.</span>}
              <button type="button" className="btn primary" disabled={discPick === 'custom' && !customOk} onClick={() => {
                if (discPick === 'custom') { setCustom(customDraft); pickChoice('custom', customDsOf(customDraft)); }
                else pickChoice(discPick);
                setDiscPick(null);
              }}>Aplicar</button>
            </>
          )}>
          <div className="dopt-list" role="radiogroup" aria-label="Descuento de la venta">
            {discOptions.map((o) => (
              <div key={o.id}>
                <label className={`dopt${discPick === o.id ? ' on' : ''}`}>
                  <input type="radio" name="sale-discount" checked={discPick === o.id} onChange={() => setDiscPick(o.id)} />
                  <span className="dopt-text">
                    <span className="dopt-name">{o.name}</span>
                    {o.meta && <span className="dopt-meta">{o.meta}</span>}
                  </span>
                  {o.pct && <span className="dopt-pct">{o.pct}</span>}
                </label>
                {o.id === 'custom' && discPick === 'custom' && (
                  <div className="dopt-custom">
                    <label className="dopt-custom-pct">
                      <span>Descuento</span>
                      <span className="pay-pct-field">
                        <input inputMode="decimal" value={customDraft.pct} placeholder="0" autoFocus aria-label="Descuento personalizado (%)"
                          onChange={(e) => setCustomDraft((c) => ({ ...c, pct: e.target.value }))} />
                        <span className="pay-pct-sign">%</span>
                      </span>
                    </label>
                    <label className="dopt-custom-name">
                      <span>Nombre (opcional)</span>
                      <input value={customDraft.name} maxLength={40} placeholder="Ej.: Cliente fiel"
                        onChange={(e) => setCustomDraft((c) => ({ ...c, name: e.target.value }))} />
                    </label>
                  </div>
                )}
                {o.id === 'cash' && discPick === 'cash' && discRows.map((r) => (
                  <div className="dopt-sub" key={r.kind}>
                    <span>{r.label}</span>
                    <span className="pay-pct-field">
                      <input inputMode="decimal" value={discCfg[r.kind].pct} aria-label={`${r.label} (%)`}
                        onChange={(e) => changeDisc(r.kind, { pct: e.target.value })} />
                      <span className="pay-pct-sign">%</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </FinModal>
      )}

      {itemsOpen && (
        <FinModal title={`${cartCount} ${cartCount === 1 ? 'artículo' : 'artículos'}`} sub="Detalle de la venta"
          onClose={() => setItemsOpen(false)}
          footer={(
            <>
              <span className="fm-foot-note">Total {usd(totalUsd)} · {bs(totalVes)}</span>
              <button type="button" className="btn ghost" onClick={() => { setItemsOpen(false); setStage('shop'); }}>Editar artículos</button>
              <button type="button" className="btn primary" onClick={() => setItemsOpen(false)}>Listo</button>
            </>
          )}>
          <div className="pos-items-list">
            {cart.map((c) => {
              const img = cartImg(c);
              return (
                <div className="pos-items-line" key={c.id}>
                  <span className="pos-items-thumb lg">
                    {img ? <img src={img} alt="" loading="lazy" /> : <span>{c.name.slice(0, 1)}</span>}
                  </span>
                  <span className="pos-items-info">
                    <strong>{c.name}</strong>
                    <span>{[c.label, `${c.qty} × ${usd(c.price)}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="pos-items-amt">
                    <strong>{usd(c.price * c.qty)}</strong>
                    <span>{bs(c.price * c.qty * rate.value)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </FinModal>
      )}

      {/* -------- Selector de variante (color + talla) -------- */}
      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(null)}>
          <div className="modal card variant-picker" onClick={(e) => e.stopPropagation()}>
            <div className="pos-panel-head">
              <h2>{picker.name}</h2>
              <button className="btn ghost sm" onClick={() => setPicker(null)}>Listo</button>
            </div>
            <p className="page-sub">Elige la variante a agregar.</p>
            <div className="variant-pick-grid">
              {variantsOf(picker).map((v) => {
                const inCart = cart.find((c) => c.id === v.id);
                const vStock = branchStock(v, branchId);
                const tracked = tracksStock(picker);
                const out = tracked ? vStock <= 0 : !availableIn(v, branchId);
                const img = variantImg(picker, v);
                return (
                  <div key={v.id} className={`variant-pick${inCart ? ' in-cart' : ''}${!tracked && out ? ' sold-out' : ''}`}
                    role="button" tabIndex={0}
                    onClick={() => (inCart ? setQty(v.id, 0) : addVariant(picker, v))}>
                    {inCart && <span className="product-qty-badge">{inCart.qty}</span>}
                    <div className="product-card-thumb sm">
                      {img ? <img src={img} alt="" loading="lazy" /> : <span className="thumb-ph">{(variantLabel(v.attributes) || picker.name).slice(0, 1)}</span>}
                    </div>
                    <div className="variant-pick-label">{variantLabel(v.attributes, picker.variant_axes) || 'Estándar'}</div>
                    <div className="product-card-meta">
                      {tracked
                        ? <span className={`stock-badge${out ? ' out' : ''}`}>{vStock} {picker.unit}</span>
                        : out && <span className="stock-badge out">Agotado</span>}
                    </div>
                    <div className="product-card-prices">
                      <strong>{usd(effPrice(picker, v))}</strong>
                      {hasOffer(picker) && <span className="offer-old">{usd(variantPrice(picker, v))}</span>}
                    </div>
                    {inCart && (
                      <div className="qty-stepper card-stepper" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setQty(v.id, inCart.qty - 1)} aria-label="Quitar uno">−</button>
                        <input value={inCart.qty} inputMode="numeric"
                          onChange={(e) => setQty(v.id, Math.max(0, parseInt(e.target.value, 10) || 0))} />
                        <button onClick={() => addVariant(picker, v)} aria-label="Agregar uno">+</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
