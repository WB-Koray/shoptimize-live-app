import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Activity, Eye, ShoppingCart, Search, CreditCard, Package,
  Layers, CheckCircle, WifiOff, Zap, RefreshCw, Trash2,
  Radio, Users, ChevronDown, ChevronUp, TrendingUp,
  Smartphone, Monitor, Tablet, Globe, X, ArrowRight, BarChart2, LogOut,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';
const MAX_EVENTS = 500;

// ── Constants ────────────────────────────────────────────────────────────────

const EVENT_META = {
  page_viewed:        { label: 'Sayfa Görüntülendi',  icon: Eye,          color: 'blue'    },
  product_viewed:     { label: 'Ürün Görüntülendi',   icon: Package,      color: 'purple'  },
  collection_viewed:  { label: 'Koleksiyon',           icon: Layers,       color: 'teal'    },
  cart_viewed:        { label: 'Sepet Görüntülendi',  icon: ShoppingCart, color: 'orange'  },
  add_to_cart:        { label: 'Sepete Eklendi',       icon: ShoppingCart, color: 'emerald' },
  checkout_started:   { label: 'Ödemeye Geçildi',     icon: CreditCard,   color: 'yellow'  },
  checkout_completed: { label: 'Sipariş Tamamlandı',  icon: CheckCircle,  color: 'emerald' },
  search_submitted:   { label: 'Arama Yapıldı',       icon: Search,       color: 'slate'   },
};

const CM = {
  blue:    { bg: 'bg-blue-500/15',    text: 'text-blue-400',    dot: 'bg-blue-400'    },
  purple:  { bg: 'bg-purple-500/15',  text: 'text-purple-400',  dot: 'bg-purple-400'  },
  teal:    { bg: 'bg-teal-500/15',    text: 'text-teal-400',    dot: 'bg-teal-400'    },
  orange:  { bg: 'bg-orange-500/15',  text: 'text-orange-400',  dot: 'bg-orange-400'  },
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  yellow:  { bg: 'bg-yellow-500/15',  text: 'text-yellow-400',  dot: 'bg-yellow-400'  },
  slate:   { bg: 'bg-slate-500/15',   text: 'text-slate-400',   dot: 'bg-slate-400'   },
};

const STAGE_META = {
  browsing:  { label: 'Geziniyor',      color: 'slate'   },
  product:   { label: 'Ürün İnceliyor', color: 'purple'  },
  cart:      { label: 'Sepette',        color: 'orange'  },
  checkout:  { label: 'Ödeme',          color: 'yellow'  },
  converted: { label: 'Satın Aldı',     color: 'emerald' },
};

const SRC_COLORS = {
  'Arama':    'text-blue-400',
  'Facebook': 'text-blue-500',
  'Instagram':'text-pink-400',
  'TikTok':   'text-slate-300',
  'YouTube':  'text-red-400',
  'Twitter/X':'text-sky-400',
  'Doğrudan': 'text-emerald-400',
  'Diğer':    'text-slate-400',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtUrl(url) {
  try { return new URL(url).pathname || '/'; } catch { return url || '/'; }
}
function shortVid(vid) { return 'ziy_' + (vid || '').slice(-6); }
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}sn önce`;
  if (s < 3600) return `${Math.floor(s / 60)}dk önce`;
  return `${Math.floor(s / 3600)}sa önce`;
}
function parseDevice(ua = '', sw = 0) {
  const u = ua.toLowerCase();
  if (/ipad|tablet|kindle|silk/.test(u)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone/.test(u)) return 'mobile';
  if (sw > 0 && sw < 768) return 'mobile';
  if (sw > 0 && sw < 1024) return 'tablet';
  return 'desktop';
}
function parseReferrer(ref = '') {
  if (!ref) return 'Doğrudan';
  try {
    const h = new URL(ref).hostname.toLowerCase();
    if (/google\.|bing\.|yahoo\.|yandex\./.test(h)) return 'Arama';
    if (/facebook\.com|fb\.com/.test(h)) return 'Facebook';
    if (/instagram\.com/.test(h)) return 'Instagram';
    if (/tiktok\.com/.test(h)) return 'TikTok';
    if (/twitter\.com|t\.co|x\.com/.test(h)) return 'Twitter/X';
    if (/youtube\.com/.test(h)) return 'YouTube';
    if (/pinterest\.com/.test(h)) return 'Pinterest';
    return 'Diğer';
  } catch { return 'Diğer'; }
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color = 'blue', pulse, onClick }) {
  const c = CM[color] || CM.blue;
  return (
    <div onClick={onClick}
      className={`bg-[#161926] border border-slate-800 rounded-xl p-3 flex items-center gap-3 transition-colors
        ${onClick ? 'cursor-pointer hover:border-slate-600' : ''}`}>
      <div className={`p-2 rounded-lg ${c.bg} shrink-0 relative`}>
        <Icon size={16} className={c.text} />
        {pulse && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wide truncate">{label}</p>
        <p className={`text-lg font-bold leading-tight tabular-nums ${pulse ? c.text : 'text-white'}`}>{value}</p>
      </div>
      {onClick && <ArrowRight size={12} className="text-slate-600 shrink-0" />}
    </div>
  );
}

// ── ProductCard ───────────────────────────────────────────────────────────────

function ProductCard({ product, flash }) {
  return (
    <div className={`bg-[#13151f] border rounded-xl overflow-hidden transition-all duration-300
      ${flash ? 'border-purple-500/60 shadow-lg shadow-purple-500/10' : 'border-slate-800'}`}>
      <div className="relative aspect-square bg-slate-800/60 overflow-hidden">
        {product.image
          ? <img src={product.image} alt={product.title} className="w-full h-full object-cover"
              onError={e => { e.target.style.display = 'none'; }} />
          : <div className="w-full h-full flex items-center justify-center">
              <Package size={28} className="text-slate-600" />
            </div>
        }
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded-full">
          <Eye size={10} className="text-purple-400" />
          <span className={`text-xs font-bold tabular-nums ${flash ? 'text-purple-300' : 'text-white'}`}>{product.views}</span>
        </div>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-white text-xs font-semibold leading-tight line-clamp-2" title={product.title}>{product.title}</p>
        {product.price && (
          <p className="text-emerald-400 text-xs font-bold">
            {parseFloat(product.price).toLocaleString('tr-TR')} ₺
          </p>
        )}
        <div className="flex items-center gap-1 pt-1 border-t border-slate-800">
          <Eye size={10} className="text-purple-400" />
          <span className="text-[10px] text-slate-400">Görüntüleme</span>
          <span className="text-[10px] font-bold text-purple-300 ml-auto tabular-nums">{product.views}</span>
        </div>
        <div className="flex items-center gap-1">
          <ShoppingCart size={10} className="text-emerald-400" />
          <span className="text-[10px] text-slate-400">Sepete Ekleme</span>
          <span className="text-[10px] font-bold text-emerald-300 ml-auto tabular-nums">{product.carts}</span>
        </div>
        {product.views > 0 && product.carts > 0 && (
          <div className="text-center">
            <span className="text-[9px] font-bold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full">
              %{((product.carts / product.views) * 100).toFixed(0)} dönüşüm
            </span>
          </div>
        )}
        {product.vendor && <p className="text-[9px] text-slate-600 truncate">{product.vendor}</p>}
      </div>
    </div>
  );
}

// ── VisitorCard ───────────────────────────────────────────────────────────────

function VisitorCard({ profile, customerName, onClick }) {
  const sm = STAGE_META[profile.stage] || STAGE_META.browsing;
  const c  = CM[sm.color] || CM.slate;
  const DevIcon = profile.device === 'mobile' ? Smartphone : profile.device === 'tablet' ? Tablet : Monitor;
  const inactive = Date.now() - profile.lastTs > 5 * 60 * 1000;
  const fullName = customerName ? [customerName.first_name, customerName.last_name].filter(Boolean).join(' ') : null;
  return (
    <div onClick={onClick}
      className={`bg-[#13151f] border rounded-xl p-3 cursor-pointer hover:border-slate-600 transition-all space-y-2
        ${inactive ? 'border-slate-800/40 opacity-50' : 'border-slate-800'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <DevIcon size={11} className="text-slate-500" />
          <span className="text-[10px] text-slate-400 font-mono">{shortVid(profile.vid)}</span>
        </div>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>{sm.label}</span>
      </div>
      {fullName
        ? <p className="text-[10px] text-emerald-300 font-semibold truncate">{fullName}</p>
        : profile.customer_id
          ? <p className="text-[9px] text-emerald-500/60 font-mono truncate">Üye #{profile.customer_id}</p>
          : null
      }
      {profile.lastProduct && (
        <p className="text-[10px] text-white/70 truncate" title={profile.lastProduct}>{profile.lastProduct}</p>
      )}
      {profile.utm?.utm_campaign && (
        <p className="text-[9px] text-blue-400 truncate">{profile.utm.utm_source || 'utm'} / {profile.utm.utm_campaign}</p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-slate-600">{profile.referrer}</span>
        <span className="text-[9px] text-slate-600">{timeAgo(profile.lastTs)}</span>
      </div>
    </div>
  );
}

// ── EventRow ──────────────────────────────────────────────────────────────────

function EventRow({ ev, isNew }) {
  const meta = EVENT_META[ev.event_type] || { label: ev.event_type, icon: Activity, color: 'slate' };
  const c = CM[meta.color] || CM.slate;
  const Icon = meta.icon;
  const d = ev.data || {};
  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border transition-all duration-500
      ${isNew ? 'border-emerald-500/40 bg-emerald-500/5 event-enter' : 'border-slate-800/60 bg-[#13151f]'}`}>
      <div className={`p-1.5 rounded-lg ${c.bg} shrink-0 mt-0.5`}>
        <Icon size={14} className={c.text} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold ${c.text}`}>{meta.label}</span>
          {d.order_number && (
            <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
              #{d.order_number}
            </span>
          )}
          {d.total_price && (
            <span className="text-[10px] font-bold text-emerald-400">
              {parseFloat(d.total_price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {d.currency || 'TRY'}
            </span>
          )}
          {d.product_title && !d.order_number && (
            <span className="text-[10px] text-white/80 bg-slate-700/60 px-1.5 py-0.5 rounded truncate max-w-[160px]" title={d.product_title}>
              {d.product_title}
            </span>
          )}
          {d.query && <span className="text-[10px] text-white/80 bg-slate-700/60 px-1.5 py-0.5 rounded">"{d.query}"</span>}
          {d.product_price && !d.order_number && (
            <span className="text-[10px] text-emerald-400 font-bold">{d.product_price} ₺</span>
          )}
        </div>
        {d.line_items?.length > 0 && (
          <p className="text-[9px] text-slate-500 mt-0.5 truncate">
            {d.line_items.slice(0, 3).map(li => `${li.title} ×${li.quantity}`).join(' · ')}
            {d.line_items.length > 3 ? ` +${d.line_items.length - 3}` : ''}
          </p>
        )}
        {!d.line_items?.length && (
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{fmtUrl(ev.url)}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.dot}`} />
          <span className="text-[9px] text-slate-600">{shortVid(ev.vid)}</span>
          {ev.customer_id && <span className="text-[9px] text-emerald-500">Üye #{ev.customer_id}</span>}
          {ev.utm?.utm_campaign && (
            <span className="text-[9px] text-blue-400 bg-blue-500/10 px-1 rounded">{ev.utm.utm_campaign}</span>
          )}
          <span className="text-[9px] text-slate-600">{fmtTime(ev.ts)}</span>
        </div>
      </div>
    </div>
  );
}

// ── FunnelWidget ──────────────────────────────────────────────────────────────

function FunnelWidget({ stats }) {
  const total = stats.total || 1;
  const steps = [
    { label: 'Tüm Ziyaretçi',   count: stats.total,     color: 'bg-blue-500',    pct: 100 },
    { label: 'Ürün İnceledi',    count: stats.product,   color: 'bg-purple-500',  pct: (stats.product / total) * 100 },
    { label: 'Sepete Ekledi',    count: stats.cart,      color: 'bg-orange-500',  pct: (stats.cart / total) * 100 },
    { label: 'Ödeme Başlattı',   count: stats.checkout,  color: 'bg-yellow-500',  pct: (stats.checkout / total) * 100 },
    { label: 'Satın Aldı',       count: stats.converted, color: 'bg-emerald-500', pct: (stats.converted / total) * 100 },
  ];
  return (
    <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-slate-800">
        <TrendingUp size={15} className="text-blue-400" />
        <span className="text-white text-sm font-bold">Dönüşüm Hunisi</span>
      </div>
      <div className="p-4 space-y-3">
        {steps.map((step, i) => (
          <div key={step.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{step.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold tabular-nums">{step.count}</span>
                {i > 0 && <span className="text-[10px] text-slate-500">({step.pct.toFixed(1)}%)</span>}
              </div>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full ${step.color} rounded-full transition-all duration-700`}
                style={{ width: `${Math.min(100, step.pct)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TrafficTable ──────────────────────────────────────────────────────────────

function TrafficTable({ traffic, onSourceClick }) {
  if (!traffic.length) return null;
  const max = traffic[0]?.count || 1;
  const total = traffic.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-slate-800">
        <Globe size={15} className="text-slate-400" />
        <span className="text-white text-sm font-bold">Trafik Kaynakları</span>
        <span className="text-[10px] text-slate-600 ml-auto">Tıkla → ürünleri gör</span>
      </div>
      <div className="divide-y divide-slate-800/60">
        {traffic.map(({ source, count }) => (
          <div key={source} onClick={() => onSourceClick?.(source)}
            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-800/30 transition-colors">
            <span className={`text-xs font-bold w-24 shrink-0 ${SRC_COLORS[source] || 'text-slate-400'}`}>{source}</span>
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <span className="text-xs font-bold text-slate-300 tabular-nums w-5 text-right">{count}</span>
            <span className="text-[10px] text-slate-600 w-8 text-right">{((count / total) * 100).toFixed(0)}%</span>
            <ArrowRight size={11} className="text-slate-700 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SearchTable ───────────────────────────────────────────────────────────────

function SearchTable({ searches }) {
  if (!searches.length) return null;
  return (
    <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-slate-800">
        <Search size={15} className="text-slate-400" />
        <span className="text-white text-sm font-bold">Canlı Aramalar</span>
        <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full ml-auto">{searches.length} terim</span>
      </div>
      <div className="divide-y divide-slate-800/60">
        {searches.map((s, i) => (
          <div key={s.query} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
            <span className="text-[10px] text-slate-600 w-4 text-right font-mono">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <span className="text-sm text-white font-medium">"{s.query}"</span>
            </div>
            <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (s.count / searches[0].count) * 100)}%` }} />
            </div>
            <span className="text-xs font-bold text-slate-300 w-6 text-right tabular-nums">{s.count}</span>
            <span className="text-[9px] text-slate-600 w-16 text-right">{timeAgo(s.lastTs)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── JourneyModal ──────────────────────────────────────────────────────────────

function JourneyModal({ profile, customerName, onClose }) {
  if (!profile) return null;
  const sm = STAGE_META[profile.stage] || STAGE_META.browsing;
  const c = CM[sm.color] || CM.slate;
  const DevIcon = profile.device === 'mobile' ? Smartphone : profile.device === 'tablet' ? Tablet : Monitor;
  const fullName = customerName ? [customerName.first_name, customerName.last_name].filter(Boolean).join(' ') : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0d0f18] border border-slate-700 rounded-2xl w-full max-w-lg max-h-[82vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-slate-800/80">
              <DevIcon size={14} className="text-slate-400" />
            </div>
            <div>
              {fullName
                ? <><p className="text-emerald-300 font-bold text-sm">{fullName}</p>
                    <p className="text-slate-500 text-[10px]">{shortVid(profile.vid)} · {profile.referrer} · {profile.device}</p></>
                : <><p className="text-white font-bold text-sm">{shortVid(profile.vid)}</p>
                    <p className="text-slate-500 text-[10px]">{profile.referrer} · {profile.device}</p></>
              }
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${c.bg} ${c.text}`}>{sm.label}</span>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800/60 text-[10px] text-slate-500 flex-wrap">
          <span>{profile.events.length} event</span>
          <span>İlk: {fmtTime(profile.firstTs)}</span>
          <span>Son: {fmtTime(profile.lastTs)}</span>
          <span>{Math.max(0, Math.round((profile.lastTs - profile.firstTs) / 60000))} dk</span>
          {profile.customer_id && !fullName && <span className="text-emerald-400 font-semibold">Üye #{profile.customer_id}</span>}
          {customerName?.email && <span className="text-slate-400">{customerName.email}</span>}
          {customerName?.orders_count > 0 && <span className="text-orange-400">{customerName.orders_count} sipariş</span>}
          {customerName?.total_spent && parseFloat(customerName.total_spent) > 0 && (
            <span className="text-emerald-400">{parseFloat(customerName.total_spent).toLocaleString('tr-TR')} ₺</span>
          )}
          {profile.utm?.utm_campaign && (
            <span className="text-blue-400">{[profile.utm.utm_source, profile.utm.utm_medium, profile.utm.utm_campaign].filter(Boolean).join(' / ')}</span>
          )}
        </div>
        <div className="overflow-y-auto flex-1 p-3 space-y-1 custom-scrollbar">
          {[...profile.events].reverse().map((ev, i) => {
            const meta = EVENT_META[ev.event_type] || { label: ev.event_type, color: 'slate', icon: Activity };
            const ec = CM[meta.color] || CM.slate;
            const Icon = meta.icon;
            return (
              <div key={i} className="flex items-start gap-3 px-2 py-1.5 rounded-lg hover:bg-slate-800/30">
                <div className={`p-1 rounded-md ${ec.bg} shrink-0 mt-0.5`}><Icon size={11} className={ec.text} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold ${ec.text}`}>{meta.label}</span>
                    {ev.data?.product_title && <span className="text-[10px] text-white/70 truncate max-w-[160px]">{ev.data.product_title}</span>}
                    {ev.data?.query && <span className="text-[10px] text-white/70">"{ev.data.query}"</span>}
                  </div>
                  <p className="text-[9px] text-slate-600 truncate">{fmtUrl(ev.url)}</p>
                </div>
                <span className="text-[9px] text-slate-600 shrink-0">{fmtTime(ev.ts)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── DrillDownModal ────────────────────────────────────────────────────────────

function DrillDownModal({ title, subtitle, products, visitors, onClose }) {
  if (!title) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0d0f18] border border-slate-700 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div>
            <p className="text-white font-bold text-sm">{title}</p>
            {subtitle && <p className="text-slate-500 text-[10px] mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-3 space-y-1 custom-scrollbar">
          {products?.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-slate-500 uppercase font-bold px-2 mb-1">Görüntülenen Ürünler ({products.length})</p>
              {products.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-800/30 transition-colors">
                  <span className="text-[10px] text-slate-600 w-4 text-right font-mono">{i + 1}</span>
                  {p.image && <img src={p.image} alt={p.title} className="w-8 h-8 rounded object-cover shrink-0"
                    onError={e => { e.target.style.display = 'none'; }} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-medium truncate">{p.title}</p>
                    {p.price && <p className="text-[10px] text-emerald-400">{parseFloat(p.price).toLocaleString('tr-TR')} ₺</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-purple-300 tabular-nums">{p.views}</p>
                    <p className="text-[9px] text-slate-600">görüntüleme</p>
                  </div>
                  {p.carts > 0 && (
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-emerald-300 tabular-nums">{p.carts}</p>
                      <p className="text-[9px] text-slate-600">sepet</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {visitors?.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-bold px-2 mb-1">Ziyaretçiler ({visitors.length})</p>
              {visitors.slice(0, 30).map((v, i) => {
                const sm2 = STAGE_META[v.stage] || STAGE_META.browsing;
                const c2 = CM[sm2.color] || CM.slate;
                return (
                  <div key={i} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-slate-800/30 transition-colors">
                    <span className="text-[9px] font-mono text-slate-500 w-16">{shortVid(v.vid)}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${c2.bg} ${c2.text} shrink-0`}>{sm2.label}</span>
                    {v.lastProduct && <span className="text-[10px] text-white/60 flex-1 truncate">{v.lastProduct}</span>}
                    <span className="text-[9px] text-slate-600 shrink-0">{timeAgo(v.lastTs)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {!products?.length && !visitors?.length && (
            <div className="py-8 text-center text-slate-600 text-sm">Veri yok</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section header helper ─────────────────────────────────────────────────────

function SectionHead({ icon: Icon, iconClass = 'text-slate-400', title, badge, extra }) {
  return (
    <div className="flex items-center gap-2 p-4 border-b border-slate-800">
      <Icon size={15} className={iconClass} />
      <span className="text-white text-sm font-bold">{title}</span>
      {badge !== undefined && (
        <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full ml-1">{badge}</span>
      )}
      {extra && <span className="text-[10px] text-slate-600 ml-auto">{extra}</span>}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({ session, onLogout }) {
  const { token, username, brand, tid } = session;
  const qs = `username=${encodeURIComponent(username)}&brand=${encodeURIComponent(brand)}`;

  // SSE state
  const [events, setEvents]           = useState([]);
  const [sseStatus, setSseStatus]     = useState('connecting');
  const [paused, setPaused]           = useState(false);
  const [feedOpen, setFeedOpen]       = useState(true);
  const [newIds, setNewIds]           = useState(new Set());
  const [flashProducts, setFlashProducts] = useState(new Set());

  // UI state
  const [selectedVisitor, setSelectedVisitor] = useState(null);
  const [drillDown, setDrillDown]             = useState(null);
  const [customerNames, setCustomerNames]     = useState({});

  // Pixel state
  const [pixelStatus, setPixelStatus]   = useState(null);
  const [pixelLoading, setPixelLoading] = useState(true);
  const [installing, setInstalling]     = useState(false);
  const [webhookStatus, setWebhookStatus]   = useState(null);
  const [webhookLoading, setWebhookLoading] = useState(false);

  const esRef        = useRef(null);
  const pausedRef    = useRef(false);
  const uidCounter   = useRef(0);
  const customerCache = useRef({});
  const retryRef     = useRef(null);

  // ── SSE connection ──────────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (!tid || !token) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    clearTimeout(retryRef.current);
    setSseStatus('connecting');

    const url = `${API_URL}/api/live/stream?tid=${encodeURIComponent(tid)}&token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setSseStatus('connected');

    es.onmessage = (e) => {
      if (pausedRef.current) return;
      try {
        const ev = JSON.parse(e.data);
        const uid = `${ev.ts}_${ev.vid}_${ev.event_type}_${uidCounter.current++}`;
        ev._uid = uid;

        setEvents(prev => {
          const next = [ev, ...prev];
          return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
        });

        setNewIds(prev => { const n = new Set(prev); n.add(uid); return n; });
        setTimeout(() => setNewIds(prev => { const n = new Set(prev); n.delete(uid); return n; }), 2000);

        if (ev.event_type === 'product_viewed') {
          const key = ev.data?.product_id || ev.data?.product_handle || ev.data?.product_title;
          if (key) {
            setFlashProducts(prev => { const n = new Set(prev); n.add(key); return n; });
            setTimeout(() => setFlashProducts(prev => { const n = new Set(prev); n.delete(key); return n; }), 1500);
          }
        }
      } catch { /* ignore malformed */ }
    };

    es.onerror = () => {
      setSseStatus('disconnected');
      es.close();
      esRef.current = null;
      retryRef.current = setTimeout(connectSSE, 5000);
    };
  }, [tid, token]);

  useEffect(() => {
    connectSSE();
    return () => {
      clearTimeout(retryRef.current);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [connectSSE]);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // ── Pixel status ────────────────────────────────────────────────────────────
  const fetchPixelStatus = useCallback(async () => {
    setPixelLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/shopify/pixel/status?${qs}`);
      setPixelStatus(await r.json());
    } catch { setPixelStatus(null); }
    setPixelLoading(false);
  }, [qs]);

  useEffect(() => { fetchPixelStatus(); }, [fetchPixelStatus]);

  const fetchWebhookStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/shopify/webhook/status?${qs}`);
      setWebhookStatus(await r.json());
    } catch {}
  }, [qs]);

  useEffect(() => {
    if (pixelStatus?.installed) fetchWebhookStatus();
  }, [pixelStatus?.installed, fetchWebhookStatus]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const r = await fetch(`${API_URL}/api/shopify/pixel/install?${qs}`, { method: 'POST' });
      if ((await r.json()).ok) await fetchPixelStatus();
    } catch {}
    setInstalling(false);
  };

  const handleUninstall = async () => {
    if (!confirm('Pixel kaldırılacak ve takip duracak. Emin misiniz?')) return;
    setInstalling(true);
    try {
      const r = await fetch(`${API_URL}/api/shopify/pixel/uninstall?${qs}`, { method: 'DELETE' });
      if ((await r.json()).ok) { setEvents([]); await fetchPixelStatus(); }
    } catch {}
    setInstalling(false);
  };

  const handleRegisterWebhook = async () => {
    setWebhookLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/shopify/webhook/register?${qs}`, { method: 'POST' });
      if ((await r.json()).ok) await fetchWebhookStatus();
    } catch {}
    setWebhookLoading(false);
  };

  // ── Customer name fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    const toFetch = visitorProfiles
      .filter(p => p.customer_id && !(p.customer_id in customerCache.current))
      .map(p => p.customer_id)
      .filter((id, i, arr) => arr.indexOf(id) === i);
    if (!toFetch.length) return;
    toFetch.forEach(id => { customerCache.current[id] = true; });
    Promise.all(toFetch.map(async id => {
      try {
        const r = await fetch(`${API_URL}/api/shopify/customer?customer_id=${encodeURIComponent(id)}&${qs}`);
        const d = await r.json();
        if (d.ok && d.customer) return [id, d.customer];
      } catch {}
      return [id, null];
    })).then(results => {
      const updates = {};
      results.forEach(([id, c]) => { if (c) updates[id] = c; });
      if (Object.keys(updates).length) setCustomerNames(prev => ({ ...prev, ...updates }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length, qs]);

  // ── Computed data ────────────────────────────────────────────────────────────

  const evStats = useMemo(() => events.reduce((acc, ev) => {
    acc[ev.event_type] = (acc[ev.event_type] || 0) + 1;
    return acc;
  }, {}), [events]);

  const uniqueVisitorCount = useMemo(() => new Set(events.map(e => e.vid)).size, [events]);

  const visitorProfiles = useMemo(() => {
    const map = {};
    for (const ev of events) {
      if (!map[ev.vid]) {
        map[ev.vid] = {
          vid: ev.vid,
          device: parseDevice(ev.ua, ev.sw),
          referrer: parseReferrer(ev.referrer),
          events: [],
          stage: 'browsing',
          lastProduct: null,
          lastTs: ev.ts,
          firstTs: ev.ts,
          customer_id: ev.customer_id || '',
          utm: ev.utm || {},
        };
      }
      const p = map[ev.vid];
      p.events.push(ev);
      if (ev.ts > p.lastTs) p.lastTs = ev.ts;
      if (ev.ts < p.firstTs) p.firstTs = ev.ts;
      if (!p.customer_id && ev.customer_id) p.customer_id = ev.customer_id;
      if (!p.utm?.utm_campaign && ev.utm?.utm_campaign) p.utm = ev.utm;
      if (ev.event_type === 'checkout_completed') p.stage = 'converted';
      else if (ev.event_type === 'checkout_started' && p.stage !== 'converted') p.stage = 'checkout';
      else if ((ev.event_type === 'cart_viewed' || ev.event_type === 'add_to_cart') && !['checkout','converted'].includes(p.stage)) p.stage = 'cart';
      else if (ev.event_type === 'product_viewed' && p.stage === 'browsing') p.stage = 'product';
      if (ev.event_type === 'product_viewed' && ev.data?.product_title) p.lastProduct = ev.data.product_title;
    }
    return Object.values(map).sort((a, b) => b.lastTs - a.lastTs);
  }, [events]);

  const memberCount = useMemo(() => visitorProfiles.filter(p => p.customer_id).length, [visitorProfiles]);

  const abandonedVisitors = useMemo(() =>
    visitorProfiles.filter(p => p.stage === 'checkout' && (Date.now() - p.lastTs) > 15 * 60 * 1000)
  , [visitorProfiles]);

  const funnelStats = useMemo(() => {
    let product = 0, cart = 0, checkout = 0, converted = 0;
    for (const p of visitorProfiles) {
      if (['product','cart','checkout','converted'].includes(p.stage)) product++;
      if (['cart','checkout','converted'].includes(p.stage)) cart++;
      if (['checkout','converted'].includes(p.stage)) checkout++;
      if (p.stage === 'converted') converted++;
    }
    return { total: visitorProfiles.length, product, cart, checkout, converted };
  }, [visitorProfiles]);

  const productStats = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const d = ev.data || {};
      if (ev.event_type === 'product_viewed' && (d.product_title || d.product_handle)) {
        const key = d.product_id || d.product_handle || d.product_title;
        if (!map[key]) map[key] = { key, title: d.product_title || key, image: d.product_image || '', price: d.product_price || '', vendor: d.product_vendor || '', views: 0, carts: 0, lastTs: ev.ts };
        map[key].views++;
        if (ev.ts > map[key].lastTs) map[key].lastTs = ev.ts;
      }
    }
    const vidLastProd = {};
    for (const ev of [...events].reverse()) {
      const d = ev.data || {};
      const pKey = d.product_id || d.product_handle || d.product_title;
      if (ev.event_type === 'product_viewed' && pKey) vidLastProd[ev.vid] = pKey;
      if (ev.event_type === 'add_to_cart' && vidLastProd[ev.vid]) {
        const k = vidLastProd[ev.vid];
        if (map[k]) map[k].carts++;
      }
    }
    return Object.values(map).sort((a, b) => b.views - a.views).slice(0, 12);
  }, [events]);

  const searchStats = useMemo(() => {
    const map = {};
    for (const ev of events) {
      if (ev.event_type === 'search_submitted' && ev.data?.query) {
        const q = ev.data.query.trim().toLowerCase();
        if (!q) continue;
        if (!map[q]) map[q] = { query: ev.data.query.trim(), count: 0, lastTs: ev.ts };
        map[q].count++;
        if (ev.ts > map[q].lastTs) map[q].lastTs = ev.ts;
      }
    }
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 20);
  }, [events]);

  const collectionStats = useMemo(() => {
    const map = {};
    for (const ev of events) {
      if (ev.event_type === 'collection_viewed' && ev.data?.collection_handle) {
        const h = ev.data.collection_handle;
        if (!map[h]) map[h] = { handle: h, count: 0, lastTs: ev.ts };
        map[h].count++;
        if (ev.ts > map[h].lastTs) map[h].lastTs = ev.ts;
      }
    }
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 15);
  }, [events]);

  const pageStats = useMemo(() => {
    const map = {};
    for (const ev of events) {
      if (ev.event_type !== 'page_viewed') continue;
      const path = fmtUrl(ev.url);
      if (!path || path === '/') continue;
      if (!map[path]) map[path] = { path, title: ev.data?.title || path, count: 0, vids: new Set(), lastTs: ev.ts };
      map[path].count++;
      map[path].vids.add(ev.vid);
      if (ev.ts > map[path].lastTs) map[path].lastTs = ev.ts;
    }
    return Object.values(map).sort((a, b) => b.vids.size - a.vids.size).slice(0, 30);
  }, [events]);

  const notFoundStats = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const title = (ev.data?.title || '').toLowerCase();
      if (!title.includes('404') && !title.includes('bulunamad') && !title.includes('not found')) continue;
      const path = fmtUrl(ev.url);
      if (!map[path]) map[path] = { path, url: ev.url, count: 0, vids: new Set(), lastTs: ev.ts };
      map[path].count++;
      map[path].vids.add(ev.vid);
      if (ev.ts > map[path].lastTs) map[path].lastTs = ev.ts;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [events]);

  const trafficStats = useMemo(() => {
    const vids = {};
    for (const ev of events) if (!vids[ev.vid]) vids[ev.vid] = parseReferrer(ev.referrer);
    const counts = {};
    for (const src of Object.values(vids)) counts[src] = (counts[src] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([source, count]) => ({ source, count }));
  }, [events]);

  const sourceProductsMap = useMemo(() => {
    const vidSrc = {};
    for (const ev of events) if (!vidSrc[ev.vid]) vidSrc[ev.vid] = parseReferrer(ev.referrer);
    const result = {};
    for (const ev of events) {
      if (ev.event_type !== 'product_viewed') continue;
      const d = ev.data || {};
      const key = d.product_id || d.product_handle || d.product_title;
      if (!key) continue;
      const src = vidSrc[ev.vid];
      if (!result[src]) result[src] = {};
      if (!result[src][key]) result[src][key] = { title: d.product_title || key, image: d.product_image || '', price: d.product_price || '', views: 0, carts: 0 };
      result[src][key].views++;
    }
    return result;
  }, [events]);

  const utmStats = useMemo(() => {
    const camps = {};
    const vidLastProd = {};
    for (const ev of events) {
      const utm = ev.utm || {};
      const camp = utm.utm_campaign;
      if (!camp) continue;
      if (!camps[camp]) camps[camp] = { campaign: camp, source: utm.utm_source || '', medium: utm.utm_medium || '', views: 0, carts: 0, vids: new Set(), products: {} };
      const c = camps[camp];
      c.vids.add(ev.vid);
      if (ev.event_type === 'product_viewed') {
        const d = ev.data || {};
        const key = d.product_id || d.product_handle || d.product_title;
        if (key) {
          c.views++;
          if (!c.products[key]) c.products[key] = { title: d.product_title || key, image: d.product_image || '', price: d.product_price || '', views: 0, carts: 0 };
          c.products[key].views++;
          vidLastProd[ev.vid] = { key, camp };
        }
      }
      if (ev.event_type === 'add_to_cart' && vidLastProd[ev.vid]) {
        const { key, camp: lc } = vidLastProd[ev.vid];
        if (camps[lc]) { camps[lc].carts++; if (camps[lc].products[key]) camps[lc].products[key].carts++; }
      }
    }
    return Object.values(camps)
      .map(c => ({ ...c, products: Object.values(c.products).sort((a, b) => b.views - a.views) }))
      .sort((a, b) => b.views - a.views);
  }, [events]);

  // ── Status badge ─────────────────────────────────────────────────────────────
  const statusBadge = sseStatus === 'connected'
    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
    : sseStatus === 'connecting'
    ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
    : 'bg-slate-700/30 border-slate-700 text-slate-500';

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0b10] p-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <Radio size={20} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-white font-bold text-base">Shoptimize Live</h1>
            <p className="text-slate-500 text-xs">{username} / {brand}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${statusBadge}`}>
            {sseStatus === 'connected'
              ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Canlı</>
              : sseStatus === 'connecting'
              ? <><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" /> Bağlanıyor...</>
              : <><WifiOff size={12} /> Bağlı Değil</>}
          </div>
          <button onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-400 text-xs font-bold rounded-full hover:text-white transition-colors">
            <LogOut size={12} /> Çıkış
          </button>
        </div>
      </div>

      {/* Pixel panel */}
      <div className={`rounded-xl border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3
        ${pixelStatus?.installed ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-800/40 border-slate-700'}`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${pixelStatus?.installed ? 'bg-emerald-500/15' : 'bg-slate-700/40'}`}>
            <Zap size={16} className={pixelStatus?.installed ? 'text-emerald-400' : 'text-slate-400'} />
          </div>
          <div>
            <p className={`text-sm font-bold ${pixelStatus?.installed ? 'text-emerald-400' : 'text-white'}`}>
              {pixelStatus?.installed ? 'Storefront Pixel Kurulu' : 'Storefront Pixel Kurulu Değil'}
            </p>
            <p className="text-slate-500 text-[10px]">
              {pixelStatus?.installed
                ? `Tracking ID: ${pixelStatus.tracking_id || '—'}`
                : 'Ziyaretçi hareketlerini takip etmek için pixeli kurun'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pixelStatus?.installed && (
            <button onClick={handleRegisterWebhook} disabled={webhookLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors disabled:opacity-50
                ${webhookStatus?.registered
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20'}`}>
              {webhookLoading ? <><RefreshCw size={11} className="animate-spin" /> Kuruluyor...</>
                : webhookStatus?.registered ? <><CheckCircle size={11} /> Sipariş Takibi Aktif</>
                : <><Zap size={11} /> Sipariş Takibini Kur</>}
            </button>
          )}
          {pixelStatus?.installed
            ? <button onClick={handleUninstall} disabled={installing || pixelLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50">
                <Trash2 size={12} /> Kaldır
              </button>
            : <button onClick={handleInstall} disabled={installing || pixelLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold rounded-lg hover:scale-105 transition-transform disabled:opacity-50 shadow-lg">
                {installing ? <><RefreshCw size={12} className="animate-spin" /> Kuruluyor...</> : <><Zap size={12} /> Tek Tıkla Kur</>}
              </button>
          }
        </div>
      </div>

      {/* 7 stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatCard label="Toplam Event" value={events.length} icon={Activity} color="blue" pulse={sseStatus === 'connected'}
          onClick={() => setDrillDown({ title: 'Tüm Eventler', subtitle: `${events.length} event`, products: productStats.slice(0, 20), visitors: visitorProfiles })} />
        <StatCard label="Tekil Ziyaretçi" value={uniqueVisitorCount} icon={Users} color="purple"
          onClick={() => setDrillDown({ title: 'Tekil Ziyaretçiler', subtitle: `${uniqueVisitorCount} ziyaretçi`, products: productStats.slice(0, 20), visitors: visitorProfiles })} />
        <StatCard label="Aktif Üyeler" value={memberCount} icon={CheckCircle} color="teal"
          onClick={() => setDrillDown({ title: 'Üye Girişi Yapanlar', subtitle: `${memberCount} üye`,
            products: productStats.filter(p => events.some(ev => ev.event_type === 'product_viewed' && visitorProfiles.find(v => v.vid === ev.vid && v.customer_id) && (ev.data?.product_id === p.key || ev.data?.product_title === p.key))),
            visitors: visitorProfiles.filter(v => v.customer_id) })} />
        <StatCard label="Sepete Ekleme" value={evStats['add_to_cart'] || 0} icon={ShoppingCart} color="emerald"
          onClick={() => setDrillDown({ title: 'Sepete Eklenen Ürünler', subtitle: `${evStats['add_to_cart'] || 0} sepet eventi`,
            products: productStats.filter(p => p.carts > 0).sort((a, b) => b.carts - a.carts),
            visitors: visitorProfiles.filter(v => ['cart','checkout','converted'].includes(v.stage)) })} />
        <StatCard label="Ödeme Başlatma" value={evStats['checkout_started'] || 0} icon={CreditCard} color="yellow"
          onClick={() => setDrillDown({ title: 'Ödeme Başlatan Ziyaretçiler', subtitle: `${evStats['checkout_started'] || 0} checkout eventi`,
            products: productStats.slice(0, 20),
            visitors: visitorProfiles.filter(v => ['checkout','converted'].includes(v.stage)) })} />
        <StatCard label="Tamamlanan" value={evStats['checkout_completed'] || 0} icon={CheckCircle} color="emerald"
          onClick={() => setDrillDown({ title: 'Tamamlanan Siparişler', subtitle: `${evStats['checkout_completed'] || 0} sipariş`,
            products: [], visitors: visitorProfiles.filter(v => v.stage === 'converted') })} />
        <StatCard label="Terk Edilen Ödeme" value={abandonedVisitors.length} icon={CreditCard} color="orange"
          onClick={() => setDrillDown({ title: 'Terk Edilen Ödemeler', subtitle: 'Ödemeye geçti, tamamlamadı (15+ dk)',
            products: productStats.filter(p => abandonedVisitors.some(v => v.events.some(ev => ev.event_type === 'product_viewed' && (ev.data?.product_id === p.key || ev.data?.product_title === p.key)))),
            visitors: abandonedVisitors })} />
      </div>

      {/* Abandoned checkout alert */}
      {abandonedVisitors.length > 0 && (
        <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CreditCard size={15} className="text-orange-400" />
            <span className="text-orange-400 text-sm font-bold">Terk Edilen Ödemeler</span>
            <span className="text-[10px] bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full">
              {abandonedVisitors.length} ziyaretçi ödemeye geçti, tamamlamadı
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {abandonedVisitors.slice(0, 6).map(profile => {
              const cn = customerNames[profile.customer_id];
              const name = cn ? [cn.first_name, cn.last_name].filter(Boolean).join(' ') : null;
              return (
                <div key={profile.vid} onClick={() => setSelectedVisitor(profile)}
                  className="flex items-center gap-3 bg-[#13151f] border border-orange-500/20 rounded-lg p-3 cursor-pointer hover:border-orange-500/40 transition-colors">
                  <div className="p-1.5 rounded-lg bg-orange-500/15 shrink-0"><CreditCard size={13} className="text-orange-400" /></div>
                  <div className="flex-1 min-w-0">
                    {name ? <p className="text-xs font-bold text-emerald-300 truncate">{name}</p>
                      : <p className="text-xs font-mono text-slate-400">{shortVid(profile.vid)}</p>}
                    {profile.lastProduct && <p className="text-[10px] text-white/60 truncate">{profile.lastProduct}</p>}
                  </div>
                  <span className="text-[9px] text-orange-400 shrink-0">{timeAgo(profile.lastTs)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Product grid */}
      {productStats.length > 0 && (
        <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl overflow-hidden">
          <SectionHead icon={TrendingUp} iconClass="text-purple-400" title="En Çok Görüntülenen Ürünler" badge={`${productStats.length} ürün`} />
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {productStats.map(p => <ProductCard key={p.key} product={p} flash={flashProducts.has(p.key)} />)}
          </div>
        </div>
      )}

      {/* Collections */}
      {collectionStats.length > 0 && (
        <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl overflow-hidden">
          <SectionHead icon={Layers} iconClass="text-teal-400" title="En Çok Görüntülenen Koleksiyonlar" badge={`${collectionStats.length} koleksiyon`} />
          <div className="divide-y divide-slate-800/60">
            {collectionStats.map((col, i) => (
              <div key={col.handle} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
                <span className="text-[10px] text-slate-600 w-4 text-right font-mono">{i + 1}</span>
                <span className="flex-1 text-sm text-white font-medium">{col.handle}</span>
                <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-teal-500 to-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (col.count / collectionStats[0].count) * 100)}%` }} />
                </div>
                <span className="text-xs font-bold text-slate-300 w-6 text-right tabular-nums">{col.count}</span>
                <span className="text-[9px] text-slate-600 w-16 text-right">{timeAgo(col.lastTs)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 404 pages */}
      {notFoundStats.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-red-500/15">
            <span className="text-sm font-bold text-red-400">404</span>
            <span className="text-white text-sm font-bold">Bulunamayan Sayfalar</span>
            <span className="text-[10px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full ml-auto">{notFoundStats.length} URL</span>
          </div>
          <div className="divide-y divide-red-500/10">
            {notFoundStats.map((item, i) => (
              <div key={item.path} className="flex items-center gap-3 px-4 py-2.5 hover:bg-red-500/5 transition-colors">
                <span className="text-[10px] text-slate-600 w-4 text-right font-mono shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white font-mono truncate" title={item.url}>{item.path}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-bold text-red-300 tabular-nums">{item.vids.size}</p>
                    <p className="text-[9px] text-slate-600">tekil</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-slate-400 tabular-nums">{item.count}</p>
                    <p className="text-[9px] text-slate-600">istek</p>
                  </div>
                  <span className="text-[9px] text-slate-600 w-16 text-right">{timeAgo(item.lastTs)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Page stats */}
      {pageStats.length > 0 && (
        <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl overflow-hidden">
          <SectionHead icon={Eye} title="Sayfa İstatistikleri" badge={`${pageStats.length} sayfa`} extra="Blog, içerik ve diğer sayfalar" />
          <div className="divide-y divide-slate-800/60">
            {pageStats.map((page, i) => (
              <div key={page.path} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
                <span className="text-[10px] text-slate-600 w-4 text-right font-mono shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white font-medium truncate" title={page.title}>{page.title}</p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{page.path}</p>
                </div>
                <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden shrink-0">
                  <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (page.vids.size / (pageStats[0]?.vids.size || 1)) * 100)}%` }} />
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-bold text-purple-300 tabular-nums">{page.vids.size}</p>
                    <p className="text-[9px] text-slate-600">tekil</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-slate-400 tabular-nums">{page.count}</p>
                    <p className="text-[9px] text-slate-600">görüntüleme</p>
                  </div>
                  <span className="text-[9px] text-slate-600 w-16 text-right">{timeAgo(page.lastTs)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live searches */}
      <SearchTable searches={searchStats} />

      {/* UTM campaigns */}
      {utmStats.length > 0 && (
        <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl overflow-hidden">
          <SectionHead icon={BarChart2} iconClass="text-blue-400" title="Kampanya Bazlı (UTM)" badge={`${utmStats.length} kampanya`} extra="Google Ads · Meta · TikTok" />
          <div className="divide-y divide-slate-800/60">
            {utmStats.map(camp => (
              <div key={camp.campaign}
                onClick={() => setDrillDown({
                  title: `Kampanya: ${camp.campaign}`,
                  subtitle: `${[camp.source, camp.medium].filter(Boolean).join(' / ')} · ${camp.vids.size} ziyaretçi · ${camp.views} görüntüleme`,
                  products: camp.products,
                  visitors: visitorProfiles.filter(v => camp.vids.has(v.vid)),
                })}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-800/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-semibold truncate">{camp.campaign}</p>
                  <p className="text-[10px] text-slate-500 truncate">{[camp.source, camp.medium].filter(Boolean).join(' / ')}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-bold text-purple-300 tabular-nums">{camp.views}</p>
                    <p className="text-[9px] text-slate-600">görüntüleme</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-emerald-300 tabular-nums">{camp.carts}</p>
                    <p className="text-[9px] text-slate-600">sepet</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-blue-300 tabular-nums">{camp.vids.size}</p>
                    <p className="text-[9px] text-slate-600">ziyaretçi</p>
                  </div>
                  <ArrowRight size={11} className="text-slate-700" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Funnel + Traffic */}
      {visitorProfiles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FunnelWidget stats={funnelStats} />
          <TrafficTable traffic={trafficStats} onSourceClick={src => {
            const prods = Object.values(sourceProductsMap[src] || {}).sort((a, b) => b.views - a.views);
            const vids = new Set(events.filter(ev => parseReferrer(ev.referrer) === src).map(ev => ev.vid));
            setDrillDown({
              title: `${src} kaynağından gelenler`,
              subtitle: `${vids.size} ziyaretçi · ${prods.length} ürün`,
              products: prods,
              visitors: visitorProfiles.filter(v => vids.has(v.vid)),
            });
          }} />
        </div>
      )}

      {/* Visitor grid */}
      {visitorProfiles.length > 0 && (
        <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl overflow-hidden">
          <SectionHead icon={Users} title="Aktif Ziyaretçiler" badge={visitorProfiles.length} extra="Karta tıkla → yolculuğu gör" />
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {visitorProfiles.slice(0, 24).map(profile => (
              <VisitorCard key={profile.vid} profile={profile}
                customerName={customerNames[profile.customer_id]}
                onClick={() => setSelectedVisitor(profile)} />
            ))}
          </div>
          {visitorProfiles.length > 24 && (
            <p className="px-4 pb-3 text-center text-[10px] text-slate-600">+{visitorProfiles.length - 24} daha fazla ziyaretçi</p>
          )}
        </div>
      )}

      {/* Live feed */}
      <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-slate-400" />
            <span className="text-white text-sm font-bold">Canlı Feed</span>
            {events.length > 0 && (
              <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">{events.length} event</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPaused(p => !p)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border transition-colors
                ${paused ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
              {paused ? '▶ Devam Et' : '⏸ Duraklat'}
            </button>
            <button onClick={() => setEvents([])}
              className="p-1.5 bg-slate-800 border border-slate-700 text-slate-400 rounded-lg hover:text-red-400 transition-colors" title="Temizle">
              <Trash2 size={12} />
            </button>
            <button onClick={() => setFeedOpen(o => !o)}
              className="p-1.5 bg-slate-800 border border-slate-700 text-slate-400 rounded-lg hover:text-white transition-colors">
              {feedOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
        </div>
        {feedOpen && (
          <div className="overflow-y-auto max-h-[480px] p-3 space-y-2 custom-scrollbar">
            {events.length === 0
              ? <div className="py-16 text-center space-y-2">
                  <p className="text-slate-500 text-sm font-medium">Henüz event yok</p>
                  <p className="text-slate-600 text-xs">Mağazanıza giriş yapın — hareketler burada anlık görünecek</p>
                </div>
              : events.map(ev => (
                  <EventRow key={ev._uid || `${ev.ts}_${ev.vid}_${ev.event_type}`}
                    ev={ev} isNew={newIds.has(ev._uid)} />
                ))
            }
          </div>
        )}
      </div>

      {/* Empty state when no pixel */}
      {!pixelStatus?.installed && !pixelLoading && events.length === 0 && (
        <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center">
            <Radio size={24} className="text-slate-500" />
          </div>
          <h3 className="text-white font-bold text-base mb-2">Nasıl Çalışır?</h3>
          <div className="text-slate-400 text-sm space-y-2 max-w-sm mx-auto text-left">
            <p>① "Tek Tıkla Kur" butonuna basın → pixel otomatik yüklenir</p>
            <p>② Müşteriler mağazanızı ziyaret ettiğinde hareketler buraya akar</p>
            <p>③ Ürün görüntüleme, sepete ekleme, ödemeye geçme anlık takip edilir</p>
          </div>
        </div>
      )}

      {/* Modals */}
      <JourneyModal profile={selectedVisitor}
        customerName={selectedVisitor && customerNames[selectedVisitor.customer_id]}
        onClose={() => setSelectedVisitor(null)} />
      <DrillDownModal title={drillDown?.title} subtitle={drillDown?.subtitle}
        products={drillDown?.products} visitors={drillDown?.visitors}
        onClose={() => setDrillDown(null)} />
    </div>
  );
}
