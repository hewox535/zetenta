import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  updateBusinessProfile, setWithholdingSeq,
  fetchTaxonomies, createTaxonomy, deleteTaxonomy, deleteTerm,
  fetchPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod,
  updateOrderSettings,
} from '../lib/api';
import { fetchBcvRates } from '../lib/rates';
import { money } from '../lib/calc';

export default function Settings() {
  const { business, capabilities, refreshBusiness } = useAuth();
  const [section, setSection] = useState('fiscal');

  if (!business) {
    return <div className="page"><div className="empty">Tu usuario no tiene un negocio asociado.</div></div>;
  }

  const tabs = [
    { key: 'fiscal', label: 'Datos fiscales' },
    capabilities?.retentions && { key: 'retentions', label: 'Retenciones' },
    capabilities?.inventory && { key: 'inventory', label: 'Inventario' },
    capabilities?.orders && { key: 'orders', label: 'Pedidos' },
  ].filter(Boolean);

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Negocio</h1>
          <p className="page-sub">Configuración de {business.name}.</p>
        </div>
      </header>

      <nav className="settings-nav">
        {tabs.map((t) => (
          <button key={t.key} className={`settings-tab${section === t.key ? ' active' : ''}`}
            onClick={() => setSection(t.key)}>{t.label}</button>
        ))}
      </nav>

      {section === 'fiscal' && <FiscalSection business={business} refreshBusiness={refreshBusiness} />}
      {section === 'retentions' && <RetentionSection business={business} refreshBusiness={refreshBusiness} />}
      {section === 'inventory' && <InventorySection business={business} />}
      {section === 'orders' && <OrdersSection business={business} refreshBusiness={refreshBusiness} />}
    </div>
  );
}

// ---------- Datos fiscales ----------
function FiscalSection({ business, refreshBusiness }) {
  const [name, setName] = useState(business.name ?? '');
  const [rif, setRif] = useState(business.rif ?? '');
  const [address, setAddress] = useState(business.fiscal_address ?? '');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null); setSaved(false); setBusy(true);
    try {
      await updateBusinessProfile({ name: name.trim(), rif: rif.trim().toUpperCase(), fiscalAddress: address.trim() });
      await refreshBusiness();
      setSaved(true);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={onSubmit} className="vform">
      <section className="card vsection">
        <label>Razón social<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>RIF<input value={rif} onChange={(e) => setRif(e.target.value)} required placeholder="J-313620220" /></label>
        <label>Dirección fiscal<input value={address} onChange={(e) => setAddress(e.target.value)} required /></label>
      </section>
      {error && <div className="form-error">{error}</div>}
      {saved && <div className="form-ok">Datos guardados.</div>}
      <button className="btn primary lg block" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
    </form>
  );
}

// ---------- Retenciones ----------
function RetentionSection({ business, refreshBusiness }) {
  const [lastSeq, setLastSeq] = useState(String(business.withholding_seq - 1));
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null); setSaved(false); setBusy(true);
    try {
      const last = Number(lastSeq);
      if (Number.isInteger(last) && last >= 0 && last !== business.withholding_seq - 1) {
        await setWithholdingSeq(last);
        await refreshBusiness();
      }
      setSaved(true);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={onSubmit} className="vform">
      <section className="card vsection">
        <h2>Numeración de comprobantes</h2>
        <label>
          Último comprobante emitido
          <input type="number" min="0" max="99999999" step="1" value={lastSeq}
            onChange={(e) => setLastSeq(e.target.value)} required />
        </label>
        <p className="hint">
          El próximo comprobante será el Nº {Number.isInteger(Number(lastSeq)) && Number(lastSeq) >= 0
            ? String(Number(lastSeq) + 1).padStart(8, '0')
            : String(business.withholding_seq).padStart(8, '0')}.
          Si ya emitiste retenciones fuera del sistema (por ejemplo, van 137), colócalo aquí y la siguiente será la 138.
        </p>
      </section>
      {error && <div className="form-error">{error}</div>}
      {saved && <div className="form-ok">Datos guardados.</div>}
      <button className="btn primary lg block" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
    </form>
  );
}

// ---------- Inventario: categorías de productos ----------
function InventorySection({ business }) {
  const [taxonomies, setTaxonomies] = useState([]);
  const [newTax, setNewTax] = useState('');
  const [taxError, setTaxError] = useState(null);

  useEffect(() => { fetchTaxonomies().then(setTaxonomies).catch((e) => setTaxError(e.message)); }, []);

  async function onAddTaxonomy() {
    const name = newTax.trim();
    if (!name) return;
    setTaxError(null);
    try {
      const created = await createTaxonomy(business.id, name);
      setTaxonomies((prev) => [...prev, created]);
      setNewTax('');
    } catch (e) {
      setTaxError(e.message.includes('duplicate') ? `Ya existe una categoría llamada "${name}".` : e.message);
    }
  }
  async function onDeleteTaxonomy(t) {
    if (!confirm(`¿Eliminar la categoría "${t.name}" y todos sus valores? Los productos perderán esa clasificación.`)) return;
    try {
      await deleteTaxonomy(t.id);
      setTaxonomies((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) { setTaxError(e.message); }
  }
  async function onDeleteTerm(t, term) {
    if (!confirm(`¿Eliminar "${term.name}" de ${t.name}? Se quitará de los productos que lo usan.`)) return;
    try {
      await deleteTerm(term.id);
      setTaxonomies((prev) => prev.map((x) => (
        x.id === t.id ? { ...x, taxonomy_terms: x.taxonomy_terms.filter((y) => y.id !== term.id) } : x
      )));
    } catch (e) { setTaxError(e.message); }
  }

  return (
    <section className="card vsection tax-section">
      <h2>Categorías de productos</h2>
      <p className="hint">
        Cómo clasificas tu inventario (Marca, Modelo, Talla…). Los valores se crean al
        escribirlos en el formulario de nuevo producto; aquí puedes eliminarlos.
      </p>
      {taxonomies.map((t) => (
        <div className="tax-row" key={t.id}>
          <div className="tax-head">
            <strong>{t.name}</strong>
            <button type="button" className="btn danger sm" onClick={() => onDeleteTaxonomy(t)}>Eliminar</button>
          </div>
          <div className="chips">
            {t.taxonomy_terms.length === 0 && <span className="hint">Sin valores todavía.</span>}
            {[...t.taxonomy_terms].sort((a, b) => a.name.localeCompare(b.name)).map((term) => (
              <span className="chip" key={term.id}>
                {term.name}
                <button type="button" aria-label={`Eliminar ${term.name}`} onClick={() => onDeleteTerm(t, term)}>×</button>
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="inline-form">
        <label>
          Nueva categoría
          <input value={newTax} onChange={(e) => setNewTax(e.target.value)} placeholder="Talla, Color, Categoría…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddTaxonomy(); } }} />
        </label>
        <div className="inline-form-actions">
          <button type="button" className="btn" onClick={onAddTaxonomy}>Agregar</button>
        </div>
      </div>
      {taxError && <div className="form-error">{taxError}</div>}
    </section>
  );
}

// ---------- Pedidos: tasa de cambio + métodos de pago ----------
function OrdersSection({ business, refreshBusiness }) {
  const cfg = business.rate_config || { mode: 'bcv', currency: 'USD' };
  const [mode, setMode] = useState(cfg.mode || 'bcv');
  const [currency, setCurrency] = useState(cfg.currency || 'USD');
  const [manual, setManual] = useState(cfg.mode === 'manual' ? String(cfg.value ?? '') : '');
  const [bcv, setBcv] = useState(null);
  const [rateSaved, setRateSaved] = useState(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateError, setRateError] = useState(null);

  const [methods, setMethods] = useState([]);
  const [mName, setMName] = useState('');
  const [mCurrency, setMCurrency] = useState('VES');
  const [mError, setMError] = useState(null);

  useEffect(() => {
    fetchBcvRates().then(setBcv).catch(() => {});
    fetchPaymentMethods().then(setMethods).catch((e) => setMError(e.message));
  }, []);

  async function saveRate() {
    setRateError(null); setRateSaved(false); setRateBusy(true);
    try {
      const rateConfig = mode === 'manual'
        ? { mode: 'manual', value: Number(manual) || 0 }
        : { mode: 'bcv', currency };
      await updateOrderSettings(rateConfig);
      await refreshBusiness();
      setRateSaved(true);
    } catch (e) { setRateError(e.message); } finally { setRateBusy(false); }
  }

  async function addMethod() {
    const name = mName.trim();
    if (!name) return;
    setMError(null);
    try {
      const created = await createPaymentMethod(business.id, { name, currency: mCurrency });
      setMethods((prev) => [...prev, created]);
      setMName(''); setMCurrency('VES');
    } catch (e) { setMError(e.message); }
  }
  async function toggleMethod(m) {
    try {
      const updated = await updatePaymentMethod(m.id, { active: !m.active });
      setMethods((prev) => prev.map((x) => (x.id === m.id ? updated : x)));
    } catch (e) { setMError(e.message); }
  }
  async function removeMethod(m) {
    if (!confirm(`¿Eliminar el método "${m.name}"?`)) return;
    try {
      await deletePaymentMethod(m.id);
      setMethods((prev) => prev.filter((x) => x.id !== m.id));
    } catch (e) { setMError(e.message); }
  }

  return (
    <div className="vform">
      <section className="card vsection">
        <h2>Tasa de cambio</h2>
        <p className="hint">Cómo se calculan los bolívares a partir de los precios en dólares.</p>
        <label className="radio-row">
          <input type="radio" name="ratemode" checked={mode === 'bcv'} onChange={() => setMode('bcv')} />
          <span>Tasa oficial del BCV (automática)</span>
        </label>
        {mode === 'bcv' && (
          <div className="rate-currency">
            <label className="radio-row inline">
              <input type="radio" name="cur" checked={currency === 'USD'} onChange={() => setCurrency('USD')} />
              <span>Dólar {bcv?.USD ? `· ${money(bcv.USD)} Bs` : ''}</span>
            </label>
            <label className="radio-row inline">
              <input type="radio" name="cur" checked={currency === 'EUR'} onChange={() => setCurrency('EUR')} />
              <span>Euro {bcv?.EUR ? `· ${money(bcv.EUR)} Bs` : ''}</span>
            </label>
          </div>
        )}
        <label className="radio-row">
          <input type="radio" name="ratemode" checked={mode === 'manual'} onChange={() => setMode('manual')} />
          <span>Tasa manual</span>
        </label>
        {mode === 'manual' && (
          <label>
            Bolívares por 1 dólar
            <input inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="40,00" />
          </label>
        )}
        {rateError && <div className="form-error">{rateError}</div>}
        {rateSaved && <div className="form-ok">Tasa actualizada.</div>}
        <button type="button" className="btn primary" disabled={rateBusy} onClick={saveRate}>
          {rateBusy ? 'Guardando…' : 'Guardar tasa'}
        </button>
      </section>

      <section className="card vsection">
        <h2>Métodos de pago</h2>
        <p className="hint">Los que aparecen al cobrar un pedido. Desactiva los que no uses.</p>
        <div className="method-list">
          {methods.map((m) => (
            <div className={`method-row${m.active ? '' : ' inactive'}`} key={m.id}>
              <div className="method-info">
                <span className="method-name">{m.name}</span>
                <span className="badge adjustment">{m.currency === 'USD' ? 'Dólares' : 'Bolívares'}</span>
              </div>
              <div className="method-actions">
                <button type="button" className={`switch${m.active ? ' on' : ''}`} role="switch"
                  aria-checked={m.active} onClick={() => toggleMethod(m)}><span className="switch-knob" /></button>
                <button type="button" className="btn danger sm" onClick={() => removeMethod(m)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
        <div className="inline-form">
          <label>Nuevo método<input value={mName} onChange={(e) => setMName(e.target.value)}
            placeholder="Zelle, Punto de venta, Efectivo Bs…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMethod(); } }} /></label>
          <label className="short">Moneda
            <select value={mCurrency} onChange={(e) => setMCurrency(e.target.value)}>
              <option value="VES">Bolívares</option>
              <option value="USD">Dólares</option>
            </select>
          </label>
          <div className="inline-form-actions">
            <button type="button" className="btn" onClick={addMethod}>Agregar</button>
          </div>
        </div>
        {mError && <div className="form-error">{mError}</div>}
      </section>
    </div>
  );
}
