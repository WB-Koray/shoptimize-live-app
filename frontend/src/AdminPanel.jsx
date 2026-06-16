import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Users, CheckCircle, Clock, XCircle, Trash2, AlertCircle } from 'lucide-react';
import { LangSwitch } from './LangContext';
import { ThemeSwitch } from './ThemeContext';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';

// Türetilmiş duruma göre (backend `status` alanı) — etiket/filtre/istatistik tutarlı
const STATUS_COLORS = {
  active:        'text-green bg-green/10 border-green/20',
  trialing:      'text-amber-400 bg-amber-400/10 border-amber-400/20',
  needs_billing: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  trial_ended:   'text-orange-400 bg-orange-400/10 border-orange-400/20',
  declined:      'text-rose bg-roseSoft border-rose/20',
  uninstalled:   'text-textMute bg-surfaceAlt border-border',
};

const STATUS_LABELS = {
  active:        'Active',
  trialing:      'Trialing',
  needs_billing: 'Awaiting approval',
  trial_ended:   'Trial ended',
  declined:      'Declined',
  uninstalled:   'Uninstalled',
};

function StatCard({ icon: Icon, label, value, color = 'text-text' }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-surfaceAlt ${color}`}>
        <Icon size={18} />
      </div>
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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/admin/merchants?admin_token=${encodeURIComponent(adminToken)}`);
      const json = await res.json();
      if (!res.ok) { setError(json.detail || 'Error'); return; }
      setData(json);
    } catch (e) {
      setError('Could not connect');
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => { load(); }, [load]);

  const merchants = (data?.merchants || []).filter(m => {
    if (filter !== 'all' && m.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return m.username.toLowerCase().includes(q)
        || (m.shop_domain || '').toLowerCase().includes(q)
        || (m.shop_name || '').toLowerCase().includes(q);
    }
    return true;
  });

  const stats = data?.stats || {};

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <span className="font-bold text-text text-sm">Shoptimize Live — Admin</span>
          <span className="text-xs text-textMute bg-surfaceAlt border border-border px-2 py-0.5 rounded-md">
            {data?.total ?? '…'} merchants
          </span>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-textDim hover:text-text transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <LangSwitch />
            <ThemeSwitch />
            {onExit && (
              <button
                onClick={onExit}
                className="text-xs text-textMute hover:text-rose transition-colors"
              >
                Exit Admin
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="flex items-center gap-2 bg-roseSoft border border-rose/20 rounded-xl px-4 py-3 text-sm text-rose">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={CheckCircle} label="Active (paying)" value={stats.active ?? '—'} color="text-green" />
          <StatCard icon={Clock} label="Trialing" value={stats.trialing ?? '—'} color="text-amber-400" />
          <StatCard icon={AlertCircle} label="Awaiting approval" value={stats.needs_billing ?? '—'} color="text-blue-400" />
          <StatCard icon={XCircle} label="Trial ended" value={stats.trial_ended ?? '—'} color="text-orange-400" />
        </div>

        {/* Filters & Search */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search username or domain…"
            className="bg-surfaceAlt border border-border rounded-xl px-3 py-2 text-sm text-text placeholder:text-textMute
              focus:outline-none focus:border-green/60 focus:ring-1 focus:ring-green/30 w-64"
          />
          <div className="flex gap-1 flex-wrap">
            {['all', 'active', 'trialing', 'needs_billing', 'trial_ended', 'declined'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filter === f
                    ? 'bg-green/15 text-green border border-green/30'
                    : 'bg-surfaceAlt text-textMute border border-border hover:text-text'
                }`}
              >
                {f === 'all' ? 'All' : STATUS_LABELS[f]}
                {f !== 'all' && data && (
                  <span className="ml-1 opacity-60">
                    {data.merchants.filter(m => m.status === f).length}
                  </span>
                )}
              </button>
            ))}
          </div>
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
                  <th className="text-right px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide">Events</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide">Online</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide">Installed</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-textDim uppercase tracking-wide">Trial Left</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-textMute text-sm">Loading…</td>
                  </tr>
                )}
                {!loading && merchants.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-textMute text-sm">No merchants found</td>
                  </tr>
                )}
                {merchants.map((m, i) => (
                  <tr key={`${m.username}:${m.brand}`} className="border-b border-border last:border-0 hover:bg-surfaceAlt/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text">
                        {m.shop_name
                          ? (m.shop_domain
                              ? <a href={`https://${m.shop_domain}/admin`} target="_blank" rel="noopener noreferrer" className="hover:text-green transition-colors">{m.shop_name}</a>
                              : m.shop_name)
                          : <span className="text-textDim">{m.username}</span>}
                      </div>
                      <div className="text-[11px] text-textMute">
                        {m.shop_domain ? m.shop_domain.replace('.myshopify.com', '') : m.username}
                        {m.brand !== 'default' && ` · ${m.brand}`}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-textDim text-xs">
                      {m.owner_phone
                        ? <a href={`https://wa.me/${m.owner_phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="hover:text-green transition-colors font-mono">{m.owner_phone}</a>
                        : <span className="text-textMute">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${STATUS_COLORS[m.status] || STATUS_COLORS.uninstalled}`}>
                        {STATUS_LABELS[m.status] || m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {m.wa_connected
                        ? <span className="text-green" title="WhatsApp bağlı">✓</span>
                        : <span className="text-textMute">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-textDim">
                      {m.event_count > 0 ? m.event_count.toLocaleString() : <span className="text-textMute">0</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {m.active_visitors > 0
                        ? <span className="inline-flex items-center gap-1 text-green font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />{m.active_visitors}</span>
                        : <span className="text-textMute">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-textMute text-xs">
                      {m.installed_days_ago !== null
                        ? m.installed_days_ago === 0 ? 'Today' : `${m.installed_days_ago}d ago`
                        : '—'
                      }
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {m.trial_remaining_hours !== null && m.trial_remaining_hours > 0
                        ? <span className="text-amber-400">{m.trial_remaining_hours < 24 ? `${m.trial_remaining_hours}h` : `${Math.round(m.trial_remaining_hours / 24)}d`}</span>
                        : m.billing_status === 'active'
                          ? <span className="text-green text-[11px]">✓ Active</span>
                          : <span className="text-textMute">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
