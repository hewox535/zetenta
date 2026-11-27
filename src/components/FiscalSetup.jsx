import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchFiscalProfile, saveFiscalProfile, submitFiscalProfile, uploadFiscalDoc, fiscalDocUrl } from '../lib/api';
import { formatDate } from '../lib/calc';
import { FinModal } from './FinUI';
import {
  DOCS, docsFor, requiredDocs, missingFor, PERSON_TYPES, TAXPAYER_TYPES, METHODS, STATUS, invoiceNo, normDoc,
} from '../lib/fiscal';
import './invoices.css';

const STEPS = [
  [1, 'Tu negocio'],
  [2, 'Identidad y empresa'],
  [3, 'Actividad'],
  [4, 'Revisar y firmar'],
];
const CHECK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const DOC_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v5h5M10 13h6M10 17h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
const SAVE_FIELDS = ['person_type', 'taxpayer_type', 'current_method', 'legal_name', 'rif', 'representative_name',
  'representative_id', 'fiscal_address', 'city', 'main_activity', 'phone', 'email'];

const fresh = (business) => ({
  status: 'draft', person_type: 'natural', taxpayer_type: 'ordinario', current_method: 'ninguno',
  legal_name: business.name || '', rif: business.rif || '', representative_name: '', representative_id: '',
  fiscal_address: business.fiscal_address || '', city: '', main_activity: '', phone: '', email: '',
  documents: {}, signature_path: '', seal_path: '', invoice_seq: 0, credit_seq: 0,
});

// Opciones como tarjetas (radiogroup accesible).
function Choice({ label, value, options, onChange }) {
  return (
    <fieldset className="fs-choice">
      <legend>{label}</legend>
      <div className="fs-options" role="radiogroup" aria-label={label}>
        {options.map(([k, l, d]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k}
            className={`fs-option${value === k ? ' on' : ''}`} onClick={() => onChange(k)}>
            <strong>{l}</strong>
            {d && <span>{d}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// Fila de un documento: estado, ver y subir/cambiar.
function DocRow({ k, doc, businessId, onUploaded, onError }) {
  const def = DOCS[k];
  const [busy, setBusy] = useState(false);
  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { onError('El archivo pesa más de 10 MB.'); return; }
    if (def.accept === 'application/pdf' && file.type !== 'application/pdf') { onError(`${def.label}: sube el PDF que genera el portal del SENIAT.`); return; }
    setBusy(true);
    try { onUploaded(k, await uploadFiscalDoc(businessId, k, file)); }
    catch (err) { onError(err.message); } finally { setBusy(false); }
  }
  async function onView() {
    try { window.open(await fiscalDocUrl(doc.path), '_blank', 'noopener'); } catch (err) { onError(err.message); }
  }
  const done = !!doc?.path;
  return (
    <div className={`fs-doc${done ? ' done' : ''}`}>
      <span className="fs-doc-icon">{done ? CHECK : DOC_ICON}</span>
      <div className="fs-doc-text">
        <strong>{def.label}{def.optional && <em className="fs-tag">Opcional</em>}</strong>
        <span>{done ? doc.name : def.hint}</span>
      </div>
      <div className="fs-doc-actions">
        {done && <button type="button" className="btn ghost sm" onClick={onView}>Ver</button>}
        <label className={`btn sm${done ? ' ghost' : ''}`} aria-disabled={busy}>
          <input type="file" accept={def.accept} hidden disabled={busy} onChange={onPick} />
          {busy ? 'Subiendo…' : done ? 'Cambiar' : 'Subir'}
        </label>
      </div>
    </div>
  );
}

// Firma dibujada con el dedo o el mouse. onDone(blob) al guardar.
function SignaturePad({ onDone, busy }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current; const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    c.width = r.width * dpr; c.height = r.height * dpr;
    const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  }, []);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => { drawing.current = true; ref.current.setPointerCapture(e.pointerId); const ctx = ref.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...pos(e)); };
  const move = (e) => { if (!drawing.current) return; const ctx = ref.current.getContext('2d'); ctx.lineTo(...pos(e)); ctx.stroke(); setEmpty(false); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setEmpty(true); };
  return (
    <div className="fs-sign">
      <canvas ref={ref} className="fs-sign-pad" aria-label="Dibuja tu firma aquí"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      {empty && <span className="fs-sign-hint">Dibuja tu firma aquí · usa el dedo o el mouse</span>}
      <div className="fs-sign-actions">
        <button type="button" className="btn ghost sm" onClick={clear} disabled={empty || busy}>Limpiar</button>
        <button type="button" className="btn sm" disabled={empty || busy}
          onClick={() => ref.current.toBlob((b) => onDone(b), 'image/png')}>{busy ? 'Guardando…' : 'Usar esta firma'}</button>
      </div>
    </div>
  );
}

// Borrador de la solicitud que se presenta ante el SENIAT con los datos cargados.
function RequestLetter({ fp, signUrl, sealUrl }) {
  const today = new Date().toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' });
  const juridica = fp.person_type === 'juridica';
  const docs = docsFor(fp.person_type).filter((k) => fp.documents?.[k]?.path).map((k) => DOCS[k].label);
  return (
    <div className="fs-letter" aria-label="Solicitud de autorización">
      <p className="fs-letter-draft">Borrador generado con tus datos. Revísalo con tu contador antes de presentarlo.</p>
      <p className="fs-letter-right">{fp.city || '[Ciudad]'}, {today}</p>
      <p>Ciudadano(a)<br />Intendente Nacional de Tributos Internos<br />Servicio Nacional Integrado de Administración Aduanera y Tributaria (SENIAT)<br />Su despacho.–</p>
      <p>
        Yo, <b>{fp.representative_name || '[nombre]'}</b>, titular de la cédula de identidad Nº <b>{fp.representative_id || '[cédula]'}</b>,
        {juridica
          ? <> actuando en mi carácter de representante legal de <b>{fp.legal_name || '[razón social]'}</b>, inscrita en el Registro Único de Información Fiscal (RIF) bajo el Nº <b>{fp.rif || '[RIF]'}</b>,</>
          : <> actuando en mi propio nombre, inscrito(a) en el Registro Único de Información Fiscal (RIF) bajo el Nº <b>{fp.rif || '[RIF]'}</b>,</>}
        {' '}con domicilio fiscal en {fp.fiscal_address || '[domicilio fiscal]'}, me dirijo a usted para solicitar la autorización
        para emitir facturas y otros documentos por medios digitales, conforme a la Providencia Administrativa SNAT/2024/000102
        (Gaceta Oficial Nº 43.032) y a la Providencia Administrativa SNAT/2026/00093 (Gaceta Oficial Nº 43.484).
      </p>
      <p>La actividad principal es {fp.main_activity || '[actividad principal]'}, en calidad de contribuyente {fp.taxpayer_type}.</p>
      <p>Declaro bajo fe de juramento que los datos suministrados y los documentos anexos son fieles y exactos.</p>
      {docs.length > 0 && <p>Anexos: {docs.join('; ')}.</p>}
      <p>Atentamente,</p>
      <div className="fs-letter-sign">
        {signUrl ? <img src={signUrl} alt="Firma" /> : <span className="fs-letter-line" />}
        {sealUrl && <img className="fs-letter-seal" src={sealUrl} alt="Sello" />}
        <span>{fp.representative_name || '[nombre]'} · C.I. {fp.representative_id || '[cédula]'}</span>
      </div>
    </div>
  );
}

export default function FiscalSetup({ business }) {
  const [fp, setFp] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [howTo, setHowTo] = useState(false);
  const [signMode, setSignMode] = useState('draw');
  const [signBusy, setSignBusy] = useState(false);
  const [urls, setUrls] = useState({});           // firma y sello firmados para mostrar
  const [accepted, setAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const timer = useRef(null);
  const dirty = useRef({});

  useEffect(() => {
    fetchFiscalProfile().then((p) => setFp(p || fresh(business))).catch((e) => setLoadError(e.message));
  }, [business]);

  // Firma y sello: URL firmada para verlos en el borrador.
  useEffect(() => {
    if (!fp) return;
    ['signature_path', 'seal_path'].forEach((k) => {
      if (fp[k] && !urls[fp[k]]) fiscalDocUrl(fp[k]).then((u) => setUrls((s) => ({ ...s, [fp[k]]: u }))).catch(() => {});
    });
  }, [fp?.signature_path, fp?.seal_path]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patch = dirty.current; dirty.current = {};
    if (!Object.keys(patch).length) return;
    setSaving(true);
    try { const saved = await saveFiscalProfile(patch); setFp((cur) => ({ ...saved, ...pickDirty(cur) })); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  }, []);
  // Lo que se siguió escribiendo mientras se guardaba no se pisa.
  const pickDirty = (cur) => Object.fromEntries(Object.keys(dirty.current).map((k) => [k, cur[k]]));

  // Se guarda solo, medio segundo después de dejar de escribir.
  const set = (patch) => {
    setFp((cur) => ({ ...cur, ...patch }));
    Object.entries(patch).forEach(([k, v]) => { if (SAVE_FIELDS.includes(k)) dirty.current[k] = v; });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  const field = (k) => ({ value: fp[k] || '', onChange: (e) => set({ [k]: e.target.value }) });

  async function saveNow(patch) {
    setSaving(true); setError(null);
    try { await flush(); setFp(await saveFiscalProfile(patch)); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  const onUploaded = (k, doc) => saveNow({ documents: { ...(fp.documents || {}), [k]: doc } });

  async function onSignature(blob) {
    setSignBusy(true); setError(null);
    try {
      const doc = await uploadFiscalDoc(business.id, 'firma', new File([blob], 'firma.png', { type: 'image/png' }));
      await saveNow({ signature_path: doc.path });
    } catch (e) { setError(e.message); } finally { setSignBusy(false); }
  }
  async function onImage(key, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Sube una imagen PNG o JPG.'); return; }
    setSignBusy(true); setError(null);
    try {
      const doc = await uploadFiscalDoc(business.id, key === 'signature_path' ? 'firma' : 'sello', file);
      await saveNow({ [key]: doc.path });
    } catch (err) { setError(err.message); } finally { setSignBusy(false); }
  }

  async function onSubmit() {
    setSending(true); setError(null);
    try { await flush(); setFp(await submitFiscalProfile()); setOpen(false); }
    catch (e) { setError(e.message); } finally { setSending(false); }
  }

  if (loadError) return <div className="form-error">{loadError}</div>;
  if (!fp) return <div className="card vsection"><span className="muted">Cargando…</span></div>;

  const missing = (s) => missingFor(fp, s);
  const stepDone = (s) => (s === 1 ? true : missing(s).length === 0);
  const firstPending = [2, 3, 4].find((s) => !stepDone(s)) || 4;
  const nDocs = requiredDocs(fp.person_type).length;
  const nDone = requiredDocs(fp.person_type).filter((k) => fp.documents?.[k]?.path).length;
  const status = STATUS[fp.status] || STATUS.draft;

  // ---------- Activa ----------
  if (fp.status === 'active') {
    return (
      <div className="vform">
        <section className="card vsection fs-active">
          <div className="fs-active-head">
            <span className="fs-active-badge">{CHECK}</span>
            <div>
              <h2>Facturación digital activa</h2>
              <p className="muted">Desde el {formatDate(fp.activated_at)}. Cada venta puede salir con su factura desde el cobro.</p>
            </div>
          </div>
          <dl className="fs-facts">
            <div><dt>Próxima factura</dt><dd>Nº {invoiceNo(fp.invoice_seq + 1)}</dd></div>
            <div><dt>Próxima nota de crédito</dt><dd>Nº {invoiceNo(fp.credit_seq + 1)}</dd></div>
            <div><dt>Número de control</dt><dd className="fs-warn">Pendiente de conectar la imprenta digital</dd></div>
          </dl>
          <div className="fs-active-actions">
            <Link className="btn primary" to="/invoices">Ver facturas</Link>
          </div>
        </section>
        <section className="card vsection">
          <h2>Datos del emisor</h2>
          <p className="hint">Salen en cada factura. Para cambiarlos hay que actualizar la solicitud con tu RIF nuevo.</p>
          <dl className="fs-facts">
            <div><dt>Razón social</dt><dd>{fp.legal_name}</dd></div>
            <div><dt>RIF</dt><dd>{fp.rif}</dd></div>
            <div className="wide"><dt>Domicilio fiscal</dt><dd>{fp.fiscal_address}{fp.city ? `, ${fp.city}` : ''}</dd></div>
            <div><dt>Contribuyente</dt><dd>{fp.taxpayer_type === 'especial' ? 'Especial' : 'Ordinario'}</dd></div>
          </dl>
        </section>
        <section className="card vsection">
          <h2>IVA de los productos</h2>
          <p className="hint">
            Los precios de venta ya incluyen el IVA: la factura lo separa en base imponible e impuesto. Cada producto
            tiene su alícuota (16 % general, 8 % reducida o exento) en <Link to="/inventory">Inventario</Link>; por defecto es 16 %.
          </p>
        </section>
      </div>
    );
  }

  // ---------- Enviada ----------
  if (fp.status === 'submitted') {
    return (
      <div className="vform">
        <section className="card vsection">
          <span className={`inv-status pending`}>{status.label}</span>
          <h2 className="fs-h">Recibimos tu solicitud</h2>
          <p className="muted">La revisamos y te avisamos por aquí cuando la facturación digital esté activa.</p>
          <ol className="fs-timeline">
            <li className="done"><span>{CHECK}</span><div><strong>Solicitud firmada y enviada</strong><small>{formatDate(fp.submitted_at)}</small></div></li>
            <li className="now"><span>2</span><div><strong>Revisión de tus documentos</strong><small>El equipo de Zetenta verifica que todo esté legible y vigente.</small></div></li>
            <li><span>3</span><div><strong>Autorización ante el SENIAT</strong><small>La Intendencia tiene hasta 30 días hábiles para responder.</small></div></li>
            <li><span>4</span><div><strong>Facturación activa</strong><small>Tu primera factura será la Nº {invoiceNo(1)}.</small></div></li>
          </ol>
        </section>
      </div>
    );
  }

  // ---------- Borrador o con cambios pedidos ----------
  const started = nDone > 0 || fp.representative_name || fp.main_activity;
  const docs2 = docsFor(fp.person_type).filter((k) => DOCS[k].step === 2);
  const groups = [...new Set(docs2.map((k) => DOCS[k].group))];

  return (
    <div className="vform">
      {fp.status === 'rejected' && (
        <div className="form-error">
          <b>Tu solicitud necesita cambios.</b> {fp.review_note || 'Revisa los documentos y vuelve a enviarla.'}
        </div>
      )}
      <section className="card vsection">
        <div className="fs-intro">
          <div>
            <h2>{started ? 'Seguimos donde lo dejaste' : 'Activa la facturación digital'}</h2>
            <p className="muted">
              {started
                ? 'Tu avance queda guardado. Te falta completar el paso marcado.'
                : 'Factura cada venta con validez ante el SENIAT, sin máquina fiscal. Te pedimos solo lo que aplica a tu negocio y armamos la solicitud por ti.'}
            </p>
          </div>
          <button type="button" className="btn primary" onClick={() => { setStep(started ? firstPending : 1); setOpen(true); }}>
            {started ? 'Continuar donde quedé' : 'Empezar'}
          </button>
        </div>
        <ol className="fs-steps-overview">
          {STEPS.map(([n, label]) => {
            const done = n === 1 ? started : stepDone(n);
            const now = started && n === firstPending;
            const m = n > 1 ? missing(n) : [];
            return (
              <li key={n} className={`${done && !now ? 'done' : ''}${now ? ' now' : ''}`}>
                <span className="fs-step-dot">{done && !now ? CHECK : n}</span>
                <strong>{label}</strong>
                <small>
                  {n === 1 ? (started ? `${PERSON_TYPES.find((p) => p[0] === fp.person_type)[1]} · ${fp.taxpayer_type === 'especial' ? 'Especial' : 'Ordinario'}` : 'Pendiente')
                    : done ? 'Listo' : started && m.length ? `Faltan ${m.length} ${m.length === 1 ? 'dato' : 'datos'}` : 'Pendiente'}
                </small>
              </li>
            );
          })}
        </ol>
        {started && missing(firstPending).length > 0 && (
          <p className="fs-missing">Te falta en el paso {firstPending}: {missing(firstPending).join(', ')}.</p>
        )}
      </section>

      <section className="card vsection">
        <h2>Cómo funciona</h2>
        <ul className="fs-how">
          <li><b>Sin máquina fiscal.</b> Desde el 19 de abril de 2027 la máquina fiscal deja de ser obligatoria (Providencia SNAT/2026/00093).</li>
          <li><b>Cada venta con su factura.</b> Numeración correlativa, IVA por alícuota, montos en bolívares con la tasa BCV y notas de crédito al anular.</li>
          <li><b>Número de control.</b> Lo asigna una imprenta digital autorizada por el SENIAT; Zetenta se conecta con ella por ti.</li>
          <li><b>Libro de Ventas</b> del mes, listo para tu contador.</li>
        </ul>
      </section>

      {open && (
        <FinModal wide title="Activación de la facturación digital"
          sub={['Cuéntanos sobre tu negocio para pedirte solo lo que aplica.', 'Tus documentos de identidad y domicilio, y tus datos fiscales.',
            'Lo que respalda tu actividad económica.', 'Revisa, firma y envía tu solicitud.'][step - 1]}
          onClose={() => { flush(); setOpen(false); }} busy={sending}
          footer={(
            <div className="fs-foot">
              <span className="fs-foot-status" role="status">
                Paso {step} de 4 · {saving ? 'guardando…' : 'se guarda automáticamente'}
                {step > 1 && missing(step).length > 0 && <em>Falta: {missing(step).join(', ')}</em>}
              </span>
              <div className="fs-foot-actions">
                <button type="button" className="btn ghost" onClick={() => (step === 1 ? (flush(), setOpen(false)) : setStep(step - 1))}>
                  {step === 1 ? 'Cerrar' : 'Atrás'}
                </button>
                {step < 4 ? (
                  <button type="button" className="btn primary" disabled={step > 1 && missing(step).length > 0}
                    onClick={() => { flush(); setStep(step + 1); }}>Continuar</button>
                ) : (
                  <button type="button" className="btn primary" disabled={sending || !accepted || [2, 3, 4].some((s) => missing(s).length)}
                    onClick={onSubmit}>{sending ? 'Enviando…' : 'Firmar y enviar'}</button>
                )}
              </div>
            </div>
          )}>
          <ol className="fs-stepper" aria-label="Pasos">
            {STEPS.map(([n, label]) => (
              <li key={n} className={n === step ? 'now' : n < step ? 'done' : ''} aria-current={n === step ? 'step' : undefined}>
                <span>{n < step ? CHECK : n}</span>{label}
              </li>
            ))}
          </ol>
          {error && <div className="form-error">{error}</div>}

          {step === 1 && (
            <div className="fs-step">
              <Choice label="¿Qué tipo de persona eres?" value={fp.person_type} options={PERSON_TYPES} onChange={(v) => set({ person_type: v })} />
              <Choice label="Tipo de contribuyente" value={fp.taxpayer_type} options={TAXPAYER_TYPES} onChange={(v) => set({ taxpayer_type: v })} />
              <Choice label="¿Cómo facturas hoy?" value={fp.current_method} options={METHODS} onChange={(v) => set({ current_method: v })} />
              <div className="fs-summary">
                <div className="fs-path">
                  <span>{METHODS.find((m) => m[0] === fp.current_method)[1]}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <strong>Digital</strong>
                </div>
                <p>
                  {fp.current_method === 'ninguno' ? 'Tu primera factura ya será digital.'
                    : fp.current_method === 'maquina' ? 'Dejas la máquina fiscal y empiezas en digital. Puedes seguir usándola mientras llega la autorización.'
                    : fp.current_method === 'forma_libre' ? 'Guarda tu talonario: queda para contingencias (si un día no hay sistema).'
                    : 'Pasas tu facturación digital a Zetenta.'}
                </p>
                <p className="fs-summary-docs">Te vamos a pedir {docsFor(fp.person_type).length} documentos: {docsFor(fp.person_type).map((k) => DOCS[k].label).join(', ')}.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="fs-step">
              {groups.map((g) => {
                const keys = docs2.filter((k) => DOCS[k].group === g);
                const req = keys.filter((k) => !DOCS[k].optional);
                return (
                  <div key={g} className="fs-group">
                    <div className="fs-group-head">
                      <h3>{g}</h3>
                      <span>{req.length ? `${req.filter((k) => fp.documents?.[k]?.path).length} de ${req.length} ${req.length === 1 ? 'listo' : 'listos'}` : 'Opcional'}</span>
                    </div>
                    {keys.map((k) => <DocRow key={k} k={k} doc={fp.documents?.[k]} businessId={business.id} onUploaded={onUploaded} onError={setError} />)}
                  </div>
                );
              })}
              <div className="fs-group">
                <div className="fs-group-head"><h3>Datos fiscales</h3><span>Como aparecen en el RIF</span></div>
                <div className="fs-grid">
                  <label className="fm-field wide">Razón social<input {...field('legal_name')} placeholder="Como aparece en el RIF" /></label>
                  <label className="fm-field">RIF del negocio
                    <input {...field('rif')} onBlur={(e) => set({ rif: normDoc(e.target.value) })} placeholder={fp.person_type === 'juridica' ? 'J-123456789' : 'V-123456789'} autoComplete="off" />
                  </label>
                  <label className="fm-field">Ciudad<input {...field('city')} placeholder="La del domicilio fiscal" /></label>
                  <label className="fm-field wide">Domicilio fiscal<textarea rows={2} {...field('fiscal_address')} placeholder="Dirección completa, como en el RIF" /></label>
                  <label className="fm-field">{fp.person_type === 'juridica' ? 'Representante legal' : 'Nombre completo'}
                    <input {...field('representative_name')} placeholder="Nombre y apellido" autoComplete="name" />
                  </label>
                  <label className="fm-field">Cédula de identidad
                    <input {...field('representative_id')} onBlur={(e) => set({ representative_id: normDoc(e.target.value) })} placeholder="V-12345678" autoComplete="off" />
                  </label>
                  <label className="fm-field">Teléfono<input {...field('phone')} inputMode="tel" placeholder="0414-1234567" /></label>
                  <label className="fm-field">Correo<input {...field('email')} type="email" placeholder="facturas@tunegocio.com" /></label>
                  <label className="fm-field wide">Actividad principal
                    <textarea rows={2} {...field('main_activity')} placeholder="Ej.: la compra y venta de prendas de vestir y accesorios" />
                    <span className="hint">Tal como aparece en {fp.person_type === 'juridica' ? 'el acta constitutiva (objeto principal)' : 'tu registro o tu RIF'}. La solicitud la cita.</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="fs-step">
              <div className="fs-group">
                <div className="fs-group-head"><h3>Actividad económica</h3><span>{fp.documents?.cert_actividad?.path ? '1 de 1 listo' : '0 de 1 listo'}</span></div>
                <DocRow k="cert_actividad" doc={fp.documents?.cert_actividad} businessId={business.id} onUploaded={onUploaded} onError={setError} />
                <button type="button" className="fm-link" aria-expanded={howTo} onClick={() => setHowTo((v) => !v)}>
                  {howTo ? 'Ocultar pasos' : '¿Cómo obtengo el certificado?'}
                </button>
                {howTo && (
                  <ol className="fs-howto">
                    <li>Entra al portal fiscal del SENIAT con tu usuario y clave.</li>
                    <li>Busca la actualización o registro de datos del RIF.</li>
                    <li>Completa el cuestionario y elige los códigos de actividad económica (CIIU) de tu negocio.</li>
                    <li>Al terminar, el portal genera el certificado en PDF: súbelo aquí.</li>
                  </ol>
                )}
              </div>
              <div className="fs-group">
                <div className="fs-group-head"><h3>Logo en tus facturas</h3><span>{business.branding?.logo_url ? 'Listo' : 'Opcional'}</span></div>
                {business.branding?.logo_url ? (
                  <div className="fs-logo"><img src={business.branding.logo_url} alt="Logo del negocio" /><span className="muted">Es el logo de tu marca en Zetenta. Sale arriba a la izquierda de cada factura.</span></div>
                ) : (
                  <p className="hint">Tus facturas saldrán con tu razón social. Si quieres tu logo, súbelo en tu marca y aparecerá solo.</p>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="fs-step">
              <div className="fs-review">
                <div className="fs-review-card">
                  <h3>Resumen</h3>
                  <div className="fs-path">
                    <span>{METHODS.find((m) => m[0] === fp.current_method)[1]}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    <strong>Digital</strong>
                  </div>
                  <dl className="fs-facts">
                    <div><dt>Persona</dt><dd>{fp.person_type === 'juridica' ? 'Jurídica' : 'Natural'}</dd></div>
                    <div><dt>Contribuyente</dt><dd>{fp.taxpayer_type === 'especial' ? 'Especial' : 'Ordinario'}</dd></div>
                    <div><dt>RIF</dt><dd>{fp.rif}</dd></div>
                    <div><dt>Primera factura</dt><dd>Nº {invoiceNo(1)}</dd></div>
                    <div className="wide"><dt>Documentos</dt><dd className={nDone === nDocs ? 'fs-ok' : 'fs-warn'}>{nDone} de {nDocs} adjuntos</dd></div>
                  </dl>
                </div>
              </div>

              <div className="fs-group">
                <div className="fs-group-head"><h3>Solicitud de autorización</h3><span>Se arma con tus datos</span></div>
                <RequestLetter fp={fp} signUrl={urls[fp.signature_path]} sealUrl={urls[fp.seal_path]} />
              </div>

              <div className="fs-group">
                <div className="fs-group-head"><h3>Firma tu solicitud</h3><span>{fp.signature_path ? 'Lista' : 'Pendiente'}</span></div>
                <p className="hint">Solo el dueño o el representante legal puede firmar.</p>
                <div className="chip-row" role="radiogroup" aria-label="Cómo firmar">
                  <button type="button" role="radio" aria-checked={signMode === 'draw'} className={`chip${signMode === 'draw' ? ' on' : ''}`} onClick={() => setSignMode('draw')}>Dibujar</button>
                  <button type="button" role="radio" aria-checked={signMode === 'upload'} className={`chip${signMode === 'upload' ? ' on' : ''}`} onClick={() => setSignMode('upload')}>Subir imagen</button>
                </div>
                {signMode === 'draw' ? <SignaturePad onDone={onSignature} busy={signBusy} /> : (
                  <label className="btn sm fs-upload-btn">
                    <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => onImage('signature_path', e)} />
                    {signBusy ? 'Subiendo…' : fp.signature_path ? 'Cambiar imagen de la firma' : 'Subir imagen de la firma'}
                  </label>
                )}
                {fp.signature_path && urls[fp.signature_path] && <div className="fs-sign-saved"><img src={urls[fp.signature_path]} alt="Tu firma" /><span>Firma guardada</span></div>}
              </div>

              <div className="fs-group">
                <div className="fs-group-head"><h3>Sello de la empresa</h3><span>{fp.person_type === 'juridica' ? (fp.seal_path ? 'Listo' : 'Obligatorio') : 'Opcional'}</span></div>
                <label className="btn sm ghost fs-upload-btn">
                  <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => onImage('seal_path', e)} />
                  {fp.seal_path ? 'Cambiar sello' : 'Subir sello (PNG o JPG con fondo claro)'}
                </label>
              </div>

              <label className="fs-accept">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>Confirmo que mis datos son correctos y autorizo a Zetenta a presentar esta solicitud y mis documentos ante el SENIAT y la imprenta digital autorizada.</span>
              </label>
            </div>
          )}
        </FinModal>
      )}
    </div>
  );
}
