import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOrdersForStats } from '../lib/api';
import { usd, bs, formatDate } from '../lib/calc';

// Rangos preestablecidos → { from, to } en ISO (inclusive por día).
function rangeFor(preset) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  if (preset === 'today') return { from: startOf(now), to: end };
  if (preset === '7d') { const d = new Date(now); d.setDate(d.getDate() - 6); return { from: startOf(d), to: end }; }
  if (preset === '30d') { const d = new Date(now); d.setDate(d.getDate() - 29); return { from: startOf(d), to: end }; }
  if (preset === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: end };
  return { from: null, to: end }; // 'all'
}

const PRESETS = [
  ['today', 'Hoy'], ['7d', '7 días'], ['30d', '30 días'], ['month', 'Este mes'], ['all', 'Todo'],
];

export default function Stats() {
  const [preset, setPreset] = useState('30d');
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setOrders(null);
    const { from, to } = rangeFor(preset);
    fetchOrdersForStats(from?.toISOString(), to?.toISOString())
      .then(setOrders).catch((e) => setError(e.message));
  }, [preset]);

  const stats = useMemo(() => {
    if (!orders) return null;
    let revenueUsd = 0, revenueVes = 0;
    const byProduct = new Map();      // name → { qty, revenue }
    const byMethod = new Map();       // name → usd
    const byDay = new Map();          // yyyy-mm-dd → usd
    for (const o of orders) {
      revenueUsd += Number(o.total_usd) || 0;
      revenueVes += Number(o.total_ves) || 0;
      const day = (o.created_at || '').slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + (Number(o.total_usd) || 0));
      for (const it of o.order_items || []) {
        const cur = byProduct.get(it.name) || { qty: 0, revenue: 0 };
        cur.qty += Number(it.quantity) || 0;
        cur.revenue += Number(it.line_total_usd) || 0;
        byProduct.set(it.name, cur);
      }
      for (const p of o.order_payments || []) {
        byMethod.set(p.method_name, (byMethod.get(p.method_name) || 0) + (Number(p.amount_usd) || 0));
      }
    }
    const products = [...byProduct.entries()].map(([name, v]) => ({ name, ...v }));
    const topProducts = [...products].sort((a, b) => b.qty - a.qty);
    const count = orders.length;
    return {
      revenueUsd, revenueVes, count,
      avgTicket: count ? revenueUsd / count : 0,
      topProducts,
      bottomProducts: [...topProducts].reverse().slice(0, 5),
      methods: [...byMethod.entries()].map(([name, v]) => ({ name, usd: v })).sort((a, b) => b.usd - a.usd),
      days: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [orders]);

  function exportCsv() {
    if (!stats) return;
    const rows = [['Producto', 'Cantidad', 'Ingresos USD']];
    stats.topProducts.forEach((p) => rows.push([p.name, p.qty, p.revenue.toFixed(2)]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `estadisticas-${preset}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const maxProdQty = stats?.topProducts[0]?.qty || 1;
  const maxDay = Math.max(1, ...(stats?.days.map(([, v]) => v) || [1]));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Estadísticas</h1>
          <p className="page-sub">Resumen de ventas y productos más vendidos.</p>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={exportCsv} disabled={!stats || stats.count === 0}>Exportar CSV</button>
        </div>
      </header>

      <div className="filters">
        {PRESETS.map(([key, label]) => (
          <button key={key} className={`chip-btn${preset === key ? ' active' : ''}`} onClick={() => setPreset(key)}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      {orders === null ? (
        <div className="empty">Cargando…</div>
      ) : stats.count === 0 ? (
        <div className="empty">Sin pedidos en este período. Registra ventas en <Link to="/orders">Pedidos</Link>.</div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="card kpi">
              <div className="kpi-label">Ingresos</div>
              <div className="kpi-value">{usd(stats.revenueUsd)}</div>
              <div className="kpi-sub">{bs(stats.revenueVes)}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Pedidos</div>
              <div className="kpi-value">{stats.count}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Ticket promedio</div>
              <div className="kpi-value">{usd(stats.avgTicket)}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Productos vendidos</div>
              <div className="kpi-value">{stats.topProducts.reduce((s, p) => s + p.qty, 0)}</div>
            </div>
          </div>

          <div className="stats-cols">
            <section className="card vsection">
              <h2>Más vendidos</h2>
              <div className="rank">
                {stats.topProducts.slice(0, 8).map((p) => (
                  <div className="rank-row" key={p.name}>
                    <div className="rank-info">
                      <span className="rank-name">{p.name}</span>
                      <span className="muted">{p.qty} und · {usd(p.revenue)}</span>
                    </div>
                    <div className="rank-bar"><span style={{ width: `${(p.qty / maxProdQty) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
              {stats.topProducts.length > 5 && (
                <>
                  <h3 className="rank-subtitle">Menos vendidos</h3>
                  <div className="rank compact">
                    {stats.bottomProducts.map((p) => (
                      <div className="rank-row" key={p.name}>
                        <div className="rank-info">
                          <span className="rank-name">{p.name}</span>
                          <span className="muted">{p.qty} und</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            <div className="stats-side">
              <section className="card vsection">
                <h2>Por método de pago</h2>
                <div className="totals">
                  {stats.methods.map((m) => (
                    <div className="totals-row" key={m.name}>
                      <span>{m.name}</span><span>{usd(m.usd)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card vsection">
                <h2>Ventas por día</h2>
                <div className="rank compact">
                  {stats.days.map(([day, v]) => (
                    <div className="rank-row" key={day}>
                      <div className="rank-info">
                        <span className="rank-name">{formatDate(day)}</span>
                        <span className="muted">{usd(v)}</span>
                      </div>
                      <div className="rank-bar"><span style={{ width: `${(v / maxDay) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
