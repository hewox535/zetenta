import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  updateBusinessProfile, setWithholdingSeq,
  fetchTaxonomies, createTaxonomy, deleteTaxonomy, deleteTerm,
} from '../lib/api';

export default function Settings() {
  const { business, capabilities, refreshBusiness } = useAuth();
  const [name, setName] = useState(business?.name ?? '');
  const [rif, setRif] = useState(business?.rif ?? '');
  const [address, setAddress] = useState(business?.fiscal_address ?? '');
  const [lastSeq, setLastSeq] = useState(business ? String(business.withholding_seq - 1) : '0');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // categorías de productos
  const [taxonomies, setTaxonomies] = useState([]);
  const [newTax, setNewTax] = useState('');
  const [taxError, setTaxError] = useState(null);

  useEffect(() => {
    if (capabilities?.inventory) {
      fetchTaxonomies().then(setTaxonomies).catch((e) => setTaxError(e.message));
    }
  }, [capabilities?.inventory]);

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
    setTaxError(null);
    try {
      await deleteTaxonomy(t.id);
      setTaxonomies((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      setTaxError(e.message);
    }
  }

  async function onDeleteTerm(t, term) {
    if (!confirm(`¿Eliminar "${term.name}" de ${t.name}? Se quitará de los productos que lo usan.`)) return;
    setTaxError(null);
    try {
      await deleteTerm(term.id);
      setTaxonomies((prev) => prev.map((x) => (
        x.id === t.id ? { ...x, taxonomy_terms: x.taxonomy_terms.filter((y) => y.id !== term.id) } : x
      )));
    } catch (e) {
      setTaxError(e.message);
    }
  }

  if (!business) {
    return <div className="page"><div className="empty">Tu usuario no tiene un negocio asociado.</div></div>;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await updateBusinessProfile({ name: name.trim(), rif: rif.trim().toUpperCase(), fiscalAddress: address.trim() });
      const last = Number(lastSeq);
      if (Number.isInteger(last) && last >= 0 && last !== business.withholding_seq - 1) {
        await setWithholdingSeq(last);
      }
      await refreshBusiness();
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Negocio</h1>
          <p className="page-sub">Datos fiscales del agente de retención. Aparecen en los comprobantes impresos.</p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="vform">
        <section className="card vsection">
          <label>
            Razón social
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            RIF
            <input value={rif} onChange={(e) => setRif(e.target.value)} required placeholder="J-313620220" />
          </label>
          <label>
            Dirección fiscal
            <input value={address} onChange={(e) => setAddress(e.target.value)} required />
          </label>
        </section>

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

      {capabilities?.inventory && (
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
      )}
    </div>
  );
}
