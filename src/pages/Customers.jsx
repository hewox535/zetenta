import { useMemo, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  fetchCustomers, createCustomer, createCustomersBulk, updateCustomer, deleteCustomer,
} from '../lib/api';

const EMPTY = { name: '', document: '', phone: '', email: '' };

const ICON = {
  edit: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>,
  trash: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M6 7l1 12a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  wa: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.7 13.7L3 21l4.4-1.3A9 9 0 1 0 12 3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M9.2 8.4c-.2 0-.5.1-.6.3-.3.3-.7.8-.7 1.7 0 1 .7 2 .9 2.2.1.2 1.4 2.3 3.5 3.1 1.7.7 2.1.6 2.5.5.5-.1 1.2-.5 1.4-1 .2-.5.2-.9.1-1l-.6-.3s-.9-.5-1.1-.5c-.2-.1-.3-.1-.5.1l-.5.6c-.1.1-.2.2-.4.1-.2-.1-.8-.3-1.4-.9-.5-.5-.9-1-1-1.2-.1-.2 0-.3.1-.4l.3-.4c.1-.1.1-.2.2-.4 0-.1 0-.3 0-.4 0-.1-.5-1.1-.6-1.5-.1-.3-.3-.3-.4-.3z" fill="currentColor"/></svg>,
  mail: <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>,
};

// ---------- CSV: parseo tolerante (comillas, coma o punto y coma) ----------
function parseCSV(text, delim) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') { /* ignora */ }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

const FIELD_ALIASES = {
  name: ['nombre', 'name', 'cliente'],
  document: ['documento', 'document', 'cedula', 'cédula', 'rif', 'ci', 'dni'],
  phone: ['telefono', 'teléfono', 'phone', 'celular', 'movil', 'móvil', 'whatsapp', 'tel'],
  email: ['correo', 'email', 'e-mail', 'mail'],
};

function customersFromCSV(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const matrix = parseCSV(text, delim);
  if (!matrix.length) return [];
  const header = matrix[0].map((h) => h.trim().toLowerCase());
  const idx = {}; let hasHeader = false;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const j = header.findIndex((h) => aliases.includes(h));
    if (j >= 0) { idx[field] = j; hasHeader = true; }
  }
  const dataRows = hasHeader ? matrix.slice(1) : matrix;
  const map = hasHeader ? idx : { name: 0, document: 1, phone: 2, email: 3 };
  const out = [];
  for (const r of dataRows) {
    const get = (f) => (map[f] != null ? (r[map[f]] ?? '').trim() : '');
    const name = get('name');
    if (!name) continue;
    out.push({ name, document: get('document'), phone: get('phone'), email: get('email') });
  }
  return out;
}

const csvEscape = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function download(filename, text, mime = 'text/csv;charset=utf-8;') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Teléfono → número para wa.me (dígitos, con código de país; Venezuela por defecto).
function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('58')) return d;
  if (d.startsWith('0')) return '58' + d.slice(1);
  if (d.length === 10) return '58' + d;
  return d;
}

// Clave para deduplicar en importación (teléfono > correo > documento > nombre).
const dedupeKey = (c) =>
  (c.phone && c.phone.replace(/\D/g, '')) ||
  (c.email && c.email.toLowerCase()) ||
  (c.document && c.document.toLowerCase()) ||
  c.name.toLowerCase();

export default function Customers() {
  const { business } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [importMsg, setImportMsg] = useState(null);

  // Campaña
  const [campaign, setCampaign] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [campaignMsg, setCampaignMsg] = useState(null);

  useEffect(() => {
    fetchCustomers().then(setRows).catch((e) => setError(e.message));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const byName = (a, b) => a.name.localeCompare(b.name);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows || [];
    if (!q) return list;
    return list.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.document || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q));
  }, [rows, search]);

  // Destinatarios de la campaña: los marcados; si no hay ninguno, todos los filtrados.
  const targets = useMemo(() =>
    (selected.size ? filtered.filter((c) => selected.has(c.id)) : filtered),
    [selected, filtered]);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    const patch = {
      name: form.name.trim(), document: form.document.trim(),
      phone: form.phone.trim(), email: form.email.trim(),
    };
    try {
      if (editing) {
        const updated = await updateCustomer(editing, patch);
        setRows((prev) => prev.map((r) => (r.id === editing ? updated : r)).sort(byName));
      } else {
        const created = await createCustomer(business.id, patch);
        setRows((prev) => [...prev, created].sort(byName));
      }
      setForm(EMPTY); setEditing(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  function startEdit(c) {
    setEditing(c.id);
    setForm({ name: c.name, document: c.document || '', phone: c.phone || '', email: c.email || '' });
  }
  function cancel() { setEditing(null); setForm(EMPTY); }

  async function onDelete(c) {
    if (!confirm(`¿Eliminar a ${c.name}? Sus ventas se conservan.`)) return;
    try {
      await deleteCustomer(c.id);
      setRows((prev) => prev.filter((r) => r.id !== c.id));
    } catch (e) { setError(e.message); }
  }

  // ---------- Importar / exportar ----------
  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null); setImportMsg(null); setBusy(true);
    try {
      const text = await file.text();
      const parsed = customersFromCSV(text);
      const existing = new Set((rows || []).map(dedupeKey));
      const seen = new Set();
      const toAdd = [];
      let skipped = 0;
      for (const c of parsed) {
        const k = dedupeKey(c);
        if (existing.has(k) || seen.has(k)) { skipped++; continue; }
        seen.add(k); toAdd.push(c);
      }
      if (!toAdd.length) {
        setImportMsg(`No se agregó nada: ${parsed.length} fila(s) leída(s), todas vacías o duplicadas.`);
        return;
      }
      const created = await createCustomersBulk(business.id, toAdd);
      setRows((prev) => [...(prev || []), ...created].sort(byName));
      setImportMsg(`Importados ${created.length} cliente(s)${skipped ? `, omitidos ${skipped} duplicado(s)` : ''}.`);
    } catch (err) {
      setError(`No se pudo importar: ${err.message}`);
    } finally { setBusy(false); }
  }

  function downloadTemplate() {
    download('clientes-plantilla.csv',
      'nombre,documento,telefono,correo\nAna Pérez,V-12345678,0412-1234567,ana@correo.com\n');
  }
  function exportCsv() {
    const header = ['nombre', 'documento', 'telefono', 'correo'];
    const lines = [header, ...(rows || []).map((c) => [c.name, c.document || '', c.phone || '', c.email || ''])];
    download('clientes.csv', lines.map((r) => r.map(csvEscape).join(',')).join('\n'));
  }

  // ---------- Campaña ----------
  const toggleSel = (id) => setSelected((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allFilteredSelected) filtered.forEach((c) => n.delete(c.id));
    else filtered.forEach((c) => n.add(c.id));
    return n;
  });

  function sendEmailCampaign() {
    setCampaignMsg(null); setError(null);
    const emails = targets.map((t) => t.email).filter(Boolean);
    if (!emails.length) { setError('Ninguno de los destinatarios tiene correo.'); return; }
    const url = `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    if (url.length > 1900) {
      setError(`Son demasiados destinatarios para abrir el correo de una vez (${emails.length}). Selecciona menos o usa "Exportar" con tu herramienta de correo masivo.`);
      return;
    }
    window.location.href = url;
    setCampaignMsg(`Abriendo tu correo con ${emails.length} destinatario(s) en CCO.`);
  }
  async function copyMessage() {
    try { await navigator.clipboard.writeText(message); setCampaignMsg('Mensaje copiado.'); }
    catch { setCampaignMsg('No se pudo copiar automáticamente; selecciónalo y copia manualmente.'); }
  }
  function exportTargets() {
    const header = ['nombre', 'documento', 'telefono', 'correo'];
    const lines = [header, ...targets.map((c) => [c.name, c.document || '', c.phone || '', c.email || ''])];
    download('campana-destinatarios.csv', lines.map((r) => r.map(csvEscape).join(',')).join('\n'));
  }
  const waHref = (c) =>
    `https://wa.me/${waNumber(c.phone)}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  const withEmail = targets.filter((t) => t.email).length;
  const withPhone = targets.filter((t) => waNumber(t.phone)).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Clientes</h1>
          <p className="page-sub">Directorio de clientes de tu negocio. Importa, exporta y envía campañas.</p>
        </div>
        <div className="page-actions">
          <label className="btn ghost">
            ⬆ Importar CSV
            <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={onImport} />
          </label>
          <button className="btn ghost" onClick={exportCsv} disabled={!rows?.length}>⬇ Exportar CSV</button>
          <button className={`btn${campaign ? ' primary' : ' ghost'}`} onClick={() => setCampaign((v) => !v)}>
            📣 Campaña
          </button>
        </div>
      </header>

      {importMsg && <div className="form-ok">{importMsg} <button className="linklike" onClick={() => setImportMsg(null)}>ok</button></div>}

      {!campaign && (
        <div className="card vsection">
          <h2>{editing ? 'Editar cliente' : 'Nuevo cliente'}</h2>
          <form onSubmit={onSubmit} className="inline-form">
            <label>Nombre<input value={form.name} onChange={set('name')} required placeholder="Ana Pérez" /></label>
            <label>Documento (opcional)<input value={form.document} onChange={set('document')} placeholder="V-12345678" /></label>
            <label>Teléfono (opcional)<input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="0412-1234567" /></label>
            <label>Correo (opcional)<input value={form.email} onChange={set('email')} type="email" placeholder="ana@correo.com" /></label>
            <div className="inline-form-actions">
              <button className="btn primary" disabled={busy}>{editing ? 'Guardar' : 'Agregar'}</button>
              {editing && <button type="button" className="btn ghost" onClick={cancel}>Cancelar</button>}
            </div>
          </form>
          <p className="hint">
            ¿Vas a importar? <button type="button" className="linklike" onClick={downloadTemplate}>Descarga la plantilla CSV</button>{' '}
            (columnas: nombre, documento, teléfono, correo). Excel: “Guardar como… CSV”.
          </p>
          {error && <div className="form-error">{error}</div>}
        </div>
      )}

      {campaign && (
        <div className="card vsection">
          <h2>Campaña a {targets.length} cliente(s)</h2>
          <p className="hint">
            Se envía a los clientes marcados; si no marcas ninguno, va a todos los de la lista (según el buscador).
            {' '}De ellos, <strong>{withEmail}</strong> tienen correo y <strong>{withPhone}</strong> WhatsApp.
          </p>
          <label>Asunto (correo)
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Promoción de esta semana" />
          </label>
          <label>Mensaje
            <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="Hola 👋 Tenemos nuevas ofertas para ti…" />
          </label>
          <div className="inline-form-actions">
            <button type="button" className="btn primary" onClick={sendEmailCampaign} disabled={!withEmail}>✉ Correo a {withEmail} (CCO)</button>
            <button type="button" className="btn" onClick={copyMessage} disabled={!message}>Copiar mensaje</button>
            <button type="button" className="btn ghost" onClick={exportTargets} disabled={!targets.length}>Exportar destinatarios</button>
          </div>
          {campaignMsg && <div className="form-ok">{campaignMsg}</div>}
          {error && <div className="form-error">{error}</div>}
          <p className="hint">
            WhatsApp: usa el icono de cada cliente en la tabla (abre el chat con el mensaje escrito). El envío
            masivo real por WhatsApp requiere la API de WhatsApp Business; el envío/programación automática de
            correos requiere un proveedor. Podemos integrarlo como siguiente fase.
          </p>
        </div>
      )}

      <div className="cust-toolbar">
        <input className="cust-search" placeholder="Buscar por nombre, documento, teléfono o correo…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        {campaign && <span className="muted">{selected.size} marcado(s)</span>}
      </div>

      {rows === null ? (
        <div className="empty">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="empty">Aún no tienes clientes. Agrega uno arriba o importa un CSV.</div>
      ) : filtered.length === 0 ? (
        <div className="empty">Ningún cliente coincide con la búsqueda.</div>
      ) : (
        <div className="card table-card">
          <table className="list">
            <thead>
              <tr>
                {campaign && <th className="check-col"><input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} aria-label="Marcar todos" /></th>}
                <th>Nombre</th><th>Documento</th><th>Teléfono</th><th>Correo</th><th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  {campaign && <td className="check-col"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} aria-label={`Marcar ${c.name}`} /></td>}
                  <td>{c.name}</td>
                  <td className="mono">{c.document || <span className="muted">—</span>}</td>
                  <td>{c.phone || <span className="muted">—</span>}</td>
                  <td>{c.email || <span className="muted">—</span>}</td>
                  <td className="row-actions">
                    {waNumber(c.phone) && (
                      <a className="icon-btn" title="WhatsApp" href={waHref(c)} target="_blank" rel="noreferrer">{ICON.wa}</a>
                    )}
                    {c.email && (
                      <a className="icon-btn" title="Correo"
                        href={`mailto:${c.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}>{ICON.mail}</a>
                    )}
                    <button className="icon-btn" title="Editar" onClick={() => startEdit(c)}>{ICON.edit}</button>
                    <button className="icon-btn danger" title="Eliminar" onClick={() => onDelete(c)}>{ICON.trash}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
