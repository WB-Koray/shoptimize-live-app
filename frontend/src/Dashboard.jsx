import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Activity, Eye, ShoppingCart, Search, CreditCard, Package,
  Layers, CheckCircle, WifiOff, Zap, RefreshCw, Trash2,
  Radio, Users, ChevronDown, ChevronUp, TrendingUp,
  Smartphone, Monitor, Tablet, Globe, X, ArrowRight, BarChart2, LogOut,
  MessageCircle, Save, Send, ToggleLeft, ToggleRight, Key, Hash,
  Clock, Phone, FileText, XCircle, AlertCircle,
  ShoppingBag, Ban, UserX, Plus, Minus,
} from 'lucide-react';
import { ThemeSwitch } from './ThemeContext';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';
const MAX_EVENTS = 500;

// ── Constants ────────────────────────────────────────────────────────────────

const EVENT_META = {
  page_viewed:        { label: 'Page Viewed',       icon: Eye,          color: 'blue'    },
  product_viewed:     { label: 'Product Viewed',    icon: Package,      color: 'purple'  },
  collection_viewed:  { label: 'Collection Viewed', icon: Layers,       color: 'teal'    },
  cart_viewed:        { label: 'Cart Viewed',       icon: ShoppingCart, color: 'orange'  },
  add_to_cart:        { label: 'Added to Cart',     icon: ShoppingCart, color: 'emerald' },
  checkout_started:   { label: 'Checkout Started',  icon: CreditCard,   color: 'yellow'  },
  checkout_completed: { label: 'Order Completed',   icon: CheckCircle,  color: 'emerald' },
  search_submitted:   { label: 'Search Submitted',  icon: Search,       color: 'slate'   },
};

// Token tabanlı renk eşlemeleri — tema değişince otomatik güncellenir
const CM = {
  blue:    { bg: 'bg-blueSoft',   text: 'text-blue',    dot: 'bg-blue'    },
  purple:  { bg: 'bg-purpleSoft', text: 'text-purple',  dot: 'bg-purple'  },
  teal:    { bg: 'bg-tealSoft',   text: 'text-teal',    dot: 'bg-teal'    },
  orange:  { bg: 'bg-amberSoft',  text: 'text-amber',   dot: 'bg-amber'   },
  emerald: { bg: 'bg-greenSoft',  text: 'text-green',   dot: 'bg-green'   },
  yellow:  { bg: 'bg-amberSoft',  text: 'text-amber',   dot: 'bg-amber'   },
  slate:   { bg: 'bg-surfaceAlt', text: 'text-textDim', dot: 'bg-textDim' },
};

const STAGE_META = {
  browsing:  { label: 'Browsing',         color: 'slate'   },
  product:   { label: 'Viewing Product',  color: 'purple'  },
  cart:      { label: 'In Cart',          color: 'orange'  },
  checkout:  { label: 'Checkout',         color: 'yellow'  },
  converted: { label: 'Purchased',        color: 'emerald' },
};

const SRC_COLORS = {
  'Search':   'text-blue',
  'Facebook': 'text-blue',
  'Instagram':'text-rose',
  'TikTok':   'text-textDim',
  'YouTube':  'text-rose',
  'Twitter/X':'text-blue',
  'Direct':   'text-green',
  'Other':    'text-textDim',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtUrl(url) {
  try { return new URL(url).pathname || '/'; } catch { return url || '/'; }
}
function shortVid(vid) { return 'vis_' + (vid || '').slice(-6); }
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
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
  if (!ref) return 'Direct';
  try {
    const h = new URL(ref).hostname.toLowerCase();
    if (/google\.|bing\.|yahoo\.|yandex\./.test(h)) return 'Search';
    if (/facebook\.com|fb\.com/.test(h)) return 'Facebook';
    if (/instagram\.com/.test(h)) return 'Instagram';
    if (/tiktok\.com/.test(h)) return 'TikTok';
    if (/twitter\.com|t\.co|x\.com/.test(h)) return 'Twitter/X';
    if (/youtube\.com/.test(h)) return 'YouTube';
    if (/pinterest\.com/.test(h)) return 'Pinterest';
    return 'Other';
  } catch { return 'Other'; }
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color = 'blue', pulse, onClick }) {
  const c = CM[color] || CM.blue;
  return (
    <div onClick={onClick}
      className={`bg-surface border border-border rounded-xl p-3 flex items-center gap-3 transition-colors
        ${onClick ? 'cursor-pointer hover:border-[#5A4535]' : ''}`}>
      <div className={`p-2 rounded-lg ${c.bg} shrink-0 relative`}>
        <Icon size={16} className={c.text} />
        {pulse && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green animate-ping" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-textDim text-[10px] uppercase font-bold tracking-wide truncate">{label}</p>
        <p className={`text-lg font-bold leading-tight tabular-nums ${pulse ? c.text : 'text-text'}`}>{value}</p>
      </div>
      {onClick && <ArrowRight size={12} className="text-textMute shrink-0" />}
    </div>
  );
}

// ── ProductCard ───────────────────────────────────────────────────────────────

function ProductCard({ product, flash }) {
  return (
    <div className={`bg-surfaceSoft border rounded-xl overflow-hidden transition-all duration-300
      ${flash ? 'border-purple/50 shadow-lg' : 'border-border'}`}>
      <div className="relative aspect-square bg-surface overflow-hidden">
        {product.image
          ? <img src={product.image} alt={product.title} className="w-full h-full object-contain p-2"
              onError={e => { e.target.style.display = 'none'; }} />
          : <div className="w-full h-full flex items-center justify-center">
              <Package size={24} className="text-textMute" />
            </div>
        }
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-bg/80 backdrop-blur-sm px-2 py-0.5 rounded-full">
          <Eye size={10} className="text-purple" />
          <span className={`text-xs font-bold tabular-nums ${flash ? 'text-purple' : 'text-text'}`}>{product.views}</span>
        </div>
      </div>
      <div className="p-2.5 space-y-1.5">
        <p className="text-text text-[11px] font-semibold leading-tight line-clamp-2" title={product.title}>{product.title}</p>
        {product.price && (
          <p className="text-green text-[11px] font-bold tabular-nums">
            {parseFloat(product.price).toLocaleString('tr-TR')} ₺
          </p>
        )}
        <div className="flex items-center gap-1 pt-1 border-t border-border">
          <Eye size={9} className="text-purple" />
          <span className="text-[9px] text-textDim">Views</span>
          <span className="text-[9px] font-bold text-purple ml-auto tabular-nums">{product.views}</span>
        </div>
        <div className="flex items-center gap-1">
          <ShoppingCart size={9} className="text-green" />
          <span className="text-[9px] text-textDim">Add to Cart</span>
          <span className="text-[9px] font-bold text-green ml-auto tabular-nums">{product.carts}</span>
        </div>
        {product.views > 0 && product.carts > 0 && (
          <div className="text-center">
            <span className="text-[9px] font-bold text-amber bg-amberSoft px-2 py-0.5 rounded-full">
              {((product.carts / product.views) * 100).toFixed(0)}% conversion
            </span>
          </div>
        )}
        {product.vendor && <p className="text-[9px] text-textMute truncate">{product.vendor}</p>}
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
      className={`bg-surfaceSoft border rounded-xl p-3 cursor-pointer hover:border-[#5A4535] transition-all space-y-2
        ${inactive ? 'border-border/40 opacity-50' : 'border-border'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <DevIcon size={11} className="text-textMute" />
          <span className="text-[10px] text-textDim font-mono">{shortVid(profile.vid)}</span>
        </div>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>{sm.label}</span>
      </div>
      {fullName
        ? <p className="text-[10px] text-green font-semibold truncate">{fullName}</p>
        : profile.customer_id
          ? <p className="text-[9px] text-green/60 font-mono truncate">Member #{profile.customer_id}</p>
          : null
      }
      {profile.lastProduct && (
        <p className="text-[10px] text-text/70 truncate" title={profile.lastProduct}>{profile.lastProduct}</p>
      )}
      {profile.utm?.utm_campaign && (
        <p className="text-[9px] text-blue truncate">{profile.utm.utm_source || 'utm'} / {profile.utm.utm_campaign}</p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-textMute">{profile.referrer}</span>
        <span className="text-[9px] text-textMute">{timeAgo(profile.lastTs)}</span>
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
      ${isNew ? 'border-green/40 bg-greenSoft/50 event-enter' : 'border-border/60 bg-surfaceSoft'}`}>
      <div className={`p-1.5 rounded-lg ${c.bg} shrink-0 mt-0.5`}>
        <Icon size={14} className={c.text} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-bold ${c.text}`}>{meta.label}</span>
          {d.order_number && (
            <span className="text-[10px] font-bold text-green bg-greenSoft border border-green/20 px-1.5 py-0.5 rounded-full">
              #{d.order_number}
            </span>
          )}
          {d.total_price && (
            <span className="text-[10px] font-bold text-green">
              {parseFloat(d.total_price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {d.currency || 'TRY'}
            </span>
          )}
          {d.product_title && !d.order_number && (
            <span className="text-[10px] text-text/80 bg-surfaceAlt/60 px-1.5 py-0.5 rounded truncate max-w-[160px]" title={d.product_title}>
              {d.product_title}
            </span>
          )}
          {d.query && <span className="text-[10px] text-text/80 bg-surfaceAlt/60 px-1.5 py-0.5 rounded">"{d.query}"</span>}
          {d.product_price && !d.order_number && (
            <span className="text-[10px] text-green font-bold">{d.product_price} ₺</span>
          )}
        </div>
        {d.line_items?.length > 0 && (
          <p className="text-[9px] text-textMute mt-0.5 truncate">
            {d.line_items.slice(0, 3).map(li => `${li.title} ×${li.quantity}`).join(' · ')}
            {d.line_items.length > 3 ? ` +${d.line_items.length - 3}` : ''}
          </p>
        )}
        {!d.line_items?.length && (
          <p className="text-[10px] text-textMute mt-0.5 truncate">{fmtUrl(ev.url)}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.dot}`} />
          <span className="text-[9px] text-textMute">{shortVid(ev.vid)}</span>
          {ev.customer_id && <span className="text-[9px] text-green">Member #{ev.customer_id}</span>}
          {ev.utm?.utm_campaign && (
            <span className="text-[9px] text-blue bg-blueSoft px-1 rounded">{ev.utm.utm_campaign}</span>
          )}
          <span className="text-[9px] text-textMute">{fmtTime(ev.ts)}</span>
        </div>
      </div>
    </div>
  );
}

// ── FunnelWidget ──────────────────────────────────────────────────────────────

function FunnelWidget({ stats }) {
  const total = stats.total || 1;
  const steps = [
    { label: 'All Visitors',      count: stats.total,     color: 'bg-blue',   pct: 100 },
    { label: 'Viewed Product',    count: stats.product,   color: 'bg-purple', pct: (stats.product / total) * 100 },
    { label: 'Added to Cart',     count: stats.cart,      color: 'bg-amber',  pct: (stats.cart / total) * 100 },
    { label: 'Started Checkout',  count: stats.checkout,  color: 'bg-amber',  pct: (stats.checkout / total) * 100 },
    { label: 'Purchased',         count: stats.converted, color: 'bg-green',  pct: (stats.converted / total) * 100 },
  ];
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <TrendingUp size={15} className="text-blue" />
        <span className="text-text text-sm font-bold">Conversion Funnel</span>
      </div>
      <div className="p-4 space-y-3">
        {steps.map((step, i) => (
          <div key={step.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-textDim">{step.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-text font-bold tabular-nums">{step.count}</span>
                {i > 0 && <span className="text-[10px] text-textMute">({step.pct.toFixed(1)}%)</span>}
              </div>
            </div>
            <div className="h-2 bg-surfaceAlt rounded-full overflow-hidden">
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
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <Globe size={15} className="text-textDim" />
        <span className="text-text text-sm font-bold">Traffic Sources</span>
        <span className="text-[10px] text-textMute ml-auto">Click → see products</span>
      </div>
      <div className="divide-y divide-border/60">
        {traffic.map(({ source, count }) => (
          <div key={source} onClick={() => onSourceClick?.(source)}
            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surfaceAlt/40 transition-colors">
            <span className={`text-xs font-bold w-24 shrink-0 ${SRC_COLORS[source] || 'text-textDim'}`}>{source}</span>
            <div className="flex-1 h-1.5 bg-surfaceAlt rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#8FAECB] to-[#C4A5D4] rounded-full transition-all duration-500"
                style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <span className="text-xs font-bold text-textDim tabular-nums w-5 text-right">{count}</span>
            <span className="text-[10px] text-textMute w-8 text-right">{((count / total) * 100).toFixed(0)}%</span>
            <ArrowRight size={11} className="text-textMute shrink-0" />
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
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <Search size={15} className="text-textDim" />
        <span className="text-text text-sm font-bold">Live Searches</span>
        <span className="text-[10px] bg-surfaceAlt text-textDim px-2 py-0.5 rounded-full ml-auto">{searches.length} terms</span>
      </div>
      <div className="divide-y divide-border/60">
        {searches.map((s, i) => (
          <div key={s.query} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surfaceAlt/40 transition-colors">
            <span className="text-[10px] text-textMute w-4 text-right font-mono">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <span className="text-sm text-text font-medium">"{s.query}"</span>
            </div>
            <div className="w-20 h-1.5 bg-surfaceAlt rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#8FAECB] to-[#C4A5D4] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (s.count / searches[0].count) * 100)}%` }} />
            </div>
            <span className="text-xs font-bold text-textDim w-6 text-right tabular-nums">{s.count}</span>
            <span className="text-[9px] text-textMute w-16 text-right">{timeAgo(s.lastTs)}</span>
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
      <div className="bg-surface border border-[#5A4535] rounded-2xl w-full max-w-lg max-h-[82vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-surfaceAlt/80">
              <DevIcon size={14} className="text-textDim" />
            </div>
            <div>
              {fullName
                ? <><p className="text-green font-bold text-sm">{fullName}</p>
                    <p className="text-textMute text-[10px]">{shortVid(profile.vid)} · {profile.referrer} · {profile.device}</p></>
                : <><p className="text-text font-bold text-sm">{shortVid(profile.vid)}</p>
                    <p className="text-textMute text-[10px]">{profile.referrer} · {profile.device}</p></>
              }
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${c.bg} ${c.text}`}>{sm.label}</span>
            <button onClick={onClose} className="p-1.5 hover:bg-surfaceAlt rounded-lg text-textDim hover:text-text transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/60 text-[10px] text-textMute flex-wrap">
          <span>{profile.events.length} event</span>
          <span>First: {fmtTime(profile.firstTs)}</span>
          <span>Last: {fmtTime(profile.lastTs)}</span>
          <span>{Math.max(0, Math.round((profile.lastTs - profile.firstTs) / 60000))} min</span>
          {profile.customer_id && !fullName && <span className="text-green font-semibold">Member #{profile.customer_id}</span>}
          {customerName?.email && <span className="text-textDim">{customerName.email}</span>}
          {customerName?.orders_count > 0 && <span className="text-amber">{customerName.orders_count} orders</span>}
          {customerName?.total_spent && parseFloat(customerName.total_spent) > 0 && (
            <span className="text-green">{parseFloat(customerName.total_spent).toLocaleString('tr-TR')} ₺</span>
          )}
          {profile.utm?.utm_campaign && (
            <span className="text-blue">{[profile.utm.utm_source, profile.utm.utm_medium, profile.utm.utm_campaign].filter(Boolean).join(' / ')}</span>
          )}
        </div>
        <div className="overflow-y-auto flex-1 p-3 space-y-1 custom-scrollbar">
          {[...profile.events].reverse().map((ev, i) => {
            const meta = EVENT_META[ev.event_type] || { label: ev.event_type, color: 'slate', icon: Activity };
            const ec = CM[meta.color] || CM.slate;
            const Icon = meta.icon;
            return (
              <div key={i} className="flex items-start gap-3 px-2 py-1.5 rounded-lg hover:bg-surfaceAlt/40">
                <div className={`p-1 rounded-md ${ec.bg} shrink-0 mt-0.5`}><Icon size={11} className={ec.text} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold ${ec.text}`}>{meta.label}</span>
                    {ev.data?.product_title && <span className="text-[10px] text-text/70 truncate max-w-[160px]">{ev.data.product_title}</span>}
                    {ev.data?.query && <span className="text-[10px] text-text/70">"{ev.data.query}"</span>}
                  </div>
                  <p className="text-[9px] text-textMute truncate">{fmtUrl(ev.url)}</p>
                </div>
                <span className="text-[9px] text-textMute shrink-0">{fmtTime(ev.ts)}</span>
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
      <div className="bg-surface border border-[#5A4535] rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <p className="text-text font-bold text-sm">{title}</p>
            {subtitle && <p className="text-textMute text-[10px] mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surfaceAlt rounded-lg text-textDim hover:text-text transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-3 space-y-1 custom-scrollbar">
          {products?.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-textMute uppercase font-bold px-2 mb-1">Viewed Products ({products.length})</p>
              {products.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surfaceAlt/40 transition-colors">
                  <span className="text-[10px] text-textMute w-4 text-right font-mono">{i + 1}</span>
                  {p.image && <img src={p.image} alt={p.title} className="w-8 h-8 rounded object-cover shrink-0"
                    onError={e => { e.target.style.display = 'none'; }} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text font-medium truncate">{p.title}</p>
                    {p.price && <p className="text-[10px] text-green">{parseFloat(p.price).toLocaleString('tr-TR')} ₺</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-purple tabular-nums">{p.views}</p>
                    <p className="text-[9px] text-textMute">views</p>
                  </div>
                  {p.carts > 0 && (
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-green tabular-nums">{p.carts}</p>
                      <p className="text-[9px] text-textMute">cart</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {visitors?.length > 0 && (
            <div>
              <p className="text-[10px] text-textMute uppercase font-bold px-2 mb-1">Visitors ({visitors.length})</p>
              {visitors.slice(0, 30).map((v, i) => {
                const sm2 = STAGE_META[v.stage] || STAGE_META.browsing;
                const c2 = CM[sm2.color] || CM.slate;
                return (
                  <div key={i} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-surfaceAlt/40 transition-colors">
                    <span className="text-[9px] font-mono text-textMute w-16">{shortVid(v.vid)}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${c2.bg} ${c2.text} shrink-0`}>{sm2.label}</span>
                    {v.lastProduct && <span className="text-[10px] text-text/60 flex-1 truncate">{v.lastProduct}</span>}
                    <span className="text-[9px] text-textMute shrink-0">{timeAgo(v.lastTs)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {!products?.length && !visitors?.length && (
            <div className="py-8 text-center text-textMute text-sm">No data</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Section header helper ─────────────────────────────────────────────────────

function SectionHead({ icon: Icon, iconClass = 'text-textDim', title, badge, extra }) {
  return (
    <div className="flex items-center gap-2 p-4 border-b border-border">
      <Icon size={15} className={iconClass} />
      <span className="text-text text-sm font-bold">{title}</span>
      {badge !== undefined && (
        <span className="text-[10px] bg-surfaceAlt text-textDim px-2 py-0.5 rounded-full ml-1">{badge}</span>
      )}
      {extra && <span className="text-[10px] text-textMute ml-auto">{extra}</span>}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

// ── Flow (WA Otomasyon) Panel ─────────────────────────────────────────────────

const DEFAULT_SEQUENCE = [
  { delay_minutes: 15,   template: 'sepet_hatirlatma', enabled: true,  label: 'First reminder' },
  { delay_minutes: 1440, template: 'sepet_hatirlatma', enabled: false, label: 'After 24 hours' },
  { delay_minutes: 2880, template: 'sepet_hatirlatma', enabled: false, label: 'After 48 hours' },
];

function fmtDelay(m) {
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} hr`;
  return `${Math.round(m / 1440)} day`;
}

function FlowPanel({ session }) {
  const { token, username, brand } = session;
  const base = API_URL;
  const qp   = `?username=${encodeURIComponent(username)}&brand=${encodeURIComponent(brand)}`;
  const authH = { Authorization: `Bearer ${token}` };

  const [settings, setSettings] = useState({
    enabled: false, wa_token: '', phone_number_id: '',
    sequence: DEFAULT_SEQUENCE,
    post_order: { enabled: false, template: 'siparis_onay' },
  });
  const [maskedToken, setMasked] = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [saveErr, setSaveErr]   = useState('');

  const [testPhone, setTestPhone]     = useState('');
  const [testTemplate, setTestTmpl]  = useState('sepet_hatirlatma');
  const [testLoading, setTestL]       = useState(false);
  const [testResult, setTestRes]      = useState(null);

  const [logs, setLogs]           = useState([]);
  const [logsLoading, setLogsL]   = useState(false);
  const [logsOpen, setLogsOpen]   = useState(true);

  const [optouts, setOptouts]         = useState([]);
  const [optoutsOpen, setOptoutsOpen] = useState(false);
  const [optoutPhone, setOptoutPhone] = useState('');
  const [removingOptout, setRmOptout] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${base}/api/flow/settings${qp}`, { headers: authH });
      const d = await r.json();
      if (d.ok) {
        const s = d.settings || {};
        setSettings({
          enabled:         s.enabled ?? false,
          wa_token:        '',
          phone_number_id: s.phone_number_id || '',
          sequence:        s.sequence?.length ? s.sequence : DEFAULT_SEQUENCE,
          post_order:      s.post_order || { enabled: false, template: 'siparis_onay' },
        });
        setMasked(s.wa_token_masked || '');
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [username, brand]);

  const fetchLogs = useCallback(async () => {
    setLogsL(true);
    try {
      const r = await fetch(`${base}/api/flow/logs${qp}&limit=100`, { headers: authH });
      const d = await r.json();
      if (d.ok) setLogs(d.logs || []);
    } catch { /* ignore */ }
    setLogsL(false);
  }, [username, brand]);

  const fetchOptouts = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/flow/optouts`, { headers: authH });
      const d = await r.json();
      if (d.ok) setOptouts(d.phones || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchSettings(); fetchLogs(); fetchOptouts(); }, [username, brand]);

  async function handleSave() {
    setSaving(true); setSaved(false); setSaveErr('');
    try {
      const r = await fetch(`${base}/api/flow/settings${qp}`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const d = await r.json();
      if (d.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); await fetchSettings(); }
      else setSaveErr(d.error || 'Save failed');
    } catch { setSaveErr('Server unreachable'); }
    setSaving(false);
  }

  function updateStep(idx, patch) {
    setSettings(s => ({ ...s, sequence: s.sequence.map((st, i) => i === idx ? { ...st, ...patch } : st) }));
  }

  async function handleTest() {
    setTestL(true); setTestRes(null);
    try {
      const r = await fetch(`${base}/api/flow/test${qp}`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone, template: testTemplate }),
      });
      setTestRes(await r.json());
    } catch { setTestRes({ ok: false, error: 'Server unreachable' }); }
    setTestL(false);
  }

  async function handleClearLogs() {
    await fetch(`${base}/api/flow/logs${qp}`, { method: 'DELETE', headers: authH });
    setLogs([]);
  }

  async function handleAddOptout() {
    if (!optoutPhone.trim()) return;
    await fetch(`${base}/api/flow/optout`, {
      method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: optoutPhone.trim() }),
    });
    setOptoutPhone('');
    fetchOptouts();
  }

  async function handleRemoveOptout(phone) {
    setRmOptout(phone);
    await fetch(`${base}/api/flow/optout?phone=${encodeURIComponent(phone)}`, { method: 'DELETE', headers: authH });
    setRmOptout('');
    fetchOptouts();
  }

  if (loading) return <div className="flex items-center justify-center py-32"><RefreshCw size={20} className="text-textMute animate-spin" /></div>;

  const sentCount      = logs.filter(l => l.ok).length;
  const convertedCount = logs.filter(l => l.converted).length;

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-greenSoft border border-green/20">
          <MessageCircle size={16} className="text-green" />
        </div>
        <div className="flex-1">
          <h2 className="text-text font-bold text-sm">WhatsApp Automation</h2>
          <p className="text-textMute text-xs">Cart recovery sequence and order notifications</p>
        </div>
        <button onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
          className="flex items-center gap-1.5 text-sm font-medium transition-colors">
          {settings.enabled
            ? <><ToggleRight size={26} className="text-green" /><span className="text-green text-xs">Active</span></>
            : <><ToggleLeft  size={26} className="text-textMute" /><span className="text-textMute text-xs">Inactive</span></>}
        </button>
      </div>

      {/* Özet istatistikler */}
      {logs.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Sent',    value: sentCount,      color: 'text-green' },
            { label: 'Orders',  value: convertedCount, color: 'text-blue' },
            { label: 'Rate',    value: sentCount ? `${Math.round(convertedCount / sentCount * 100)}%` : '—', color: 'text-purple' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-surface border border-border rounded-xl p-3 text-center">
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-textMute text-[10px]">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Bağlantı ayarları */}
      <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
        <p className="text-textDim font-semibold text-xs uppercase tracking-wide">Connection</p>

        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-textMute uppercase tracking-wide">WhatsApp Token</label>
          <div className="relative">
            <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMute" />
            <input type="password" value={settings.wa_token} onChange={e => setSettings(s => ({ ...s, wa_token: e.target.value }))}
              placeholder={maskedToken || 'EAAxxxxxxx…'}
              className="w-full bg-surfaceAlt border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text placeholder:text-textMute focus:outline-none focus:border-green/60 transition-colors" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold text-textMute uppercase tracking-wide">Phone Number ID</label>
          <div className="relative">
            <Hash size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMute" />
            <input value={settings.phone_number_id} onChange={e => setSettings(s => ({ ...s, phone_number_id: e.target.value }))}
              placeholder="123456789012345"
              className="w-full bg-surfaceAlt border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text placeholder:text-textMute focus:outline-none focus:border-green/60 transition-colors" />
          </div>
        </div>
      </div>

      {/* Sequence */}
      <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-textDim font-semibold text-xs uppercase tracking-wide">Cart Reminder Sequence</p>
          <p className="text-textMute text-[10px] mt-0.5">Sequence stops automatically when order is placed</p>
        </div>
        {settings.sequence.map((step, idx) => (
          <div key={idx} className={`rounded-xl border p-3 space-y-2 ${step.enabled ? 'border-green/30 bg-greenSoft/20' : 'border-border bg-surfaceAlt/30'}`}>
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${step.enabled ? 'bg-greenSoft text-green' : 'bg-surfaceAlt text-textMute'}`}>
                {idx + 1}
              </div>
              <input value={step.label} onChange={e => updateStep(idx, { label: e.target.value })}
                className="flex-1 bg-transparent text-sm font-medium text-text focus:outline-none" />
              <button onClick={() => updateStep(idx, { enabled: !step.enabled })}>
                {step.enabled ? <ToggleRight size={22} className="text-green" /> : <ToggleLeft size={22} className="text-textMute" />}
              </button>
            </div>
            {step.enabled && (
              <div className="grid grid-cols-2 gap-2 pl-7">
                <div>
                  <p className="text-[10px] text-textMute mb-1">Delay</p>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={5} max={43200} value={step.delay_minutes}
                      onChange={e => updateStep(idx, { delay_minutes: parseInt(e.target.value) || 15 })}
                      className="w-16 bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text text-center focus:outline-none focus:border-green/60" />
                    <span className="text-textMute text-[10px]">min · {fmtDelay(step.delay_minutes)}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-textMute mb-1">Template name</p>
                  <input value={step.template} onChange={e => updateStep(idx, { template: e.target.value })}
                    className="w-full bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text font-mono focus:outline-none focus:border-green/60" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Sipariş onayı */}
      <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingBag size={13} className="text-blue shrink-0" />
          <div className="flex-1">
            <p className="text-text font-semibold text-sm">Order Confirmation WA</p>
            <p className="text-textMute text-[10px]">Auto-send when order is completed</p>
          </div>
          <button onClick={() => setSettings(s => ({ ...s, post_order: { ...s.post_order, enabled: !s.post_order.enabled } }))}>
            {settings.post_order?.enabled ? <ToggleRight size={22} className="text-green" /> : <ToggleLeft size={22} className="text-textMute" />}
          </button>
        </div>
        {settings.post_order?.enabled && (
          <div className="pl-5 space-y-1">
            <p className="text-[10px] text-textMute">Template name</p>
            <input value={settings.post_order.template || 'siparis_onay'}
              onChange={e => setSettings(s => ({ ...s, post_order: { ...s.post_order, template: e.target.value } }))}
              className="w-full bg-surfaceAlt border border-border rounded-lg px-3 py-1.5 text-xs text-text font-mono focus:outline-none focus:border-green/60" />
          </div>
        )}
      </div>

      {/* Kaydet */}
      {saveErr && (
        <div className="flex items-center gap-2 bg-roseSoft border border-rose/20 rounded-xl px-4 py-2.5 text-sm text-rose">
          <AlertCircle size={13} className="shrink-0" />{saveErr}
        </div>
      )}
      <button onClick={handleSave} disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm bg-green hover:bg-green/90 text-bg transition-colors disabled:opacity-50">
        {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
        {saved ? 'Saved ✓' : saving ? 'Saving...' : 'Save'}
      </button>

      {/* Test */}
      <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
        <h3 className="text-text font-semibold text-sm flex items-center gap-2"><Send size={13} className="text-green" />Test Message</h3>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMute" />
            <input type="tel" value={testPhone} onChange={e => setTestPhone(e.target.value)}
              placeholder="+905551234567" onKeyDown={e => e.key === 'Enter' && handleTest()}
              className="w-full bg-surfaceAlt border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text placeholder:text-textMute focus:outline-none focus:border-green/60 transition-colors" />
          </div>
          <select value={testTemplate} onChange={e => setTestTmpl(e.target.value)}
            className="bg-surfaceAlt border border-border rounded-xl px-2 text-xs text-text focus:outline-none shrink-0">
            <option value="sepet_hatirlatma">sepet_hatirlatma</option>
            <option value="siparis_onay">siparis_onay</option>
          </select>
          <button onClick={handleTest} disabled={testLoading || !testPhone.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-semibold text-sm bg-green hover:bg-green/90 text-bg transition-colors disabled:opacity-50 shrink-0">
            {testLoading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />} Send
          </button>
        </div>
        {testResult && (
          <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm border ${testResult.ok ? 'bg-greenSoft border-green/20 text-green' : 'bg-roseSoft border-rose/20 text-rose'}`}>
            {testResult.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {testResult.ok ? `Sent — ID: ${testResult.message_id}` : (testResult.error || 'Failed')}
          </div>
        )}
      </div>

      {/* Gönderim Geçmişi */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <FileText size={13} className="text-textDim" />
          <span className="text-text font-semibold text-sm flex-1">Send History</span>
          <span className="text-textMute text-xs">{logs.length} records</span>
          <button onClick={fetchLogs} disabled={logsLoading}
            className="p-1.5 rounded-lg bg-surfaceAlt border border-border text-textDim hover:text-text transition-colors disabled:opacity-50">
            <RefreshCw size={11} className={logsLoading ? 'animate-spin' : ''} />
          </button>
          <button onClick={handleClearLogs} disabled={logs.length === 0}
            className="p-1.5 rounded-lg bg-surfaceAlt border border-border text-textDim hover:text-rose transition-colors disabled:opacity-50">
            <Trash2 size={11} />
          </button>
          <button onClick={() => setLogsOpen(o => !o)}
            className="p-1.5 rounded-lg bg-surfaceAlt border border-border text-textDim hover:text-text transition-colors">
            {logsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
        {logsOpen && (
          <div className="overflow-y-auto max-h-80 p-3 space-y-2 custom-scrollbar">
            {logs.length === 0 ? (
              <div className="py-10 text-center">
                <MessageCircle size={18} className="text-textMute mx-auto mb-2" />
                <p className="text-textMute text-sm">No sends yet</p>
              </div>
            ) : logs.map((entry, i) => (
              <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border text-sm ${entry.ok ? 'bg-greenSoft/30 border-green/20' : 'bg-roseSoft border-rose/20'}`}>
                <div className="mt-0.5 shrink-0">{entry.ok ? <CheckCircle size={13} className="text-green" /> : <XCircle size={13} className="text-rose" />}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-text font-medium text-xs">{entry.name || 'Customer'}</span>
                    <span className="text-textMute text-[10px]">{entry.phone}</span>
                    {entry.product && <span className="text-textMute text-[10px] truncate max-w-[130px]">{entry.product}</span>}
                    {entry.step_label && <span className="text-[9px] bg-surfaceAlt text-textDim px-1.5 py-0.5 rounded-full">{entry.step_label}</span>}
                    {entry.converted && <span className="text-[9px] bg-greenSoft text-green px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><ShoppingBag size={8} />Order</span>}
                  </div>
                  {entry.error && <p className="text-rose text-[10px] mt-0.5">{entry.error}</p>}
                </div>
                <span className="text-textMute text-[10px] whitespace-nowrap shrink-0">
                  {new Date(entry.ts).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Opt-out listesi */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Ban size={13} className="text-textDim" />
          <span className="text-text font-semibold text-sm flex-1">
            Opt-out {optouts.length > 0 && <span className="text-textMute font-normal text-xs ml-1">({optouts.length})</span>}
          </span>
          <button onClick={() => { setOptoutsOpen(o => !o); if (!optoutsOpen) fetchOptouts(); }}
            className="p-1.5 rounded-lg bg-surfaceAlt border border-border text-textDim hover:text-text transition-colors">
            {optoutsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
        {optoutsOpen && (
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-textMute">Customers who reply "stop / opt-out" are added automatically.</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <UserX size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMute" />
                <input type="tel" value={optoutPhone} onChange={e => setOptoutPhone(e.target.value)}
                  placeholder="+905551234567" onKeyDown={e => e.key === 'Enter' && handleAddOptout()}
                  className="w-full bg-surfaceAlt border border-border rounded-xl pl-8 pr-4 py-2 text-sm text-text placeholder:text-textMute focus:outline-none focus:border-rose/40 transition-colors" />
              </div>
              <button onClick={handleAddOptout} disabled={!optoutPhone.trim()}
                className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs bg-roseSoft border border-rose/20 text-rose hover:bg-rose/20 transition-colors disabled:opacity-40 shrink-0">
                <Plus size={12} /> Add
              </button>
            </div>
            {optouts.length === 0
              ? <p className="text-textMute text-xs text-center py-3">Empty list</p>
              : <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
                  {optouts.map(phone => (
                    <div key={phone} className="flex items-center gap-2 px-3 py-1.5 bg-roseSoft/50 border border-rose/15 rounded-lg">
                      <span className="text-xs text-rose flex-1 font-mono">{phone}</span>
                      <button onClick={() => handleRemoveOptout(phone)} disabled={removingOptout === phone}
                        className="text-textMute hover:text-rose transition-colors disabled:opacity-40">
                        {removingOptout === phone ? <RefreshCw size={11} className="animate-spin" /> : <Minus size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
            }
          </div>
        )}
      </div>

    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({ session, onLogout }) {
  const { token, username, brand, tid } = session;
  const qs = `username=${encodeURIComponent(username)}&brand=${encodeURIComponent(brand)}`;

  const [activeView, setActiveView] = useState('live');
  const [events, setEvents]           = useState([]);
  const [sseStatus, setSseStatus]     = useState('connecting');
  const [paused, setPaused]           = useState(false);
  const [feedOpen, setFeedOpen]       = useState(true);
  const [newIds, setNewIds]           = useState(new Set());
  const [flashProducts, setFlashProducts] = useState(new Set());

  const [selectedVisitor, setSelectedVisitor] = useState(null);
  const [drillDown, setDrillDown]             = useState(null);
  const [customerNames, setCustomerNames]     = useState({});

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
    if (!confirm('Pixel will be removed and tracking will stop. Are you sure?')) return;
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

  const statusBadge = sseStatus === 'connected'
    ? 'bg-greenSoft border-green/30 text-green'
    : sseStatus === 'connecting'
    ? 'bg-amberSoft border-amber/30 text-amber'
    : 'bg-surfaceSoft border-border text-textMute';

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-bg p-4">
    <div className="max-w-5xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-greenSoft border border-green/20">
            <Radio size={20} className="text-green" />
          </div>
          <div>
            <h1 className="text-text font-bold text-base">Shoptimize Live</h1>
            <p className="text-textMute text-xs">{username} / {brand}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${statusBadge}`}>
            {sseStatus === 'connected'
              ? <><span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" /> Live</>
              : sseStatus === 'connecting'
              ? <><span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" /> Connecting...</>
              : <><WifiOff size={12} /> Disconnected</>}
          </div>
          {/* View switcher */}
          <div className="flex items-center gap-1 bg-surfaceAlt border border-border rounded-lg p-0.5">
            <button onClick={() => setActiveView('live')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${activeView === 'live' ? 'bg-surface text-text shadow-sm' : 'text-textMute hover:text-text'}`}>
              <Radio size={11} /> Live
            </button>
            <button onClick={() => setActiveView('flow')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${activeView === 'flow' ? 'bg-surface text-text shadow-sm' : 'text-textMute hover:text-text'}`}>
              <MessageCircle size={11} /> WA Automation
            </button>
          </div>
          <ThemeSwitch />
          <button onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surfaceAlt border border-[#5A4535] text-textDim text-xs font-bold rounded-full hover:text-text transition-colors">
            <LogOut size={12} /> Logout
          </button>
        </div>
      </div>

      {/* WA Otomasyon view */}
      {activeView === 'flow' && <FlowPanel session={session} />}

      {activeView === 'live' && <>

      {/* Pixel panel */}
      <div className={`rounded-xl border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3
        ${pixelStatus?.installed ? 'bg-greenSoft/50 border-green/20' : 'bg-surfaceAlt/50 border-[#5A4535]'}`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${pixelStatus?.installed ? 'bg-greenSoft' : 'bg-surfaceAlt/40'}`}>
            <Zap size={16} className={pixelStatus?.installed ? 'text-green' : 'text-textDim'} />
          </div>
          <div>
            <p className={`text-sm font-bold ${pixelStatus?.installed ? 'text-green' : 'text-text'}`}>
              {pixelStatus?.installed ? 'Storefront Pixel Installed' : 'Storefront Pixel Not Installed'}
            </p>
            <p className="text-textMute text-[10px]">
              {pixelStatus?.installed
                ? `Tracking ID: ${pixelStatus.tracking_id || '—'}`
                : 'Install the pixel to track visitor activity'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pixelStatus?.installed && (
            <button onClick={handleRegisterWebhook} disabled={webhookLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors disabled:opacity-50
                ${webhookStatus?.registered
                  ? 'bg-greenSoft border-green/20 text-green'
                  : 'bg-blueSoft border-blue/20 text-blue hover:bg-blueSoft/80'}`}>
              {webhookLoading ? <><RefreshCw size={11} className="animate-spin" /> Installing...</>
                : webhookStatus?.registered ? <><CheckCircle size={11} /> Order Tracking Active</>
                : <><Zap size={11} /> Set Up Order Tracking</>}
            </button>
          )}
          {pixelStatus?.installed
            ? <button onClick={handleUninstall} disabled={installing || pixelLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-roseSoft border border-rose/20 text-rose text-xs font-bold rounded-lg hover:bg-roseSoft/80 transition-colors disabled:opacity-50">
                <Trash2 size={12} /> Remove
              </button>
            : <button onClick={handleInstall} disabled={installing || pixelLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[#5A8A4A] to-[#3E8D7A] text-text text-xs font-bold rounded-lg hover:from-[#7AAA5A] hover:to-[#5AAE9A] transition-all disabled:opacity-50 shadow-lg">
                {installing ? <><RefreshCw size={12} className="animate-spin" /> Installing...</> : <><Zap size={12} /> One-Click Install</>}
              </button>
          }
        </div>
      </div>

      {/* 7 stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatCard label="Total Events" value={events.length} icon={Activity} color="blue" pulse={sseStatus === 'connected'}
          onClick={() => setDrillDown({ title: 'All Events', subtitle: `${events.length} events`, products: productStats.slice(0, 20), visitors: visitorProfiles })} />
        <StatCard label="Unique Visitors" value={uniqueVisitorCount} icon={Users} color="purple"
          onClick={() => setDrillDown({ title: 'Unique Visitors', subtitle: `${uniqueVisitorCount} visitors`, products: productStats.slice(0, 20), visitors: visitorProfiles })} />
        <StatCard label="Active Members" value={memberCount} icon={CheckCircle} color="teal"
          onClick={() => setDrillDown({ title: 'Logged-In Members', subtitle: `${memberCount} members`,
            products: productStats.filter(p => events.some(ev => ev.event_type === 'product_viewed' && visitorProfiles.find(v => v.vid === ev.vid && v.customer_id) && (ev.data?.product_id === p.key || ev.data?.product_title === p.key))),
            visitors: visitorProfiles.filter(v => v.customer_id) })} />
        <StatCard label="Add to Cart" value={evStats['add_to_cart'] || 0} icon={ShoppingCart} color="emerald"
          onClick={() => setDrillDown({ title: 'Products Added to Cart', subtitle: `${evStats['add_to_cart'] || 0} cart events`,
            products: productStats.filter(p => p.carts > 0).sort((a, b) => b.carts - a.carts),
            visitors: visitorProfiles.filter(v => ['cart','checkout','converted'].includes(v.stage)) })} />
        <StatCard label="Checkout Started" value={evStats['checkout_started'] || 0} icon={CreditCard} color="yellow"
          onClick={() => setDrillDown({ title: 'Visitors Who Started Checkout', subtitle: `${evStats['checkout_started'] || 0} checkout events`,
            products: productStats.slice(0, 20),
            visitors: visitorProfiles.filter(v => ['checkout','converted'].includes(v.stage)) })} />
        <StatCard label="Completed" value={evStats['checkout_completed'] || 0} icon={CheckCircle} color="emerald"
          onClick={() => setDrillDown({ title: 'Completed Orders', subtitle: `${evStats['checkout_completed'] || 0} orders`,
            products: [], visitors: visitorProfiles.filter(v => v.stage === 'converted') })} />
        <StatCard label="Abandoned Checkout" value={abandonedVisitors.length} icon={CreditCard} color="orange"
          onClick={() => setDrillDown({ title: 'Abandoned Checkouts', subtitle: 'Started checkout, did not complete (15+ min)',
            products: productStats.filter(p => abandonedVisitors.some(v => v.events.some(ev => ev.event_type === 'product_viewed' && (ev.data?.product_id === p.key || ev.data?.product_title === p.key)))),
            visitors: abandonedVisitors })} />
      </div>

      {/* Abandoned checkout alert */}
      {abandonedVisitors.length > 0 && (
        <div className="bg-amberSoft/50 border border-amber/20 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CreditCard size={15} className="text-amber" />
            <span className="text-amber text-sm font-bold">Abandoned Checkouts</span>
            <span className="text-[10px] bg-amberSoft text-amber px-2 py-0.5 rounded-full">
              {abandonedVisitors.length} visitors started checkout but did not complete
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {abandonedVisitors.slice(0, 6).map(profile => {
              const cn = customerNames[profile.customer_id];
              const name = cn ? [cn.first_name, cn.last_name].filter(Boolean).join(' ') : null;
              return (
                <div key={profile.vid} onClick={() => setSelectedVisitor(profile)}
                  className="flex items-center gap-3 bg-surfaceSoft border border-amber/20 rounded-lg p-3 cursor-pointer hover:border-amber/40 transition-colors">
                  <div className="p-1.5 rounded-lg bg-amberSoft shrink-0"><CreditCard size={13} className="text-amber" /></div>
                  <div className="flex-1 min-w-0">
                    {name ? <p className="text-xs font-bold text-green truncate">{name}</p>
                      : <p className="text-xs font-mono text-textDim">{shortVid(profile.vid)}</p>}
                    {profile.lastProduct && <p className="text-[10px] text-text/60 truncate">{profile.lastProduct}</p>}
                  </div>
                  <span className="text-[9px] text-amber shrink-0">{timeAgo(profile.lastTs)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Product grid */}
      {productStats.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <SectionHead icon={TrendingUp} iconClass="text-purple" title="Most Viewed Products" badge={`${productStats.length} products`} />
          <div className="p-4 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {productStats.map(p => <ProductCard key={p.key} product={p} flash={flashProducts.has(p.key)} />)}
          </div>
        </div>
      )}

      {/* Collections */}
      {collectionStats.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <SectionHead icon={Layers} iconClass="text-teal" title="Most Viewed Collections" badge={`${collectionStats.length} collections`} />
          <div className="divide-y divide-border/60">
            {collectionStats.map((col, i) => (
              <div key={col.handle} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surfaceAlt/40 transition-colors">
                <span className="text-[10px] text-textMute w-4 text-right font-mono">{i + 1}</span>
                <span className="flex-1 text-sm text-text font-medium">{col.handle}</span>
                <div className="w-24 h-1.5 bg-surfaceAlt rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#6DC4B0] to-[#8FAECB] rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (col.count / collectionStats[0].count) * 100)}%` }} />
                </div>
                <span className="text-xs font-bold text-textDim w-6 text-right tabular-nums">{col.count}</span>
                <span className="text-[9px] text-textMute w-16 text-right">{timeAgo(col.lastTs)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 404 pages */}
      {notFoundStats.length > 0 && (
        <div className="bg-roseSoft/50 border border-rose/20 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b border-rose/15">
            <span className="text-sm font-bold text-rose">404</span>
            <span className="text-text text-sm font-bold">Not Found Pages</span>
            <span className="text-[10px] bg-roseSoft text-rose px-2 py-0.5 rounded-full ml-auto">{notFoundStats.length} URL</span>
          </div>
          <div className="divide-y divide-rose/10">
            {notFoundStats.map((item, i) => (
              <div key={item.path} className="flex items-center gap-3 px-4 py-2.5 hover:bg-roseSoft/30 transition-colors">
                <span className="text-[10px] text-textMute w-4 text-right font-mono shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text font-mono truncate" title={item.url}>{item.path}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-bold text-rose tabular-nums">{item.vids.size}</p>
                    <p className="text-[9px] text-textMute">unique</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-textDim tabular-nums">{item.count}</p>
                    <p className="text-[9px] text-textMute">hits</p>
                  </div>
                  <span className="text-[9px] text-textMute w-16 text-right">{timeAgo(item.lastTs)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Page stats */}
      {pageStats.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <SectionHead icon={Eye} title="Page Statistics" badge={`${pageStats.length} pages`} extra="Blog, content and other pages" />
          <div className="divide-y divide-border/60">
            {pageStats.map((page, i) => (
              <div key={page.path} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surfaceAlt/40 transition-colors">
                <span className="text-[10px] text-textMute w-4 text-right font-mono shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text font-medium truncate" title={page.title}>{page.title}</p>
                  <p className="text-[10px] text-textMute font-mono truncate">{page.path}</p>
                </div>
                <div className="w-20 h-1.5 bg-surfaceAlt rounded-full overflow-hidden shrink-0">
                  <div className="h-full bg-gradient-to-r from-[#8FAECB] to-[#C4A5D4] rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (page.vids.size / (pageStats[0]?.vids.size || 1)) * 100)}%` }} />
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-bold text-purple tabular-nums">{page.vids.size}</p>
                    <p className="text-[9px] text-textMute">unique</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-textDim tabular-nums">{page.count}</p>
                    <p className="text-[9px] text-textMute">views</p>
                  </div>
                  <span className="text-[9px] text-textMute w-16 text-right">{timeAgo(page.lastTs)}</span>
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
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <SectionHead icon={BarChart2} iconClass="text-blue" title="Campaign Based (UTM)" badge={`${utmStats.length} campaigns`} extra="Google Ads · Meta · TikTok" />
          <div className="divide-y divide-border/60">
            {utmStats.map(camp => (
              <div key={camp.campaign}
                onClick={() => setDrillDown({
                  title: `Campaign: ${camp.campaign}`,
                  subtitle: `${[camp.source, camp.medium].filter(Boolean).join(' / ')} · ${camp.vids.size} visitors · ${camp.views} views`,
                  products: camp.products,
                  visitors: visitorProfiles.filter(v => camp.vids.has(v.vid)),
                })}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surfaceAlt/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text font-semibold truncate">{camp.campaign}</p>
                  <p className="text-[10px] text-textMute truncate">{[camp.source, camp.medium].filter(Boolean).join(' / ')}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-bold text-purple tabular-nums">{camp.views}</p>
                    <p className="text-[9px] text-textMute">views</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-green tabular-nums">{camp.carts}</p>
                    <p className="text-[9px] text-textMute">cart</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-blue tabular-nums">{camp.vids.size}</p>
                    <p className="text-[9px] text-textMute">visitors</p>
                  </div>
                  <ArrowRight size={11} className="text-textMute" />
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
              title: `Visitors from ${src}`,
              subtitle: `${vids.size} visitors · ${prods.length} products`,
              products: prods,
              visitors: visitorProfiles.filter(v => vids.has(v.vid)),
            });
          }} />
        </div>
      )}

      {/* Visitor grid */}
      {visitorProfiles.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <SectionHead icon={Users} title="Active Visitors" badge={visitorProfiles.length} extra="Click card → see journey" />
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {visitorProfiles.slice(0, 24).map(profile => (
              <VisitorCard key={profile.vid} profile={profile}
                customerName={customerNames[profile.customer_id]}
                onClick={() => setSelectedVisitor(profile)} />
            ))}
          </div>
          {visitorProfiles.length > 24 && (
            <p className="px-4 pb-3 text-center text-[10px] text-textMute">+{visitorProfiles.length - 24} more visitors</p>
          )}
        </div>
      )}

      {/* Live feed */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-textDim" />
            <span className="text-text text-sm font-bold">Live Feed</span>
            {events.length > 0 && (
              <span className="text-[10px] bg-surfaceAlt text-textDim px-2 py-0.5 rounded-full">{events.length} event</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPaused(p => !p)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border transition-colors
                ${paused ? 'bg-amberSoft border-amber/30 text-amber' : 'bg-surfaceAlt border-[#5A4535] text-textDim hover:text-text'}`}>
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button onClick={() => setEvents([])}
              className="p-1.5 bg-surfaceAlt border border-[#5A4535] text-textDim rounded-lg hover:text-rose transition-colors" title="Clear">
              <Trash2 size={12} />
            </button>
            <button onClick={() => setFeedOpen(o => !o)}
              className="p-1.5 bg-surfaceAlt border border-[#5A4535] text-textDim rounded-lg hover:text-text transition-colors">
              {feedOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
        </div>
        {feedOpen && (
          <div className="overflow-y-auto max-h-[480px] p-3 space-y-2 custom-scrollbar">
            {events.length === 0
              ? <div className="py-16 text-center space-y-2">
                  <p className="text-textMute text-sm font-medium">No events yet</p>
                  <p className="text-textMute text-xs">Visit your store — activity will appear here in real-time</p>
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
        <div className="bg-surface border border-border rounded-2xl p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-surfaceAlt/60 border border-[#5A4535] flex items-center justify-center">
            <Radio size={24} className="text-textMute" />
          </div>
          <h3 className="text-text font-bold text-base mb-2">How It Works</h3>
          <div className="text-textDim text-sm space-y-2 max-w-sm mx-auto text-left">
            <p>① Click "One-Click Install" → pixel is installed automatically</p>
            <p>② When customers visit your store, activity streams here in real-time</p>
            <p>③ Product views, add-to-cart, and checkout events are tracked live</p>
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

      </>}
    </div>
    </div>
  );
}
