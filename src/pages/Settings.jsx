import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import {
  updateBusinessProfile, setWithholdingSeq,
  fetchTaxonomies, createTaxonomy, deleteTaxonomy, createTerm, updateTerm, deleteTerm,
  fetchBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount,
  createPaymentMethod, updatePaymentMethod, deletePaymentMethod,
  updateOrderSettings, updateBusinessSettings,
  fetchBranches, createBranch, updateBranch, deleteBranch,
  fetchUserBranches, setUserBranches,
  fetchStaff, createStaff, deleteStaff, setStaffRole,
} from '../lib/api';
import { fetchBcvRates } from '../lib/rates';
import { money } from '../lib/calc';

// Iconos limpios para acciones (editar, eliminar, agregar).
const ICON = {
  edit: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>,
  trash: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  plus: <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
};

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
    { key: 'branches', label: 'Sucursales' },
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
      {section === 'branches' && <BranchesSection business={business} />}
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

// ---------- Ventas: tasa de cambio + descuento + cuentas bancarias ----------
function OrdersSection({ business, refreshBusiness }) {
  const cfg = business.rate_config || { mode: 'bcv', currency: 'USD' };
  const [mode, setMode] = useState(cfg.mode || 'bcv');
  const [currency, setCurrency] = useState(cfg.currency || 'USD');
  const [manual, setManual] = useState(cfg.mode === 'manual' ? String(cfg.value ?? '') : '');
  const [bcv, setBcv] = useState(null);
  const [rateSaved, setRateSaved] = useState(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateError, setRateError] = useState(null);

  const [discount, setDiscount] = useState(String(business.foreign_discount_percent ?? 0));
  const [discBusy, setDiscBusy] = useState(false);
  const [discSaved, setDiscSaved] = useState(false);
  const [discError, setDiscError] = useState(null);

  useEffect(() => {
    fetchBcvRates().then(setBcv).catch(() => {});
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

      <BankAccountsManager business={business} />
    </div>
  );
}

// ---------- Cuentas bancarias: cada cuenta agrupa métodos y reporta su ingreso ----------
function BankAccountsManager({ business }) {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState(null);
  const [aName, setAName] = useState('');
  const [aCurrency, setACurrency] = useState('VES');
  const [mDraft, setMDraft] = useState({});         // { accountId: { name, description } }
  const [edit, setEdit] = useState(null);           // { kind:'account'|'method', id, name, description }

  useEffect(() => { fetchBankAccounts().then(setAccounts).catch((e) => setError(e.message)); }, []);

  const patchAccount = (id, fn) => setAccounts((prev) => prev.map((x) => (x.id === id ? fn(x) : x)));
  const draftOf = (id) => mDraft[id] || { name: '', description: '' };
  const setDraft = (id, k, v) => setMDraft((d) => ({ ...d, [id]: { ...draftOf(id), [k]: v } }));

  async function addAccount() {
    const name = aName.trim(); if (!name) return;
    setError(null);
    try {
      const created = await createBankAccount(business.id, { name, currency: aCurrency });
      setAccounts((prev) => [...prev, { ...created, payment_methods: created.payment_methods || [] }]);
      setAName(''); setACurrency('VES');
    } catch (e) { setError(e.message); }
  }
  async function toggleAccount(a) {
    try { const u = await updateBankAccount(a.id, { active: !a.active });
      patchAccount(a.id, (x) => ({ ...u, payment_methods: x.payment_methods }));
    } catch (e) { setError(e.message); }
  }
  async function saveAccountEdit() {
    const name = (edit.name || '').trim(); if (!name) { setEdit(null); return; }
    try { const u = await updateBankAccount(edit.id, { name });
      patchAccount(edit.id, (x) => ({ ...u, payment_methods: x.payment_methods }));
    } catch (e) { setError(e.message); } finally { setEdit(null); }
  }
  async function removeAccount(a) {
    if (!confirm(`¿Eliminar la cuenta "${a.name}" y sus métodos? Las ventas ya registradas conservan su información.`)) return;
    try { await deleteBankAccount(a.id); setAccounts((prev) => prev.filter((x) => x.id !== a.id)); }
    catch (e) { setError(e.message); }
  }
  async function addMethod(a) {
    const d = draftOf(a.id); const name = d.name.trim(); if (!name) return;
    setError(null);
    try {
      const created = await createPaymentMethod(business.id, a.id, { name, description: d.description.trim(), currency: a.currency });
      patchAccount(a.id, (x) => ({ ...x, payment_methods: [...(x.payment_methods || []), created] }));
      setMDraft((m) => ({ ...m, [a.id]: { name: '', description: '' } }));
    } catch (e) { setError(e.message); }
  }
  async function saveMethodEdit(a) {
    const name = (edit.name || '').trim(); if (!name) { setEdit(null); return; }
    try { const u = await updatePaymentMethod(edit.id, { name, description: (edit.description || '').trim() });
      patchAccount(a.id, (x) => ({ ...x, payment_methods: x.payment_methods.map((y) => (y.id === edit.id ? u : y)) }));
    } catch (e) { setError(e.message); } finally { setEdit(null); }
  }
  async function removeMethod(a, m) {
    if (!confirm(`¿Eliminar el método "${m.name}"?`)) return;
    try { await deletePaymentMethod(m.id);
      patchAccount(a.id, (x) => ({ ...x, payment_methods: x.payment_methods.filter((y) => y.id !== m.id) }));
    } catch (e) { setError(e.message); }
  }

  return (
    <section className="card vsection">
      <h2>Cuentas bancarias</h2>
      <p className="hint">
        Cada cuenta agrupa sus métodos de pago (transferencia, pago móvil…). Así sabes
        cuánto entra a cada cuenta. Si una cuenta no tiene métodos, la cuenta misma se
        usa como forma de pago al cobrar.
      </p>
      <div className="acct-list">
        {accounts.map((a) => (
          <div className={`acct${a.active ? '' : ' inactive'}`} key={a.id}>
            <div className="acct-head">
              {edit?.kind === 'account' && edit.id === a.id ? (
                <input autoFocus value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveAccountEdit(); if (e.key === 'Escape') setEdit(null); }}
                  onBlur={saveAccountEdit} />
              ) : (
                <div className="acct-title">
                  <strong>{a.name}</strong>
                  <span className="badge adjustment">{a.currency === 'USD' ? 'Dólares' : 'Bolívares'}</span>
                </div>
              )}
              <div className="acct-actions">
                <button type="button" className={`switch${a.active ? ' on' : ''}`} role="switch"
                  aria-checked={a.active} title={a.active ? 'Activa' : 'Inactiva'}
                  onClick={() => toggleAccount(a)}><span className="switch-knob" /></button>
                <button type="button" className="icon-btn" title="Editar cuenta"
                  onClick={() => setEdit({ kind: 'account', id: a.id, name: a.name })}>{ICON.edit}</button>
                <button type="button" className="icon-btn danger" title="Eliminar cuenta"
                  onClick={() => removeAccount(a)}>{ICON.trash}</button>
              </div>
            </div>

            <div className="acct-methods">
              {(a.payment_methods || []).map((m) => (
                edit?.kind === 'method' && edit.id === m.id ? (
                  <div className="acct-method editing" key={m.id}>
                    <input autoFocus placeholder="Método" value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                    <input placeholder="Descripción (opcional)" value={edit.description}
                      onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                    <button type="button" className="btn sm" onClick={() => saveMethodEdit(a)}>Guardar</button>
                    <button type="button" className="btn ghost sm" onClick={() => setEdit(null)}>Cancelar</button>
                  </div>
                ) : (
                  <div className="acct-method" key={m.id}>
                    <div className="acct-method-info">
                      <span className="acct-method-name">{m.name}</span>
                      {m.description && <span className="muted">{m.description}</span>}
                    </div>
                    <div className="acct-method-actions">
                      <button type="button" className="icon-btn" title="Editar método"
                        onClick={() => setEdit({ kind: 'method', id: m.id, name: m.name, description: m.description || '' })}>{ICON.edit}</button>
                      <button type="button" className="icon-btn danger" title="Eliminar método"
                        onClick={() => removeMethod(a, m)}>{ICON.trash}</button>
                    </div>
                  </div>
                )
              ))}
              <div className="acct-add-method">
                <input placeholder="Agregar método (transferencia, pago móvil…)" value={draftOf(a.id).name}
                  onChange={(e) => setDraft(a.id, 'name', e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMethod(a); } }} />
                <input placeholder="Descripción (opcional)" value={draftOf(a.id).description}
                  onChange={(e) => setDraft(a.id, 'description', e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMethod(a); } }} />
                <button type="button" className="btn sm" onClick={() => addMethod(a)}>{ICON.plus} Método</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="inline-form">
        <label>Nueva cuenta<input value={aName} onChange={(e) => setAName(e.target.value)}
          placeholder="Banesco Bs, Zelle, Efectivo $…"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAccount(); } }} /></label>
        <label className="short">Moneda
          <select value={aCurrency} onChange={(e) => setACurrency(e.target.value)}>
            <option value="VES">Bolívares</option>
            <option value="USD">Dólares</option>
          </select>
        </label>
        <div className="inline-form-actions">
          <button type="button" className="btn" onClick={addAccount}>Agregar cuenta</button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
    </section>
  );
}

// ---------- Sucursales: alta/edición + acceso del personal ----------
function BranchesSection({ business }) {
  const { reload } = useBranch();
  const [branches, setBranches] = useState([]);
  const [staff, setStaff] = useState([]);
  const [access, setAccess] = useState({});   // userId -> { all, ids:Set }
  const [error, setError] = useState(null);
  const [bName, setBName] = useState('');
  const [bAddr, setBAddr] = useState('');
  const [edit, setEdit] = useState(null);     // { id, name, address }

  const loadAccess = () => Promise.all([fetchStaff(), fetchUserBranches()]).then(([s, ub]) => {
    setStaff(s.filter((u) => u.role !== 'platform_admin'));
    const map = {};
    s.forEach((u) => { map[u.id] = { all: u.all_branches !== false, ids: new Set(ub.filter((x) => x.user_id === u.id).map((x) => x.branch_id)) }; });
    setAccess(map);
  });

  useEffect(() => {
    fetchBranches().then(setBranches).catch((e) => setError(e.message));
    loadAccess().catch(() => {});
  }, []);

  async function addBranch() {
    const name = bName.trim(); if (!name) return;
    setError(null);
    try {
      const created = await createBranch(business.id, { name, address: bAddr.trim() });
      setBranches((prev) => [...prev, created]); setBName(''); setBAddr(''); reload();
    } catch (e) { setError(e.message); }
  }
  async function saveEdit() {
    const name = (edit.name || '').trim(); if (!name) { setEdit(null); return; }
    try {
      const u = await updateBranch(edit.id, { name, address: (edit.address || '').trim() });
      setBranches((prev) => prev.map((x) => (x.id === edit.id ? u : x))); reload();
    } catch (e) { setError(e.message); } finally { setEdit(null); }
  }
  async function toggleActive(b) {
    try { const u = await updateBranch(b.id, { active: !b.active });
      setBranches((prev) => prev.map((x) => (x.id === b.id ? u : x))); reload();
    } catch (e) { setError(e.message); }
  }
  async function removeBranch(b) {
    if (b.is_default) { setError('No se puede eliminar la sucursal principal.'); return; }
    if (!confirm(`¿Eliminar la sucursal "${b.name}"? Su stock y su historial se eliminan.`)) return;
    try { await deleteBranch(b.id); setBranches((prev) => prev.filter((x) => x.id !== b.id)); reload(); }
    catch (e) { setError(e.message); }
  }

  const setUserAll = (uid, all) => setAccess((a) => ({ ...a, [uid]: { ...a[uid], all } }));
  const toggleUserBranch = (uid, bid) => setAccess((a) => {
    const ids = new Set(a[uid].ids); if (ids.has(bid)) ids.delete(bid); else ids.add(bid);
    return { ...a, [uid]: { ...a[uid], ids } };
  });
  async function saveAccess(u) {
    const a = access[u.id];
    setError(null);
    try { await setUserBranches(u.id, a.all, [...a.ids]); await loadAccess(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div className="vform">
      <section className="card vsection">
        <h2>Sucursales</h2>
        <p className="hint">
          Cada sucursal tiene su propio stock. El stock total de un producto es la suma de todas las
          sucursales. En Inventario puedes trasladar stock entre ellas.
        </p>
        <div className="acct-list">
          {branches.map((b) => (
            <div className="acct" key={b.id}>
              <div className="acct-head">
                {edit?.id === b.id ? (
                  <div className="acct-method editing" style={{ flex: 1 }}>
                    <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Nombre" />
                    <input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} placeholder="Dirección (opcional)" />
                    <button type="button" className="btn sm" onClick={saveEdit}>Guardar</button>
                    <button type="button" className="btn ghost sm" onClick={() => setEdit(null)}>Cancelar</button>
                  </div>
                ) : (
                  <>
                    <div className="acct-title">
                      <strong>{b.name}</strong>
                      {b.is_default && <span className="badge adjustment">Principal</span>}
                      {b.address && <span className="muted">{b.address}</span>}
                    </div>
                    <div className="acct-actions">
                      <button type="button" className={`switch${b.active ? ' on' : ''}`} role="switch"
                        aria-checked={b.active} title={b.active ? 'Activa' : 'Inactiva'} onClick={() => toggleActive(b)}><span className="switch-knob" /></button>
                      <button type="button" className="icon-btn" title="Editar" onClick={() => setEdit({ id: b.id, name: b.name, address: b.address || '' })}>{ICON.edit}</button>
                      {!b.is_default && <button type="button" className="icon-btn danger" title="Eliminar" onClick={() => removeBranch(b)}>{ICON.trash}</button>}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="inline-form">
          <label>Nueva sucursal<input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Sucursal Centro"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBranch(); } }} /></label>
          <label>Dirección (opcional)<input value={bAddr} onChange={(e) => setBAddr(e.target.value)} placeholder="Av. Principal…" /></label>
          <div className="inline-form-actions"><button type="button" className="btn" onClick={addBranch}>Agregar</button></div>
        </div>
      </section>

      <section className="card vsection">
        <h2>Acceso del personal</h2>
        <p className="hint">Define a qué sucursales puede acceder cada persona. “Todas” incluye las que crees a futuro.</p>
        {staff.length === 0 ? <div className="empty">Cargando…</div> : (
          <div className="acct-list">
            {staff.map((u) => {
              const a = access[u.id] || { all: true, ids: new Set() };
              return (
                <div className="acct" key={u.id}>
                  <div className="acct-head">
                    <div className="acct-title"><strong>{u.full_name || u.email}</strong><span className="muted">{u.email}</span></div>
                    <button type="button" className="btn sm" onClick={() => saveAccess(u)}>Guardar</button>
                  </div>
                  <div className="acct-methods">
                    <label className="radio-row">
                      <input type="checkbox" checked={a.all} onChange={(e) => setUserAll(u.id, e.target.checked)} />
                      <span>Todas las sucursales</span>
                    </label>
                    {!a.all && (
                      <div className="chips">
                        {branches.map((b) => (
                          <label key={b.id} className={`chip${a.ids.has(b.id) ? ' on' : ''}`} style={{ cursor: 'pointer' }}>
                            <input type="checkbox" checked={a.ids.has(b.id)} onChange={() => toggleUserBranch(u.id, b.id)} style={{ width: 'auto', marginRight: 6 }} />
                            {b.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

// ---------- Personal: administradores y vendedoras ----------
const EMPTY_STAFF = { username: '', email: '', password: '', fullName: '' };
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
      await createStaff({
        username: form.username.trim().toLowerCase(),
        email: form.email.trim(),
        password: form.password,
        fullName: form.fullName.trim(),
      });
      setStaff(await fetchStaff());
      setForm(EMPTY_STAFF); setShowNew(false);
      setOk('Vendedora creada. Ya puede iniciar sesión con ese usuario y contraseña.');
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
                      {u.full_name || u.email || (u.username ? `@${u.username}` : '')}{isMe && <span className="muted"> · tú</span>}
                    </span>
                    <span className="muted">{u.email || (u.username ? `@${u.username}` : '')}</span>
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
            <label>
              Usuario
              <input value={form.username} onChange={set('username')} required spellCheck={false} placeholder="usuario para iniciar sesión" />
              <span className="field-hint">3–30 caracteres: letras, números y . _ - (sin espacios).</span>
            </label>
            <label>
              Correo (opcional)
              <input type="email" value={form.email} onChange={set('email')} placeholder="vendedora@correo.com" />
              <span className="field-hint">Sin correo también puede entrar; el correo solo hace falta para recuperar la contraseña.</span>
            </label>
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
