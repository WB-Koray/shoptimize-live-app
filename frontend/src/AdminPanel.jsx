import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, Clock, XCircle, AlertCircle, Send, ExternalLink, Download, ArrowUpDown, X, Zap, Activity } from 'lucide-react';
import { LangSwitch } from './LangContext';
import { ThemeSwitch } from './ThemeContext';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';

// Türetilmiş duruma göre (backend `status`)
const STATUS_COLORS = {
  active:        'text-green bg-green/10 border-green/20',
  trialing:      'text-amber-400 bg-amber-400/10 border-amber-400/20',
  needs_billing: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  trial_ended:   'text-orange-400 bg-orange-400/10 border-orange-400/20',
  declined:      'text-rose bg-roseSoft border-rose/20',
  uninstalled:   'text-textMute bg-surfaceAlt border-border',
};
const STATUS_LABELS = {
  active: 'Active', trialing: 'Trialing', needs_billing: 'Awaiting approval',
  trial_ended: 'Trial ended', declined: 'Declined', uninstalled: 'Uninstalled',
};

function fmtAgo(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 0) return 'now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
function fmtMoney(n, cur = '₺') {
  return `${cur}${(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`;
}

function StatCard({ icon: Icon, label, value, color = 'text-text' }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-surfaceAlt ${color}`}><Icon size={18} /></div>
      <div>
        <div className="text-xs text-textMute">{label}</div>
        <div className="text-xl font-bold text-text">{value}</div>
      </div>
    </div>
  );
}

export default function AdminPanel({ adminToken, onExit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('desc');
  const [detail, setDetail] = useState(null);
  const [nudging, setNudging] = useState({});
  const [toast, setToast] = useState('');
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [showHealth, setShowHealth] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/admin/merchants?admin_token=${encodeURIComponent(adminToken)}`);
      const json = await res.json();
      if (!res.ok) { setError(json.detail || 'Error'); return; }
      setData(json);
    } catch { setError('Could not connect'); }
    finally { setLoading(false); }
  }, [adminToken]);

  useEffect(() => { load(); }, [load]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/health?admin_token=${encodeURIComponent(adminToken)}`);
      const json = await res.json();
      if (res.ok) setHealth(json);
    } catch { /* sessiz */ }
    finally { setHealthLoading(false); }
  }, [adminToken]);

  function openHealth() { setShowHealth(true); if (!health) loadHealth(); }

  // Panel açıkken 60 sn'de bir otomatik yenile
  useEffect(() => {
    if (!showHealth) return;
    const id = setInterval(loadHealth, 60000);
    return () => clearInterval(id);
  }, [showHealth, loadHealth]);

  async function testAlert() {
    try {
      const res = await fetch(`${API_URL}/api/admin/test-alert?admin_token=${encodeURIComponent(adminToken)}`, { method: 'POST' });
      const d = await res.json();
      showToast(d.ok ? `✅ Test bildirimi gönderildi${d.to ? ` (***${d.to})` : ''}` : `Bildirim başarısız: ${d.message || d.error || ''}`);
    } catch { showToast('Test bildirimi başarısız'); }
  }

  async function setupTemplate() {
    try {
      const res = await fetch(`${API_URL}/api/admin/setup-operator-template?admin_token=${encodeURIComponent(adminToken)}`, { method: 'POST' });
      const d = await res.json();
      if (d.ok) showToast('✅ Şablon oluşturuldu — Meta onayını bekle (1-2 dk)');
      else showToast(`Şablon kurulamadı: ${d.message || JSON.stringify(d.response?.error || d.error || '')}`.slice(0, 160));
    } catch { showToast('Şablon kurulumu başarısız'); }
  }

  function showToast(m) { setToast(m); setTimeout(() => setToast(''), 4000); }

  async function nudge(m) {
    setNudging(s => ({ ...s, [m.username + m.brand]: true }));
    try {
      const res = await fetch(`${API_URL}/api/admin/nudge?admin_token=${encodeURIComponent(adminToken)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: m.username, brand: m.brand }),
      });
      const d = await res.json();
      showToast(d.ok ? `✅ Nudge sent to ${d.phone}` : `Nudge failed: ${d.error || ''}`);
    } catch { showToast('Nudge failed'); }
    finally { setNudging(s => ({ ...s, [m.username + m.brand]: false })); }
  }

  function exportCsv() {
    const rows = (data?.merchants || []);
    const head = ['shop_name', 'shop_domain', 'username', 'status', 'owner_phone', 'wa', 'events', 'orders', 'revenue', 'online', 'last_seen_ms', 'installed_days_ago'];
    const lines = [head.join(',')];
    for (const m of rows) {
      lines.push([
        `"${(m.shop_name || '').replace(/"/g, '""')}"`, m.shop_domain || '', m.username,
        m.status, m.owner_phone || '', m.wa_connected ? '1' : '0',
        m.event_count || 0, m.orders_count || 0, m.revenue || 0, m.active_visitors || 0,
        m.last_event_ts || 0, m.installed_days_ago ?? '',
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `merchants-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  let merchants = (data?.merchants || []).filter(m => {
    if (filter !== 'all' && m.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return m.username.toLowerCase().includes(q)
        || (m.shop_domain || '').toLowerCase().includes(q)
        || (m.shop_name || '').toLowerCase().includes(q);
    }
    return true;
  });
  if (sortKey) {
    merchants = [...merchants].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      return sortDir === 'desc' ? (bv - av) : (av - bv);
    });
  }

  const stats = data?.stats || {};
  const price = data?.plan_price || 9.99;

  // Uyarı rozetleri
  function alerts(m) {
    const out = [];
    if (m.status === 'trialing' && m.trial_remaining_hours != null && m.trial_remaining_hours > 0 && m.trial_remaining_hours < 24)
      out.push({ t: '⏳ ends soon', c: 'text-amber-400 bg-amber-400/10' });
    if (m.status !== 'uninstalled' && !m.pixel_ready)
      out.push({ t: 'no pixel', c: 'text-rose bg-roseSoft' });
    return out;
  }

  const SortTh = ({ label, k, right }) => (
    <th onClick={() => toggleSort(k)}
      className={`px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide cursor-pointer hover:text-text select-none ${right ? 'text-right' : 'text-left'}`}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown size={10} className={sortKey === k ? 'text-green' : 'opacity-40'} /></span>
    </th>
  );

  return (
    <div className="min-h-screen bg-bg">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-surface border border-borderStrong rounded-xl shadow-2xl text-xs font-semibold text-text">{toast}</div>
      )}

      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <span className="font-bold text-text text-sm">Shoptimize Live — Admin</span>
          <span className="text-xs text-textMute bg-surfaceAlt border border-border px-2 py-0.5 rounded-md">{data?.total ?? '…'} merchants</span>
          <div className="ml-auto flex items-center gap-3">
            <button onClick={openHealth} className="flex items-center gap-1.5 text-xs text-textDim hover:text-text transition-colors">
              <Activity size={13} /> Sağlık
              {health?.problem_count > 0 && <span className="text-rose font-bold">({health.problem_count})</span>}
            </button>
            <button onClick={exportCsv} className="flex items-center gap-1.5 text-xs text-textDim hover:text-text transition-colors"><Download size={13} /> CSV</button>
            <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-textDim hover:text-text transition-colors disabled:opacity-50"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh</button>
            <LangSwitch /><ThemeSwitch />
            {onExit && <button onClick={onExit} className="text-xs text-textMute hover:text-rose transition-colors">Exit Admin</button>}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {error && <div className="flex items-center gap-2 bg-roseSoft border border-rose/20 rounded-xl px-4 py-3 text-sm text-rose"><AlertCircle size={15} />{error}</div>}
        {data && data.billing_enabled === false && (
          <div className="flex items-center gap-2 bg-roseSoft border border-rose/30 rounded-xl px-4 py-3 text-sm text-rose">
            <AlertCircle size={15} />
            <span><strong>BILLING_ENABLED kapalı!</strong> Deneme süresi zorlaması devre dışı — tüm merchant'lar ücretsiz kullanıyor. Coolify env'de <code className="bg-rose/10 px-1 rounded">BILLING_ENABLED=true</code> yapın.</span>
          </div>
        )}

        {/* İş özeti — MRR / dönüşüm / ciro */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-green/15 to-teal/10 border border-green/20 rounded-xl p-4">
            <div className="text-xs text-textMute">MRR (aylık tekrarlayan)</div>
            <div className="text-2xl font-bold text-green">${(stats.mrr ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            <div className="text-[10px] text-textMute mt-0.5">{stats.active ?? 0} aktif × ${price}</div>
          </div>
          <StatCard icon={Clock} label="Trial → Paid dönüşüm" value={`%${stats.conversion ?? 0}`} color="text-blue-400" />
          <StatCard icon={CheckCircle} label="Takip edilen ciro" value={fmtMoney(stats.total_revenue)} color="text-green" />
          <StatCard icon={AlertCircle} label="Dönüşüm bekleyen" value={(stats.needs_billing ?? 0) + (stats.trial_ended ?? 0)} color="text-amber-400" />
        </div>

        {/* Lifecycle özet */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[['active','Active','text-green'],['trialing','Trialing','text-amber-400'],['needs_billing','Awaiting','text-blue-400'],['trial_ended','Trial ended','text-orange-400'],['declined','Declined','text-rose'],['uninstalled','Uninstalled','text-textMute']].map(([k,l,c]) => (
            <button key={k} onClick={() => setFilter(filter === k ? 'all' : k)}
              className={`bg-surface border rounded-xl p-3 text-left transition-colors ${filter === k ? 'border-green/40' : 'border-border hover:border-borderStrong'}`}>
              <div className="text-[11px] text-textMute">{l}</div>
              <div className={`text-lg font-bold ${c}`}>{stats[k] ?? 0}</div>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex flex-wrap items-center gap-3">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shop, domain, username…"
            className="bg-surfaceAlt border border-border rounded-xl px-3 py-2 text-sm text-text placeholder:text-textMute focus:outline-none focus:border-green/60 focus:ring-1 focus:ring-green/30 w-72" />
          {filter !== 'all' && <button onClick={() => setFilter('all')} className="text-xs text-textMute hover:text-text">filtre: {STATUS_LABELS[filter]} ✕</button>}
          <span className="text-xs text-textMute ml-auto">{merchants.length} shown</span>
        </div>

        {/* Table */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surfaceAlt">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide">Shop</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide">Owner</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide">Billing</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide">WA</th>
                  <SortTh label="Events" k="event_count" right />
                  <SortTh label="Revenue" k="revenue" right />
                  <SortTh label="Online" k="active_visitors" right />
                  <SortTh label="Last seen" k="last_event_ts" />
                  <SortTh label="Trial" k="trial_remaining_hours" />
                  <th className="text-center px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide">⚡</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data && <tr><td colSpan={10} className="text-center py-12 text-textMute text-sm">Loading…</td></tr>}
                {!loading && merchants.length === 0 && <tr><td colSpan={10} className="text-center py-12 text-textMute text-sm">No merchants found</td></tr>}
                {merchants.map(m => {
                  const al = alerts(m);
                  const canNudge = ['needs_billing', 'trial_ended'].includes(m.status) && m.owner_phone;
                  return (
                  <tr key={`${m.username}:${m.brand}`} onClick={() => setDetail(m)}
                    className="border-b border-border last:border-0 hover:bg-surfaceAlt/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text flex items-center gap-1.5">
                        {m.shop_name || <span className="text-textDim">{m.username}</span>}
                        {al.map((a, i) => <span key={i} className={`text-[9px] px-1 py-px rounded font-semibold ${a.c}`}>{a.t}</span>)}
                      </div>
                      <div className="text-[11px] text-textMute">{m.shop_domain ? m.shop_domain.replace('.myshopify.com', '') : m.username}{m.brand !== 'default' && ` · ${m.brand}`}</div>
                    </td>
                    <td className="px-4 py-3 text-textDim text-xs">
                      {m.owner_phone ? <span className="font-mono">{m.owner_phone}</span> : <span className="text-textMute">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${STATUS_COLORS[m.status] || STATUS_COLORS.uninstalled}`}>{STATUS_LABELS[m.status] || m.status}</span>
                    </td>
                    <td className="px-4 py-3 text-center">{m.wa_connected ? <span className="text-green">✓</span> : <span className="text-textMute">—</span>}</td>
                    <td className="px-4 py-3 text-right font-mono text-textDim">{m.event_count > 0 ? m.event_count.toLocaleString() : <span className="text-textMute">0</span>}</td>
                    <td className="px-4 py-3 text-right font-mono">{m.revenue > 0 ? <span className="text-green">{fmtMoney(m.revenue)}</span> : <span className="text-textMute">—</span>}</td>
                    <td className="px-4 py-3 text-right">{m.active_visitors > 0 ? <span className="inline-flex items-center gap-1 text-green font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />{m.active_visitors}</span> : <span className="text-textMute">—</span>}</td>
                    <td className="px-4 py-3 text-textMute text-xs">{fmtAgo(m.last_event_ts)}</td>
                    <td className="px-4 py-3 text-xs">
                      {m.trial_remaining_hours != null && m.trial_remaining_hours > 0
                        ? <span className="text-amber-400">{m.trial_remaining_hours < 24 ? `${m.trial_remaining_hours}h` : `${Math.round(m.trial_remaining_hours / 24)}d`}</span>
                        : m.status === 'active' ? <span className="text-green text-[11px]">✓</span> : <span className="text-textMute">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      {canNudge && (
                        <button onClick={() => nudge(m)} disabled={nudging[m.username + m.brand]}
                          title="Sahibe WhatsApp onay linki gönder"
                          className="p-1.5 rounded-lg bg-blueSoft border border-blue/20 text-blue hover:bg-blueSoft/80 disabled:opacity-50">
                          {nudging[m.username + m.brand] ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sağlık / Monitöring modalı */}
      {showHealth && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setShowHealth(false)}>
          <div className="w-full max-w-3xl bg-surface border border-border rounded-2xl mt-10 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-text font-bold flex items-center gap-2"><Activity size={16} /> Sistem Sağlığı — WhatsApp / Sepet Kurtarma</h2>
              <div className="flex items-center gap-3">
                <button onClick={setupTemplate} title="operator_bildirim şablonunu Meta'da oluştur (tek sefer)"
                  className="flex items-center gap-1 text-xs text-textDim hover:text-text"><Zap size={12} /> Şablon kur</button>
                <button onClick={testAlert} title="Operatör bildirim hattını test et"
                  className="flex items-center gap-1 text-xs text-blue hover:text-text"><Send size={12} /> Test bildirim</button>
                <button onClick={loadHealth} disabled={healthLoading} className="text-textDim hover:text-text disabled:opacity-50"><RefreshCw size={14} className={healthLoading ? 'animate-spin' : ''} /></button>
                <button onClick={() => setShowHealth(false)} className="p-1 text-textMute hover:text-text"><X size={16} /></button>
              </div>
            </div>

            {healthLoading && !health && <div className="text-center py-10 text-textMute text-sm">Kontrol ediliyor… (Meta API sorgulanıyor)</div>}

            {health && (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-textMute">{health.checked} mağaza kontrol edildi</span>
                  {health.problem_count > 0
                    ? <span className="text-rose font-bold flex items-center gap-1"><XCircle size={14} />{health.problem_count} sorunlu</span>
                    : <span className="text-green font-bold flex items-center gap-1"><CheckCircle size={14} />Hepsi sağlıklı</span>}
                </div>

                <div className="space-y-2">
                  {health.merchants.filter(m => !m.healthy).map(m => (
                    <div key={m.username + m.brand} className="bg-roseSoft border border-rose/20 rounded-xl p-3">
                      <div className="font-medium text-text text-sm flex items-center gap-2">
                        {m.shop_name}
                        <span className="text-textMute text-[11px] font-normal">{m.shop_domain || m.username}</span>
                      </div>
                      <ul className="mt-1.5 space-y-1">
                        {m.problems.map((p, i) => (
                          <li key={i} className="text-xs text-rose flex items-center gap-1.5"><XCircle size={11} />{p}</li>
                        ))}
                      </ul>
                      {m.wa?.error && <div className="text-[10px] text-textMute mt-1 font-mono break-all">{m.wa.error}</div>}
                      <div className="flex items-center gap-2 mt-2">
                        {m.owner_phone && (
                          <a href={`https://wa.me/${m.owner_phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-green bg-green/10 border border-green/20 rounded-md px-2 py-0.5 no-underline">
                            <Send size={10} /> Sahibe yaz
                          </a>
                        )}
                        {m.shop_domain && (
                          <a href={`https://${m.shop_domain}/admin`} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-textDim bg-surfaceAlt border border-border rounded-md px-2 py-0.5 no-underline">
                            <ExternalLink size={10} /> Shopify
                          </a>
                        )}
                      </div>
                    </div>
                  ))}

                  {health.merchants.filter(m => m.healthy).length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer py-2 text-textMute hover:text-text">
                        Sağlıklı mağazalar ({health.merchants.filter(m => m.healthy).length})
                      </summary>
                      <div className="space-y-1 pt-1">
                        {health.merchants.filter(m => m.healthy).map(m => (
                          <div key={m.username + m.brand} className="flex items-center gap-2 py-0.5 text-green">
                            <CheckCircle size={11} /> <span className="text-text">{m.shop_name}</span>
                            <span className="text-textMute">· {m.wa?.cart_approved ?? 0} sepet şablonu · {m.flow_enabled ? 'akış açık' : 'akış kapalı'}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Detay paneli */}
      {detail && (
        <div className="fixed inset-0 z-40 bg-black/50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="w-full max-w-md bg-surface h-full overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-text font-bold">{detail.shop_name || detail.username}</h2>
                <p className="text-xs text-textMute">{detail.shop_domain || detail.username} · {detail.brand}</p>
              </div>
              <button onClick={() => setDetail(null)} className="p-1 text-textMute hover:text-text"><X size={16} /></button>
            </div>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${STATUS_COLORS[detail.status]}`}>{STATUS_LABELS[detail.status] || detail.status}</span>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['Owner phone', detail.owner_phone || '—'],
                ['WhatsApp', detail.wa_connected ? 'Connected ✓' : '—'],
                ['Events', (detail.event_count || 0).toLocaleString()],
                ['Online now', detail.active_visitors || 0],
                ['Orders', detail.orders_count || 0],
                ['Revenue', fmtMoney(detail.revenue)],
                ['Last seen', fmtAgo(detail.last_event_ts) + ' ago'],
                ['Installed', detail.installed_days_ago != null ? `${detail.installed_days_ago}d ago` : '—'],
                ['Pixel', detail.pixel_ready ? 'Ready ✓' : 'Not installed'],
                ['Token', detail.has_token ? 'Valid ✓' : '—'],
                ['Scopes', detail.granted_scopes || '—'],
                ['TID', detail.tid ? detail.tid.slice(0, 16) + '…' : '—'],
              ].map(([k, v]) => (
                <div key={k} className="bg-surfaceAlt/50 rounded-lg p-2">
                  <div className="text-[10px] text-textMute">{k}</div>
                  <div className="text-text font-medium break-all text-[11px]">{v}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              {['needs_billing', 'trial_ended'].includes(detail.status) && detail.owner_phone && (
                <button onClick={() => nudge(detail)} disabled={nudging[detail.username + detail.brand]}
                  className="flex items-center justify-center gap-2 py-2.5 bg-blue text-white rounded-lg text-sm font-bold disabled:opacity-50">
                  {nudging[detail.username + detail.brand] ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />} WhatsApp onay linki gönder
                </button>
              )}
              {detail.owner_phone && (
                <a href={`https://wa.me/${detail.owner_phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2 py-2 bg-surfaceAlt border border-border text-text rounded-lg text-xs font-semibold no-underline">
                  <ExternalLink size={12} /> WhatsApp'tan yaz
                </a>
              )}
              {detail.shop_domain && (
                <a href={`https://${detail.shop_domain}/admin`} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2 py-2 bg-surfaceAlt border border-border text-text rounded-lg text-xs font-semibold no-underline">
                  <ExternalLink size={12} /> Shopify admin'i aç
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
