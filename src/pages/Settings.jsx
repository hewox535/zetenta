import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  updateBusinessProfile, setWithholdingSeq,
  fetchTaxonomies, createTaxonomy, deleteTaxonomy, createTerm, updateTerm, deleteTerm,
  fetchPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod,
  updateOrderSettings, updateBusinessSettings,
  fetchStaff, createStaff, deleteStaff, setStaffRole,
} from '../lib/api';
import { fetchBcvRates } from '../lib/rates';
import { money } from '../lib/calc';

export default function Settings() {
  const { business, capabilities, refreshBusiness, profile } = useAuth();
  const [section, setSection] = useState('fiscal');

  if (!business) {
    return <div className="page"><div className="empty">Tu usuario no tiene un negocio asociado.</div></div>;
  }

  const tabs = [
    { key: 'fiscal', label: 'Datos fiscales' },
    capabilities?.retentions && { key: 'retentions', label: 'Retenciones' },
    capabilities?.inventory && { key: 'inventory', label: 'Inventario' },
    capabilities?.orders && { key: 'orders', label: 'Ventas' },
    { key: 'staff', label: 'Personal' },
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
      {section === 'inventory' && <InventorySection business={business} refreshBusiness={refreshBusiness} />}
      {section === 'orders' && <OrdersSection business={business} refreshBusiness={refreshBusiness} />}
      {section === 'staff' && <StaffSection profile={profile} />}
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

// ---------- Inventario: umbral de stock bajo + categorías + variaciones ----------
function InventorySection({ business, refreshBusiness }) {
  const [taxonomies, setTaxonomies] = useState([]);
  const [newCat, setNewCat] = useState('');
  const [newVar, setNewVar] = useState('');
  const [taxError, setTaxError] = useState(null);

  const [lowPct, setLowPct] = useState(String(business.low_stock_percent ?? 20));
  const [lowBusy, setLowBusy] = useState(false);
  const [lowSaved, setLowSaved] = useState(false);
  const [lowError, setLowError] = useState(null);

  useEffect(() => { fetchTaxonomies().then(setTaxonomies).catch((e) => setTaxError(e.message)); }, []);

  async function saveLowStock() {
    setLowError(null); setLowSaved(false); setLowBusy(true);
    try {
      await updateBusinessSettings({
        foreignDiscountPercent: business.foreign_discount_percent ?? 0,
        lowStockPercent: Number(lowPct) || 0,
      });
      await refreshBusiness();
      setLowSaved(true);
    } catch (e) { setLowError(e.message); } finally { setLowBusy(false); }
  }

  async function onAddTaxonomy(kind) {
    const name = (kind === 'variant' ? newVar : newCat).trim();
    if (!name) return;
    setTaxError(null);
    try {
      const created = await createTaxonomy(business.id, name, kind);
      setTaxonomies((prev) => [...prev, created]);
      if (kind === 'variant') setNewVar(''); else setNewCat('');
    } catch (e) {
      setTaxError(e.message.includes('duplicate') ? `Ya existe algo llamado "${name}".` : e.message);
    }
  }
  async function onDeleteTaxonomy(t) {
    const what = t.kind === 'variant' ? 'el eje de variación' : 'la categoría';
    if (!confirm(`¿Eliminar ${what} "${t.name}" y todos sus valores? Los productos perderán esa clasificación.`)) return;
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
  async function onAddTerm(t, name) {
    const value = name.trim();
    if (!value) return;
    setTaxError(null);
    try {
      const created = await createTerm(t.id, value);
      setTaxonomies((prev) => prev.map((x) => (
        x.id === t.id ? { ...x, taxonomy_terms: [...x.taxonomy_terms, created] } : x
      )));
    } catch (e) {
      setTaxError(e.message.includes('duplicate') ? `"${value}" ya existe en ${t.name}.` : e.message);
    }
  }
  async function onRenameTerm(t, term, name) {
    const value = name.trim();
    if (!value || value === term.name) return;
    setTaxError(null);
    try {
      const updated = await updateTerm(term.id, value);
      setTaxonomies((prev) => prev.map((x) => (
        x.id === t.id ? { ...x, taxonomy_terms: x.taxonomy_terms.map((y) => (y.id === term.id ? updated : y)) } : x
      )));
    } catch (e) {
      setTaxError(e.message.includes('duplicate') ? `"${value}" ya existe en ${t.name}.` : e.message);
    }
  }

  return (
    <div className="vform">
    <section className="card vsection">
      <h2>Alerta de stock bajo</h2>
      <p className="hint">
        Se marca una variante como stock bajo cuando su existencia cae al porcentaje
        indicado de su <strong>stock objetivo</strong> (el objetivo se define por
        variante en Inventario). Las variantes sin objetivo no generan alerta.
      </p>
      <label className="short">
        Umbral (%)
        <input type="number" min="0" max="100" step="1" value={lowPct}
          onChange={(e) => setLowPct(e.target.value)} />
      </label>
      {lowError && <div className="form-error">{lowError}</div>}
      {lowSaved && <div className="form-ok">Umbral guardado.</div>}
      <button type="button" className="btn primary" disabled={lowBusy} onClick={saveLowStock}>
        {lowBusy ? 'Guardando…' : 'Guardar umbral'}
      </button>
    </section>

    <TaxGroup
      title="Categorías de productos"
      hint="Cómo clasificas el producto (Marca, Modelo, Categoría…). Aparecen como campos al crear/editar un producto."
      taxonomies={taxonomies.filter((t) => t.kind !== 'variant')}
      placeholder="Categoría, Marca, Modelo…"
      addLabel="Nueva categoría"
      value={newCat} onChange={setNewCat} onAdd={() => onAddTaxonomy('category')}
      onDeleteTaxonomy={onDeleteTaxonomy} onAddTerm={onAddTerm} onRenameTerm={onRenameTerm} onDeleteTerm={onDeleteTerm}
    />

    <TaxGroup
      title="Variaciones (ejes)"
      hint="Por qué varía un producto (Color, Talla…) y sus valores. Al crear un producto eliges por cuáles varía y agregas cada combinación con su stock."
      taxonomies={taxonomies.filter((t) => t.kind === 'variant')}
      placeholder="Color, Talla…"
      addLabel="Nuevo eje de variación"
      value={newVar} onChange={setNewVar} onAdd={() => onAddTaxonomy('variant')}
      onDeleteTaxonomy={onDeleteTaxonomy} onAddTerm={onAddTerm} onRenameTerm={onRenameTerm} onDeleteTerm={onDeleteTerm}
    />

    {taxError && <div className="form-error">{taxError}</div>}
    </div>
  );
}

// Grupo reutilizable de taxonomías con gestión de valores (agregar/editar/eliminar).
function TaxGroup({ title, hint, taxonomies, placeholder, addLabel, value, onChange, onAdd, onDeleteTaxonomy, onAddTerm, onRenameTerm, onDeleteTerm }) {
  const [newVals, setNewVals] = useState({});      // { taxId: 'texto' }
  const [editing, setEditing] = useState(null);    // { termId, text }
  const setVal = (id, v) => setNewVals((s) => ({ ...s, [id]: v }));

  return (
    <section className="card vsection tax-section">
      <h2>{title}</h2>
      <p className="hint">{hint}</p>
      {taxonomies.length === 0 && <p className="hint">Aún no hay nada aquí.</p>}
      {taxonomies.map((t) => (
        <div className="tax-row" key={t.id}>
          <div className="tax-head">
            <strong>{t.name}</strong>
            <button type="button" className="btn danger sm" onClick={() => onDeleteTaxonomy(t)}>Eliminar</button>
          </div>
          <div className="chips">
            {t.taxonomy_terms.length === 0 && <span className="hint">Sin valores todavía.</span>}
            {[...t.taxonomy_terms].sort((a, b) => a.name.localeCompare(b.name)).map((term) => (
              editing?.termId === term.id ? (
                <span className="chip editing" key={term.id}>
                  <input autoFocus value={editing.text}
                    onChange={(e) => setEditing({ termId: term.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); onRenameTerm(t, term, editing.text); setEditing(null); }
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    onBlur={() => { onRenameTerm(t, term, editing.text); setEditing(null); }} />
                </span>
              ) : (
                <span className="chip" key={term.id}>
                  <button type="button" className="chip-name" title="Editar valor"
                    onClick={() => setEditing({ termId: term.id, text: term.name })}>{term.name}</button>
                  <button type="button" aria-label={`Eliminar ${term.name}`} onClick={() => onDeleteTerm(t, term)}>×</button>
                </span>
              )
            ))}
          </div>
          <div className="tax-add-term">
            <input value={newVals[t.id] || ''} placeholder={`Agregar valor a ${t.name}…`}
              onChange={(e) => setVal(t.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddTerm(t, newVals[t.id] || ''); setVal(t.id, ''); } }} />
            <button type="button" className="btn sm" onClick={() => { onAddTerm(t, newVals[t.id] || ''); setVal(t.id, ''); }}>+ Valor</button>
          </div>
        </div>
      ))}
      <div className="inline-form">
        <label>
          {addLabel}
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }} />
        </label>
        <div className="inline-form-actions">
          <button type="button" className="btn" onClick={onAdd}>Agregar</button>
        </div>
      </div>
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

  const [discount, setDiscount] = useState(String(business.foreign_discount_percent ?? 0));
  const [discBusy, setDiscBusy] = useState(false);
  const [discSaved, setDiscSaved] = useState(false);
  const [discError, setDiscError] = useState(null);

  useEffect(() => {
    fetchBcvRates().then(setBcv).catch(() => {});
    fetchPaymentMethods().then(setMethods).catch((e) => setMError(e.message));
  }, []);

  async function saveDiscount() {
    setDiscError(null); setDiscSaved(false); setDiscBusy(true);
    try {
      await updateBusinessSettings({
        foreignDiscountPercent: Number(discount) || 0,
        lowStockPercent: business.low_stock_percent ?? 20,
      });
      await refreshBusiness();
      setDiscSaved(true);
    } catch (e) { setDiscError(e.message); } finally { setDiscBusy(false); }
  }

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
        <h2>Descuento por pago en divisa</h2>
        <p className="hint">
          Descuento que se aplica <strong>solo</strong> a la parte de la venta que se paga
          en divisa (métodos en dólares). La parte pagada en bolívares no recibe descuento.
          Se calcula sobre el saldo pendiente que se liquida en divisa, no sobre el total.
        </p>
        <label className="short">
          Descuento (%)
          <input type="number" min="0" max="100" step="0.5" value={discount}
            onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
        </label>
        {discError && <div className="form-error">{discError}</div>}
        {discSaved && <div className="form-ok">Descuento guardado.</div>}
        <button type="button" className="btn primary" disabled={discBusy} onClick={saveDiscount}>
          {discBusy ? 'Guardando…' : 'Guardar descuento'}
        </button>
      </section>

      <section className="card vsection">
        <h2>Métodos de pago</h2>
        <p className="hint">
          Los que aparecen al cobrar una venta. Desactiva los que no uses. Para separar
          submétodos de divisa (Binance, efectivo, Zelle…), crea uno por cada uno en
          <strong> Dólares</strong>: cada método se registra y reporta por separado.
        </p>
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

// ---------- Personal: administradores y vendedoras ----------
const EMPTY_STAFF = { email: '', password: '', fullName: '' };
const ROLE_LABEL = { admin: 'Administrador', seller: 'Vendedora' };

function StaffSection({ profile }) {
  const [staff, setStaff] = useState(null);
  const [form, setForm] = useState(EMPTY_STAFF);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  useEffect(() => { fetchStaff().then(setStaff).catch((e) => setError(e.message)); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onCreate(e) {
    e.preventDefault();
    setError(null); setOk(null); setBusy(true);
    try {
      await createStaff({ email: form.email.trim(), password: form.password, fullName: form.fullName.trim() });
      setStaff(await fetchStaff());
      setForm(EMPTY_STAFF); setShowNew(false);
      setOk('Vendedora creada. Ya puede iniciar sesión con ese correo y contraseña.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function onChangeRole(u, role) {
    setError(null); setOk(null);
    try {
      await setStaffRole(u.id, role);
      setStaff((prev) => prev.map((x) => (x.id === u.id ? { ...x, business_role: role } : x)));
    } catch (err) { setError(err.message); }
  }

  async function onDelete(u) {
    if (!confirm(`¿Eliminar a ${u.full_name || u.email}? Perderá el acceso.`)) return;
    setError(null); setOk(null);
    try {
      await deleteStaff(u.id);
      setStaff((prev) => prev.filter((x) => x.id !== u.id));
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="vform">
      <section className="card vsection">
        <h2>Personal</h2>
        <p className="hint">
          El <strong>administrador</strong> tiene acceso completo (inventario, estadísticas,
          configuración). La <strong>vendedora</strong> solo accede a Ventas y Clientes.
        </p>
        {staff === null ? (
          <div className="empty">Cargando…</div>
        ) : (
          <div className="method-list">
            {staff.map((u) => {
              const isMe = u.id === profile?.id;
              const isPlatform = u.role === 'platform_admin';
              return (
                <div className="method-row" key={u.id}>
                  <div className="method-info">
                    <span className="method-name">
                      {u.full_name || u.email}{isMe && <span className="muted"> · tú</span>}
                    </span>
                    <span className="muted">{u.email}</span>
                  </div>
                  <div className="method-actions">
                    {isPlatform ? (
                      <span className="badge adjustment">Plataforma</span>
                    ) : (
                      <select value={u.business_role} disabled={isMe}
                        onChange={(e) => onChangeRole(u, e.target.value)}>
                        <option value="admin">{ROLE_LABEL.admin}</option>
                        <option value="seller">{ROLE_LABEL.seller}</option>
                      </select>
                    )}
                    {!isMe && !isPlatform && (
                      <button type="button" className="btn danger sm" onClick={() => onDelete(u)}>Eliminar</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
        {ok && <div className="form-ok">{ok}</div>}

        {showNew ? (
          <form onSubmit={onCreate} className="vform" style={{ marginTop: 16 }}>
            <label>Nombre<input value={form.fullName} onChange={set('fullName')} placeholder="Nombre de la vendedora" /></label>
            <label>Correo<input type="email" value={form.email} onChange={set('email')} required placeholder="vendedora@correo.com" /></label>
            <label>Contraseña<input type="text" value={form.password} onChange={set('password')} required minLength={6} placeholder="Mínimo 6 caracteres" /></label>
            <div className="inline-form-actions">
              <button className="btn primary" disabled={busy}>{busy ? 'Creando…' : 'Crear vendedora'}</button>
              <button type="button" className="btn ghost" onClick={() => { setShowNew(false); setForm(EMPTY_STAFF); }}>Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn primary" style={{ marginTop: 12 }} onClick={() => setShowNew(true)}>
            + Agregar vendedora
          </button>
        )}
      </section>
    </div>
  );
}
