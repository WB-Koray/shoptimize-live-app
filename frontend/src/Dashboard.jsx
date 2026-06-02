import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Activity, Eye, ShoppingCart, Search, CreditCard, Package,
  Layers, CheckCircle, WifiOff, Zap, RefreshCw, Trash2,
  Radio, Users, ChevronDown, ChevronUp, TrendingUp,
  Smartphone, Monitor, Tablet, Globe, X, ArrowRight, BarChart2, LogOut,
  MessageCircle, MessageSquare, Save, Send, ToggleLeft, ToggleRight, Key, Hash,
  Clock, Phone, FileText, XCircle, AlertCircle,
  ShoppingBag, Ban, UserX, Plus, Minus, Flame, EyeOff, Settings, ExternalLink,
} from 'lucide-react';
import { ThemeSwitch } from './ThemeContext';
import { useLang, LangSwitch } from './LangContext';
import OnboardingModal from './OnboardingModal';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';
const MAX_EVENTS = 2000;

// ── Anonymization helpers ─────────────────────────────────────────────────────
function maskName(name) {
  if (!name) return name;
  return name.split(' ').map(w => w.length > 0 ? w[0] + '***' : w).join(' ');
}
function maskPhone(phone) {
  if (!phone) return phone;
  if (phone.startsWith('***')) return '***••••';        // flow log kısaltması
  if (phone.startsWith('+')) return phone.slice(0, 4) + '*** ***' + phone.slice(-2);
  return phone.slice(0, 2) + '***';
}
function maskCity(city) {
  if (!city) return city;
  return city[0] + '***';
}
function maskEmail(email) {
  if (!email) return email;
  const [local, domain] = email.split('@');
  return (local[0] || '') + '***@' + (domain || '***');
}

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

// Bilinen Türk fiyat karşılaştırma / marketplace kaynakları
const KNOWN_REFERRER_COLORS = {
  'akakce.com':       'text-amber',
  'n11.com':          'text-amber',
  'hepsiburada.com':  'text-amber',
  'trendyol.com':     'text-amber',
  'gittigidiyor.com': 'text-amber',
  'cimri.com':        'text-amber',
  'incehesap.com':    'text-amber',
  'fiyatbul.com':     'text-amber',
  'idefix.com':       'text-amber',
  'pazarama.com':     'text-amber',
};

function srcColor(source) {
  return SRC_COLORS[source] || KNOWN_REFERRER_COLORS[source] || 'text-purple';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtUrl(url) {
  try { return new URL(url).pathname || '/'; } catch { return url || '/'; }
}
function shortVid(vid) { return 'vis_' + (vid || '').slice(-6); }
function timeAgo(ts, lang = 'en') {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (lang === 'tr') {
    if (s < 60) return `${s}sn önce`;
    if (s < 3600) return `${Math.floor(s / 60)}dk önce`;
    return `${Math.floor(s / 3600)}sa önce`;
  }
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
// ── Purchase Intent Score ────────────────────────────────────────────────────
// Mevcut event verilerinden 0-99 arası satın alma niyet skoru hesaplar.
// 100 = tamamlanmış sipariş (stage: converted)
function calcIntentScore(profile) {
  if (profile.stage === 'converted') return 100;
  const evts = profile.events || [];
  let score = 0;

  // Sahne bazlı taban skor (en baskın sinyal)
  score += { browsing: 5, product: 20, cart: 52, checkout: 80 }[profile.stage] || 5;

  // Geri dönen ziyaretçi → çok daha yüksek niyet
  if (profile.isReturning) score += 12;

  // Benzersiz ürün görüntüleme sayısı (ilgi derinliği)
  const uniqueProds = new Set(
    evts.filter(e => e.event_type === 'product_viewed' && (e.data?.product_id || e.data?.product_handle))
        .map(e => e.data?.product_id || e.data?.product_handle)
  ).size;
  score += Math.min(uniqueProds * 3, 12);

  // Oturum süresi (bağlılık)
  const dur = (profile.lastTs - profile.firstTs) / 1000;
  if (dur > 60)  score += 3;
  if (dur > 300) score += 4;
  if (dur > 900) score += 3;

  // Sepete ekleme eylemleri
  const cartAdds = evts.filter(e => e.event_type === 'add_to_cart').length;
  score += Math.min(cartAdds * 4, 12);

  // Giriş yapmış üye
  if (profile.customer_id) score += 7;

  // Olay yoğunluğu
  score += Math.min(Math.floor(evts.length / 4), 8);

  return Math.min(Math.round(score), 99);
}

function parseReferrer(ref = '') {
  if (!ref) return 'Direct';
  try {
    const h = new URL(ref).hostname.toLowerCase().replace(/^www\./, '');
    if (/google\.|bing\.|yahoo\.|yandex\./.test(h)) return 'Search';
    if (/facebook\.com|fb\.com/.test(h)) return 'Facebook';
    if (/instagram\.com/.test(h)) return 'Instagram';
    if (/tiktok\.com/.test(h)) return 'TikTok';
    if (/twitter\.com|t\.co|x\.com/.test(h)) return 'Twitter/X';
    if (/youtube\.com/.test(h)) return 'YouTube';
    if (/pinterest\.com/.test(h)) return 'Pinterest';
    // Bilinen sosyal/arama dışı kaynaklarda gerçek domain adını döndür
    // (akakce.com, n11.com, hepsiburada.com, vs.)
    return h;
  } catch { return 'Other'; }
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, sub, value, icon: Icon, color = 'blue', pulse, onClick }) {
  const c = CM[color] || CM.blue;
  return (
    <div onClick={onClick}
      className={`bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3 transition-colors
        ${onClick ? 'cursor-pointer hover:border-borderStrong' : ''}`}>
      <div className="flex items-start justify-between">
        <div className={`p-2.5 rounded-xl ${c.bg} relative`}>
          <Icon size={18} className={c.text} />
          {pulse && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green animate-ping" />}
        </div>
        {onClick && <ArrowRight size={12} className="text-textMute mt-0.5" />}
      </div>
      <div>
        <p className={`text-2xl font-bold tabular-nums leading-none ${pulse ? c.text : 'text-text'}`}>{value}</p>
        <p className="text-textDim text-[11px] uppercase font-bold tracking-wide mt-1.5">{label}</p>
        {sub && <p className="text-textMute text-[10px] mt-0.5 leading-snug">{sub}</p>}
      </div>
    </div>
  );
}

// ── ProductCard ───────────────────────────────────────────────────────────────

function ProductCard({ product, flash }) {
  const { t } = useLang();
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
          <span className="text-[10px] text-textDim">{t('product.views')}</span>
          <span className="text-[10px] font-bold text-purple ml-auto tabular-nums">{product.views}</span>
        </div>
        <div className="flex items-center gap-1">
          <ShoppingCart size={9} className="text-green" />
          <span className="text-[10px] text-textDim">{t('product.cart')}</span>
          <span className="text-[10px] font-bold text-green ml-auto tabular-nums">{product.carts}</span>
        </div>
        {product.views > 0 && product.carts > 0 && (
          <div className="text-center">
            <span className="text-[10px] font-bold text-amber bg-amberSoft px-2 py-0.5 rounded-full">
              {((product.carts / product.views) * 100).toFixed(0)}% {t('product.conv')}
            </span>
          </div>
        )}
        {product.vendor && <p className="text-[10px] text-textMute truncate">{product.vendor}</p>}
      </div>
    </div>
  );
}

// ── VisitorCard ───────────────────────────────────────────────────────────────

function VisitorCard({ profile, customerName, onClick, anonymized = false }) {
  const { t, lang } = useLang();
  const sm = STAGE_META[profile.stage] || STAGE_META.browsing;
  const c  = CM[sm.color] || CM.slate;
  const DevIcon = profile.device === 'mobile' ? Smartphone : profile.device === 'tablet' ? Tablet : Monitor;
  const inactive = Date.now() - profile.lastTs > 5 * 60 * 1000;
  const rawName = customerName ? [customerName.first_name, customerName.last_name].filter(Boolean).join(' ') : null;
  const fullName = anonymized ? maskName(rawName) : rawName;
  return (
    <div onClick={onClick}
      className={`bg-surfaceSoft border rounded-xl p-3 cursor-pointer hover:border-borderStrong transition-all space-y-2
        ${inactive ? 'border-border/40 opacity-50' : 'border-border'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <DevIcon size={11} className="text-textMute" />
          <span className="text-[10px] text-textDim font-mono">{shortVid(profile.vid)}</span>
          {profile.isReturning && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded-full bg-amber/15 text-amber border border-amber/20">{t('visitors.returning')}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {profile.intentScore != null && (
            <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full tabular-nums border
              ${profile.intentScore >= 70
                ? 'bg-greenSoft text-green border-green/20'
                : profile.intentScore >= 40
                ? 'bg-amberSoft text-amber border-amber/20'
                : 'bg-surfaceAlt text-textDim border-border'}`}>
              {profile.intentScore === 100 ? '🛍' : profile.intentScore}
            </span>
          )}
          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>{t('stage.' + (profile.stage || 'browsing'))}</span>
        </div>
      </div>
      {fullName
        ? <p className="text-[10px] text-green font-semibold truncate">{fullName}</p>
        : profile.customer_id
          ? <p className="text-[10px] text-green/60 font-mono truncate">Member #{profile.customer_id}</p>
          : null
      }
      {profile.lastProduct && (
        <p className="text-[10px] text-text/70 truncate" title={profile.lastProduct}>{profile.lastProduct}</p>
      )}
      {/* Scroll depth + Attention time badges */}
      {(profile.maxScrollDepth || profile.attentionSeconds) && (
        <div className="flex items-center gap-1 flex-wrap">
          {profile.maxScrollDepth && (
            <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full border tabular-nums
              ${profile.maxScrollDepth >= 75 ? 'bg-greenSoft text-green border-green/20'
                : profile.maxScrollDepth >= 50 ? 'bg-amberSoft text-amber border-amber/20'
                : 'bg-surfaceAlt text-textDim border-border'}`}>
              ↕ {profile.maxScrollDepth}%
            </span>
          )}
          {profile.attentionSeconds && profile.attentionSeconds >= 5 && (
            <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full border tabular-nums
              ${profile.attentionSeconds >= 60 ? 'bg-greenSoft text-green border-green/20'
                : profile.attentionSeconds >= 20 ? 'bg-amberSoft text-amber border-amber/20'
                : 'bg-surfaceAlt text-textDim border-border'}`}>
              ⏱ {profile.attentionSeconds >= 60
                ? `${Math.round(profile.attentionSeconds / 60)}dk`
                : `${profile.attentionSeconds}s`}
            </span>
          )}
        </div>
      )}
      {profile.utm?.utm_campaign && (
        <p className="text-[10px] text-blue truncate">{profile.utm.utm_source || 'utm'} / {profile.utm.utm_campaign}</p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-textMute">{profile.referrer}</span>
        <span className="text-[11px] text-textMute">{timeAgo(profile.lastTs, lang)}</span>
      </div>
    </div>
  );
}

// ── EventRow ──────────────────────────────────────────────────────────────────

function EventRow({ ev, isNew }) {
  const { t } = useLang();
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
          <span className={`text-xs font-bold ${c.text}`}>{t('event.' + ev.event_type) || meta.label}</span>
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
          <p className="text-[10px] text-textMute mt-0.5 truncate">
            {d.line_items.slice(0, 3).map(li => `${li.title} ×${li.quantity}`).join(' · ')}
            {d.line_items.length > 3 ? ` +${d.line_items.length - 3}` : ''}
          </p>
        )}
        {!d.line_items?.length && (
          <p className="text-[10px] text-textMute mt-0.5 truncate">{fmtUrl(ev.url)}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.dot}`} />
          <span className="text-[10px] text-textMute">{shortVid(ev.vid)}</span>
          {ev.customer_id && <span className="text-[10px] text-green">{t('common.member')}{ev.customer_id}</span>}
          {ev.utm?.utm_campaign && (
            <span className="text-[10px] text-blue bg-blueSoft px-1 rounded">{ev.utm.utm_campaign}</span>
          )}
          <span className="text-[10px] text-textMute">{fmtTime(ev.ts)}</span>
        </div>
      </div>
    </div>
  );
}

// ── ConversionFunnelWidget ────────────────────────────────────────────────────
// Adım adım dönüşüm hunisi — kayıp noktaları ve dönüşüm oranıyla

function ConversionFunnelWidget({ stats }) {
  const { t } = useLang();
  const total = stats.total || 1;

  const steps = [
    { key: 'all_visitors',     count: stats.total,     bar: 'bg-blue',   text: 'text-blue' },
    { key: 'viewed_product',   count: stats.product,   bar: 'bg-purple', text: 'text-purple' },
    { key: 'added_to_cart',    count: stats.cart,      bar: 'bg-amber',  text: 'text-amber' },
    { key: 'started_checkout', count: stats.checkout,  bar: 'bg-orange', text: 'text-orange' },
    { key: 'purchased',        count: stats.converted, bar: 'bg-green',  text: 'text-green' },
  ];

  const convRate = total > 0 ? ((stats.converted / total) * 100).toFixed(1) : '0.0';
  const convNum  = parseFloat(convRate);

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp size={15} className="text-blue" />
          <span className="text-text text-sm font-bold">{t('funnel.title')}</span>
        </div>
        <div className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${
          convNum >= 3 ? 'bg-greenSoft text-green' :
          convNum >= 1 ? 'bg-amberSoft text-amber' : 'bg-roseSoft text-rose'
        }`}>
          {t('funnel.conv_rate')}: {convRate}%
        </div>
      </div>
      <div className="p-4 space-y-1.5">
        {steps.map((step, i) => {
          const pct = total > 0 ? (step.count / total) * 100 : 0;
          const prevCount = i > 0 ? steps[i - 1].count : step.count;
          const dropOff  = i > 0 ? Math.max(0, prevCount - step.count) : 0;
          const dropPct  = i > 0 && prevCount > 0 ? ((dropOff / prevCount) * 100).toFixed(0) : null;

          return (
            <div key={step.key}>
              {/* Drop-off arrow between steps */}
              {i > 0 && dropOff > 0 && (
                <div className="flex items-center gap-1.5 py-0.5 pl-1">
                  <span className="text-[9px] text-rose/60">▼</span>
                  <span className="text-[9px] text-rose/70 font-medium">
                    {dropOff} {t('funnel.dropped')} ({dropPct}%)
                  </span>
                </div>
              )}
              {/* Step row */}
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-semibold ${step.text}`}>{t('funnel.' + step.key)}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-text tabular-nums">{step.count}</span>
                      <span className="text-[10px] text-textMute tabular-nums">({pct.toFixed(0)}%)</span>
                    </div>
                  </div>
                  <div className="h-2 bg-surfaceAlt rounded-full overflow-hidden">
                    <div className={`h-full ${step.bar} rounded-full transition-all duration-700 opacity-80`}
                      style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TrafficTable ──────────────────────────────────────────────────────────────

function TrafficTable({ traffic, onSourceClick }) {
  const { t } = useLang();
  if (!traffic.length) return null;
  const max = traffic[0]?.count || 1;
  const total = traffic.reduce((a, b) => a + b.count, 0) || 1;
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <Globe size={15} className="text-textDim" />
        <span className="text-text text-sm font-bold">{t('analytics.traffic')}</span>
        <span className="text-[10px] text-textMute ml-auto">{t('analytics.traffic_click')}</span>
      </div>
      <div className="divide-y divide-border/60">
        {traffic.map(({ source, count }) => (
          <div key={source} onClick={() => onSourceClick?.(source)}
            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surfaceAlt/40 transition-colors">
            <span className={`text-xs font-bold w-24 shrink-0 truncate ${srcColor(source)}`} title={source}>{source}</span>
            <div className="flex-1 h-1.5 bg-surfaceAlt rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue to-purple rounded-full transition-all duration-500"
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
  const { t, lang } = useLang();
  if (!searches.length) return null;
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <Search size={15} className="text-textDim" />
        <span className="text-text text-sm font-bold">{t('analytics.searches')}</span>
        <span className="text-[10px] bg-surfaceAlt text-textDim px-2 py-0.5 rounded-full ml-auto">{searches.length} {t('common.terms')}</span>
      </div>
      <div className="divide-y divide-border/60">
        {searches.map((s, i) => (
          <div key={s.query} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surfaceAlt/40 transition-colors">
            <span className="text-[10px] text-textMute w-4 text-right font-mono">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <span className="text-sm text-text font-medium">"{s.query}"</span>
            </div>
            <div className="w-20 h-1.5 bg-surfaceAlt rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue to-purple rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (s.count / searches[0].count) * 100)}%` }} />
            </div>
            <span className="text-xs font-bold text-textDim w-6 text-right tabular-nums">{s.count}</span>
            <span className="text-[10px] text-textMute w-16 text-right">{timeAgo(s.lastTs, lang)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── JourneyModal ──────────────────────────────────────────────────────────────

function JourneyModal({ profile, customerName, onClose }) {
  const { t, lang } = useLang();
  if (!profile) return null;
  const sm = STAGE_META[profile.stage] || STAGE_META.browsing;
  const c = CM[sm.color] || CM.slate;
  const DevIcon = profile.device === 'mobile' ? Smartphone : profile.device === 'tablet' ? Tablet : Monitor;
  const fullName = customerName ? [customerName.first_name, customerName.last_name].filter(Boolean).join(' ') : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-borderStrong rounded-2xl w-full max-w-lg max-h-[82vh] flex flex-col shadow-2xl"
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
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${c.bg} ${c.text}`}>{t('stage.' + (profile.stage || 'browsing'))}</span>
            <button onClick={onClose} className="p-1.5 hover:bg-surfaceAlt rounded-lg text-textDim hover:text-text transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/60 text-[10px] text-textMute flex-wrap">
          <span>{profile.events.length} {t('journey.event')}</span>
          <span>{t('journey.first')} {fmtTime(profile.firstTs)}</span>
          <span>{t('journey.last')} {fmtTime(profile.lastTs)}</span>
          <span>{Math.max(0, Math.round((profile.lastTs - profile.firstTs) / 60000))} {t('journey.min')}</span>
          {profile.customer_id && !fullName && <span className="text-green font-semibold">{t('common.member')}{profile.customer_id}</span>}
          {customerName?.email && <span className="text-textDim">{customerName.email}</span>}
          {customerName?.orders_count > 0 && <span className="text-amber">{customerName.orders_count} {t('journey.orders')}</span>}
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
                    <span className={`text-[10px] font-bold ${ec.text}`}>{t('event.' + ev.event_type) || meta.label}</span>
                    {ev.data?.product_title && <span className="text-[10px] text-text/70 truncate max-w-[160px]">{ev.data.product_title}</span>}
                    {ev.data?.query && <span className="text-[10px] text-text/70">"{ev.data.query}"</span>}
                  </div>
                  <p className="text-[10px] text-textMute truncate">{fmtUrl(ev.url)}</p>
                </div>
                <span className="text-[10px] text-textMute shrink-0">{fmtTime(ev.ts)}</span>
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
  const { t, lang } = useLang();
  if (!title) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-borderStrong rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
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
              <p className="text-[10px] text-textMute uppercase font-bold px-2 mb-1">{t('modal.viewed_products')} ({products.length})</p>
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
                    <p className="text-[10px] text-textMute">{t('modal.views')}</p>
                  </div>
                  {p.carts > 0 && (
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-green tabular-nums">{p.carts}</p>
                      <p className="text-[10px] text-textMute">{t('modal.cart')}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {visitors?.length > 0 && (
            <div>
              <p className="text-[10px] text-textMute uppercase font-bold px-2 mb-1">{t('modal.visitors')} ({visitors.length})</p>
              {visitors.slice(0, 30).map((v, i) => {
                const sm2 = STAGE_META[v.stage] || STAGE_META.browsing;
                const c2 = CM[sm2.color] || CM.slate;
                return (
                  <div key={i} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-surfaceAlt/40 transition-colors">
                    <span className="text-[10px] font-mono text-textMute w-16">{shortVid(v.vid)}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${c2.bg} ${c2.text} shrink-0`}>{t('stage.' + (v.stage || 'browsing'))}</span>
                    {v.lastProduct && <span className="text-[10px] text-text/60 flex-1 truncate">{v.lastProduct}</span>}
                    <span className="text-[10px] text-textMute shrink-0">{timeAgo(v.lastTs, lang)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {!products?.length && !visitors?.length && (
            <div className="py-8 text-center text-textMute text-sm">{t('modal.no_data')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── OrderJourneyModal ─────────────────────────────────────────────────────────
// Shopify CustomerJourneySummary ile oluşturulan sipariş yolculuğu modalı

function VisitStep({ visit, index, isLast }) {
  const { t } = useLang();
  if (!visit) return null;
  const src = visit.source || '';
  const med = visit.referrerUrl || '';
  const ch  = visit.utmParameters?.source || src || t('ojrn.direct');
  const ts  = visit.occurredAt ? new Date(visit.occurredAt).toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '';

  const chColor = /google|bing|yahoo/i.test(ch) ? 'text-blue'
    : /facebook|instagram/i.test(ch) ? 'text-rose'
    : /tiktok/i.test(ch) ? 'text-textDim'
    : ch === t('ojrn.direct') || ch === 'direct' ? 'text-green'
    : 'text-purple';

  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center shrink-0 pt-1">
        <div className="w-2 h-2 rounded-full bg-blue shrink-0" />
        {!isLast && <div className="w-px bg-border flex-1 mt-0.5 mb-0.5" style={{ minHeight: '14px' }} />}
      </div>
      <div className={`flex-1 min-w-0 flex items-start justify-between gap-2 ${!isLast ? 'pb-2' : ''}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-textMute w-4 font-mono">{index + 1}</span>
            <span className={`text-[11px] font-semibold ${chColor}`}>{ch}</span>
            {visit.utmParameters?.campaign && (
              <span className="text-[10px] bg-blueSoft text-blue px-1 py-0.5 rounded">
                {visit.utmParameters.campaign}
              </span>
            )}
          </div>
          {med && (
            <p className="text-[10px] text-textMute truncate ml-5 mt-0.5 max-w-[200px]" title={med}>
              {med.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
            </p>
          )}
        </div>
        {ts && <span className="text-[10px] text-textMute whitespace-nowrap shrink-0">{ts}</span>}
      </div>
    </div>
  );
}

function OrderJourneyModal({ orderId, session, onClose }) {
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [data, setData]       = useState(null);
  const [err, setErr]         = useState('');

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    setErr('');
    setData(null);
    const { token, username, brand } = session;
    fetch(
      `${API_URL}/api/shopify/order-journey?order_id=${encodeURIComponent(orderId)}&username=${encodeURIComponent(username)}&brand=${encodeURIComponent(brand)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
      .then(r => r.json())
      .then(d => {
        if (d.ok) setData(d.order);
        else setErr(d.error || d.detail || 'Error');
      })
      .catch(() => setErr('Network error'))
      .finally(() => setLoading(false));
  }, [orderId, session]);

  if (!orderId) return null;

  const journey    = data?.customerJourneySummary;
  // Shopify returns either `nodes` (new) or `edges[].node` (old) depending on API version
  const moments    = journey?.moments?.nodes
    || (journey?.moments?.edges || []).map(e => e.node).filter(Boolean)
    || [];
  const firstVisit  = journey?.firstVisit;
  const lastVisit   = journey?.lastVisit;
  const daysToConv  = journey?.daysToConversion;
  // Order source info (shown even when no moments)
  const sourceName  = data?.sourceName || '';
  const channelName = data?.channelInformation?.channelDefinition?.channelName || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-borderStrong rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blueSoft">
              <TrendingUp size={14} className="text-blue" />
            </div>
            <div>
              <p className="text-text font-bold text-sm">{t('ojrn.title')}</p>
              {data?.name && <p className="text-textMute text-[10px]">Order {data.name}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surfaceAlt rounded-lg text-textDim hover:text-text transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Stats row */}
        {journey && (
          <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/60 bg-surfaceAlt/30">
            {firstVisit?.occurredAt && (
              <div className="text-center">
                <p className="text-[10px] text-textMute">{t('ojrn.first_visit')}</p>
                <p className="text-xs font-bold text-text tabular-nums">
                  {new Date(firstVisit.occurredAt).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}
                </p>
              </div>
            )}
            {lastVisit?.occurredAt && (
              <div className="text-center">
                <p className="text-[10px] text-textMute">{t('ojrn.last_visit')}</p>
                <p className="text-xs font-bold text-text tabular-nums">
                  {new Date(lastVisit.occurredAt).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}
                </p>
              </div>
            )}
            {daysToConv != null && (
              <div className="text-center">
                <p className="text-[10px] text-textMute">{t('ojrn.days_conv')}</p>
                <p className="text-xs font-bold text-green tabular-nums">{daysToConv}d</p>
              </div>
            )}
            {moments.length > 0 && (
              <div className="text-center">
                <p className="text-[10px] text-textMute">{t('ojrn.touchpoints')}</p>
                <p className="text-xs font-bold text-blue tabular-nums">{moments.length}</p>
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-0 custom-scrollbar">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <RefreshCw size={18} className="text-textMute animate-spin" />
              <p className="text-textMute text-sm">{t('ojrn.loading')}</p>
            </div>
          )}
          {!loading && err && (
            <div className="flex items-center gap-2 bg-roseSoft border border-rose/20 rounded-xl px-4 py-3 text-sm text-rose">
              <AlertCircle size={13} className="shrink-0" /> {err}
            </div>
          )}
          {!loading && !err && moments.length === 0 && (
            <div className="py-8 text-center space-y-3 px-4">
              <Globe size={22} className="text-textMute mx-auto" />
              <p className="text-text font-semibold text-sm">{t('ojrn.no_data')}</p>
              <p className="text-textMute text-[11px] leading-relaxed max-w-xs mx-auto">
                {journey && !journey.ready
                  ? 'Shopify bu sipariş için yolculuk verisini henüz işlemedi.'
                  : 'Bu sipariş için yolculuk geçmişi kaydedilmemiş.'}
              </p>
              {/* Order source — even when no journey moments */}
              {(sourceName || channelName) && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surfaceAlt border border-border text-[11px] text-textDim">
                  <Globe size={10} />
                  <span>{channelName || sourceName}</span>
                  {sourceName && channelName && sourceName !== channelName && (
                    <span className="text-textMute">· {sourceName}</span>
                  )}
                </div>
              )}
              <button
                onClick={onClose}
                className="mt-2 flex items-center gap-2 mx-auto px-5 py-2 rounded-xl bg-surface border border-border text-text text-xs font-semibold hover:border-green/50 transition-colors"
              >
                <X size={12} /> {t('ojrn.close') || 'Kapat'}
              </button>
            </div>
          )}
          {!loading && !err && moments.length > 0 && (
            <div className="space-y-0">
              {/* First visit if not in moments */}
              {firstVisit && !moments.find(m => m.occurredAt === firstVisit.occurredAt) && (
                <VisitStep visit={firstVisit} index={-1} isLast={false} />
              )}
              {moments.map((m, i) => (
                <VisitStep key={i} visit={m} index={i} isLast={i === moments.length - 1 && !lastVisit} />
              ))}
              {/* Purchase endpoint */}
              <div className="flex gap-2.5 pt-1">
                <div className="flex flex-col items-center shrink-0 pt-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-green shrink-0" />
                </div>
                <span className="text-[11px] text-green font-bold flex items-center gap-1 pb-0.5">
                  <CheckCircle size={11} /> {data?.name || 'Order'} — {data?.totalPriceSet?.shopMoney ? `${parseFloat(data.totalPriceSet.shopMoney.amount).toLocaleString('tr-TR')} ${data.totalPriceSet.shopMoney.currencyCode}` : ''}
                </span>
              </div>
            </div>
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

// ── RFMWidget ─────────────────────────────────────────────────────────────────
// Shopify siparişlerinden müşteri segmentasyonu (Champions / Loyal / At-Risk / Lost)

const RFM_SEGMENTS = {
  champions:       { label: 'Champions',       emoji: '🏆', cls: 'bg-greenSoft text-green border-green/20'      },
  loyal:           { label: 'Loyal',           emoji: '💎', cls: 'bg-blueSoft text-blue border-blue/20'         },
  promising:       { label: 'Promising',       emoji: '🌱', cls: 'bg-tealSoft text-teal border-teal/20'         },
  new:             { label: 'New',             emoji: '✨', cls: 'bg-purpleSoft text-purple border-purple/20'   },
  needs_attention: { label: 'Needs Attention', emoji: '⏰', cls: 'bg-amberSoft text-amber border-amber/20'      },
  at_risk:         { label: 'At-Risk',         emoji: '⚠️', cls: 'bg-amberSoft text-amber border-amber/30'      },
  lost:            { label: 'Lost',            emoji: '😴', cls: 'bg-surfaceAlt text-textDim border-border'     },
};

function RFMWidget({ session, anonymized = false }) {
  const { t, lang } = useLang();
  const { token, username, brand } = session;
  const [rfmData, setRfmData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null); // expanded segment key
  const [days, setDays] = useState(90);

  async function loadRFM() {
    setLoading(true);
    try {
      const r = await fetch(
        `${API_URL}/api/shopify/customers/rfm?username=${encodeURIComponent(username)}&brand=${encodeURIComponent(brand)}&days=${days}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const d = await r.json();
      if (d.ok) setRfmData(d);
    } catch {}
    setLoading(false);
  }

  const segOrder = ['champions', 'loyal', 'promising', 'new', 'needs_attention', 'at_risk', 'lost'];

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <Users size={15} className="text-purple" />
        <span className="text-text text-sm font-bold">{t('rfm.title')}</span>
        {rfmData && (
          <span className="text-[10px] bg-surfaceAlt text-textDim px-2 py-0.5 rounded-full ml-1">
            {rfmData.total_customers} {t('rfm.customers')} · {rfmData.order_count} {t('rfm.orders')} · {rfmData.days}d
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text focus:outline-none">
            <option value={30}>30d</option>
            <option value={60}>60d</option>
            <option value={90}>90d</option>
            <option value={180}>180d</option>
          </select>
          <button onClick={loadRFM} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-purpleSoft border border-purple/20 text-purple hover:bg-purple/10 transition-colors disabled:opacity-50">
            {loading ? <RefreshCw size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {loading ? t('rfm.loading') : (rfmData ? t('rfm.refresh') : t('rfm.load'))}
          </button>
        </div>
      </div>

      {!rfmData && !loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
          <Users size={20} className="text-textMute/40" />
          <p className="text-textMute text-sm">{t('rfm.cta')}</p>
          <p className="text-textMute text-[11px]">{t('rfm.cta_sub')}</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-10">
          <RefreshCw size={18} className="text-textMute animate-spin" />
        </div>
      )}

      {rfmData && !loading && (
        <div className="p-4 space-y-3">
          {/* Segment pills */}
          <div className="flex flex-wrap gap-2">
            {segOrder.filter(s => rfmData.segments[s]).map(s => {
              const meta = RFM_SEGMENTS[s];
              return (
                <button key={s} onClick={() => setExpanded(expanded === s ? null : s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all
                    ${meta.cls} ${expanded === s ? 'ring-2 ring-offset-1 ring-current' : ''}`}>
                  <span>{meta.emoji}</span>
                  <span>{t('rfm.seg.' + s) || meta.label}</span>
                  <span className="bg-white/20 px-1 rounded-md">{rfmData.segments[s]}</span>
                </button>
              );
            })}
          </div>

          {/* Distribution bar */}
          <div className="h-2.5 rounded-full overflow-hidden flex gap-0.5">
            {segOrder.filter(s => rfmData.segments[s]).map(s => {
              const pct = (rfmData.segments[s] / rfmData.total_customers) * 100;
              const barCls = {
                champions: 'bg-green', loyal: 'bg-blue', promising: 'bg-teal',
                new: 'bg-purple', needs_attention: 'bg-amber', at_risk: 'bg-amber/60', lost: 'bg-border',
              }[s];
              return <div key={s} className={`${barCls} rounded-sm`} style={{ width: `${pct}%` }} title={`${s}: ${rfmData.segments[s]}`} />;
            })}
          </div>

          {/* Expanded segment customers */}
          {expanded && rfmData.seg_customers[expanded]?.length > 0 && (
            <div className="bg-surfaceAlt/40 border border-border rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2">
                <span className="text-sm">{RFM_SEGMENTS[expanded].emoji}</span>
                <span className="text-xs font-bold text-text">{t('rfm.seg.' + expanded) || RFM_SEGMENTS[expanded].label}</span>
                <span className="text-[10px] text-textMute ml-auto">{t('rfm.top10')}</span>
              </div>
              <div className="divide-y divide-border/40">
                {rfmData.seg_customers[expanded].map((c, i) => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surfaceAlt/60 transition-colors">
                    <span className="text-[10px] text-textMute w-4 text-right font-mono">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-text truncate">
                        {anonymized
                          ? (c.name ? maskName(c.name) : c.email ? maskEmail(c.email) : t('rfm.anonymous'))
                          : (c.name || c.email || t('rfm.anonymous'))}
                      </p>
                      {c.email && c.name && (
                        <p className="text-[10px] text-textMute truncate">
                          {anonymized ? maskEmail(c.email) : c.email}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-green tabular-nums">
                        {c.monetary.toLocaleString('tr-TR', { minimumFractionDigits: 0 })} {rfmData.currency}
                      </p>
                      <p className="text-[10px] text-textMute">{c.frequency}× · {c.r_days}d</p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {[c.r_score, c.f_score, c.m_score].map((sc, j) => (
                        <span key={j} className={`text-[9px] font-bold w-4 h-4 rounded flex items-center justify-center
                          ${sc >= 4 ? 'bg-greenSoft text-green' : sc === 3 ? 'bg-amberSoft text-amber' : 'bg-surfaceAlt text-textMute'}`}>
                          {sc}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── StockDemandWidget — #5 Stok-Talep Alarm ──────────────────────────────────
// Aynı anda 2+ ziyaretçinin baktığı ürünleri gösterir

function StockDemandWidget({ hotProducts }) {
  const { t } = useLang();
  if (!hotProducts.length) return null;

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Flame size={14} className="text-amber-400" />
          <p className="text-sm font-bold text-text">{t('stock.title')}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold tabular-nums">
            {hotProducts.length}
          </span>
        </div>
        <span className="text-[10px] text-textMute">{t('stock.subtitle')}</span>
      </div>
      <div className="divide-y divide-border/40">
        {hotProducts.map(p => {
          const heat = p.viewers >= 5 ? 'text-rose' : p.viewers >= 3 ? 'text-amber-400' : 'text-textDim';
          return (
            <div key={p.title} className="flex items-center gap-3 px-4 py-2.5">
              <div className={`flex items-center gap-1 shrink-0 font-bold text-xs tabular-nums ${heat}`}>
                <Flame size={11} />
                <span>{p.viewers}</span>
              </div>
              <p className="flex-1 text-xs text-text truncate" title={p.title}>{p.title}</p>
              {p.cartAdders > 0 && (
                <div className="flex items-center gap-1 shrink-0 text-[10px] font-bold text-green">
                  <ShoppingCart size={10} />
                  <span>{p.cartAdders}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── HiddenCartPanel — #10 Görünmez Sepet Dedektörü ───────────────────────────
// Sepete ürün ekleyip browsing'e dönen ziyaretçileri tespit eder

function HiddenCartPanel({ visitors, customerNames }) {
  const { t } = useLang();
  const [open, setOpen] = useState(true);

  if (!visitors.length) return null;

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 border-b border-border/60 hover:bg-surfaceAlt/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <ShoppingBag size={14} className="text-blue" />
          <p className="text-sm font-bold text-text">{t('hcart.title')}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue/15 text-blue font-bold tabular-nums">
            {visitors.length}
          </span>
        </div>
        {open ? <ChevronUp size={13} className="text-textMute" /> : <ChevronDown size={13} className="text-textMute" />}
      </button>

      {open && (
        <div className="divide-y divide-border/40">
          {visitors.slice(0, 8).map(p => {
            const minsAgo = Math.round((Date.now() - p.lastCartTs) / 60000);
            const name = customerNames?.[p.customer_id] || '';
            return (
              <div key={p.vid} className="px-4 py-2.5 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue shrink-0" />
                  <p className="text-xs font-semibold text-text flex-1 truncate">
                    {name || p.vid.slice(-6)}
                  </p>
                  <span className="text-[10px] text-textMute tabular-nums shrink-0">
                    {minsAgo}d {t('common.ago') || 'önce'}
                  </span>
                </div>
                {p.cartProducts.length > 0 && (
                  <div className="flex flex-wrap gap-1 pl-3.5">
                    {p.cartProducts.slice(0, 2).map((prod, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-blueSoft text-blue truncate max-w-[160px]">
                        {prod}
                      </span>
                    ))}
                    {p.cartProducts.length > 2 && (
                      <span className="text-[10px] text-textMute">+{p.cartProducts.length - 2}</span>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-textMute pl-3.5">
                  {t('stage.' + p.stage)} {t('hcart.now_browsing') || '· şu an geziniyor'}
                </p>
              </div>
            );
          })}
          {visitors.length > 8 && (
            <p className="px-4 py-2 text-center text-[10px] text-textMute">
              +{visitors.length - 8} {t('hcart.more') || 'daha'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}


// ── AbandonmentIntelligencePanel ──────────────────────────────────────────────
// Risk skorlu gerçek zamanlı terk tespit paneli — WA hızlı gönderim destekli

function calcAbandonmentRisk(profile, now = Date.now()) {
  const minsInactive = (now - profile.lastTs) / 60000;
  let risk = 0;

  // Zaman bazlı — ne kadar uzun süredir hareketsiz?
  if (minsInactive > 30)      risk += 40;
  else if (minsInactive > 15) risk += 28;
  else if (minsInactive > 5)  risk += 12;
  else                         risk += 3;

  // Aşama — checkout > cart
  if (profile.stage === 'checkout') risk += 30;
  else if (profile.stage === 'cart') risk += 15;

  // Geri dönen ziyaretçi → daha az risk
  if (profile.isReturning) risk -= 10;
  // Üye → biraz daha az risk
  if (profile.customer_id) risk -= 8;
  // Mobil → hafif yüksek risk
  if (profile.device === 'mobile') risk += 5;
  // Yüksek intent → daha acil (paradoks: yüksek intent = sepette/checkout = daha değerli)
  if ((profile.intentScore || 0) >= 70) risk += 5;

  return Math.min(Math.max(Math.round(risk), 0), 100);
}

function AbandonmentIntelligencePanel({ atRiskVisitors, customerNames, session, onVisitorClick, anonymized = false }) {
  const { t, lang } = useLang();
  const { token, username, brand } = session;
  const [sending, setSending] = useState({}); // vid → 'sending' | 'sent' | 'error'
  const [open, setOpen]       = useState(true);

  if (!atRiskVisitors.length) return null;

  async function quickSend(visitor) {
    const cn = customerNames[visitor.customer_id];
    const phone = cn?.phone || '';
    if (!phone) return;
    setSending(s => ({ ...s, [visitor.vid]: 'sending' }));
    try {
      const r = await fetch(
        `${API_URL}/api/flow/quick-trigger?username=${encodeURIComponent(username)}&brand=${encodeURIComponent(brand)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            phone,
            name: cn ? [cn.first_name, cn.last_name].filter(Boolean).join(' ') : '',
            product: visitor.lastProduct || '',
          }),
        }
      );
      const d = await r.json();
      setSending(s => ({ ...s, [visitor.vid]: d.ok ? 'sent' : 'error' }));
    } catch {
      setSending(s => ({ ...s, [visitor.vid]: 'error' }));
    }
  }

  const riskBadge = risk =>
    risk >= 70 ? { cls: 'bg-roseSoft text-rose border-rose/20', label: t('abnd.high') }
    : risk >= 40 ? { cls: 'bg-amberSoft text-amber border-amber/20', label: t('abnd.medium') }
    : { cls: 'bg-surfaceAlt text-textDim border-border', label: t('abnd.low') };

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="relative">
          <CreditCard size={15} className="text-amber" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber animate-ping" />
        </div>
        <span className="text-text text-sm font-bold flex-1">{t('abnd.title')}</span>
        <span className="text-[10px] bg-amberSoft text-amber border border-amber/20 px-2 py-0.5 rounded-full">
          {atRiskVisitors.length} {t('abnd.at_risk')}
        </span>
        <button onClick={() => setOpen(o => !o)} className="p-1 text-textMute hover:text-text transition-colors">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {open && (
        <div className="divide-y divide-border/50 max-h-[400px] overflow-y-auto custom-scrollbar">
          {atRiskVisitors.map(profile => {
            const risk = profile.riskScore;
            const badge = riskBadge(risk);
            const cn = customerNames[profile.customer_id];
            const rawFullName = cn ? [cn.first_name, cn.last_name].filter(Boolean).join(' ') : null;
            const fullName = anonymized ? maskName(rawFullName) : rawFullName;
            const hasPhone = !!cn?.phone;
            const sendState = sending[profile.vid];
            const DevIcon = profile.device === 'mobile' ? Smartphone : profile.device === 'tablet' ? Tablet : Monitor;
            return (
              <div key={profile.vid}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surfaceAlt/30 transition-colors cursor-pointer"
                onClick={() => onVisitorClick(profile)}>
                <div className="shrink-0">
                  <DevIcon size={13} className="text-textMute" />
                </div>
                <div className="flex-1 min-w-0">
                  {fullName
                    ? <p className="text-xs font-bold text-green truncate">{fullName}</p>
                    : <p className="text-xs font-mono text-textDim">{shortVid(profile.vid)}</p>
                  }
                  {profile.lastProduct && (
                    <p className="text-[10px] text-text/60 truncate max-w-[180px]">{profile.lastProduct}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                      profile.stage === 'checkout' ? 'bg-amberSoft text-amber border-amber/20' : 'bg-surfaceAlt text-textDim border-border'
                    }`}>{t('stage.' + profile.stage)}</span>
                    <span className="text-[10px] text-textMute">{timeAgo(profile.lastTs, lang)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${badge.cls}`}>
                    {risk}% {badge.label}
                  </span>
                  {hasPhone && sendState !== 'sent' && (
                    <button
                      onClick={e => { e.stopPropagation(); quickSend(profile); }}
                      disabled={sendState === 'sending'}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-greenSoft border border-green/20 text-green hover:bg-green/10 transition-colors disabled:opacity-50">
                      {sendState === 'sending'
                        ? <RefreshCw size={9} className="animate-spin" />
                        : <MessageCircle size={9} />}
                      WA
                    </button>
                  )}
                  {sendState === 'sent' && (
                    <span className="text-[10px] text-green flex items-center gap-0.5">
                      <CheckCircle size={10} /> {t('abnd.sent')}
                    </span>
                  )}
                  {sendState === 'error' && (
                    <span className="text-[10px] text-rose">✗</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

// ── Flow (WA Otomasyon) Panel ─────────────────────────────────────────────────

const DEFAULT_SEQUENCE = [
  { delay_minutes: 15,   template: 'sepet_hatirlatma', language: 'tr', enabled: true,  label: 'First reminder' },
  { delay_minutes: 1440, template: 'sepet_hatirlatma', language: 'tr', enabled: false, label: 'After 24 hours' },
  { delay_minutes: 2880, template: 'sepet_hatirlatma', language: 'tr', enabled: false, label: 'After 48 hours' },
];

function fmtDelay(m, lang = 'en') {
  if (lang === 'tr') {
    if (m < 60) return `${m} dk`;
    if (m < 1440) return `${Math.round(m / 60)} sa`;
    return `${Math.round(m / 1440)} gün`;
  }
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} hr`;
  return `${Math.round(m / 1440)} day`;
}

function playOrderSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t); osc.stop(t + 0.4);
    });
  } catch { /* audio blocked */ }
}

function fmtRevenue(amount) {
  if (amount >= 1_000_000) return `₺${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)     return `₺${(amount / 1_000).toFixed(1)}K`;
  return `₺${amount.toFixed(0)}`;
}

function FlowPanel({ session, anonymized = false }) {
  const { t, lang } = useLang();
  const { token, username, brand } = session;
  const base = API_URL;
  const qp   = `?username=${encodeURIComponent(username)}&brand=${encodeURIComponent(brand)}`;
  const authH = { Authorization: `Bearer ${token}` };

  const [settings, setSettings] = useState({
    enabled: false, wa_token: '', phone_number_id: '',
    sequence: DEFAULT_SEQUENCE,
    post_order: { enabled: false, template: 'siparis_onay' },
    cooldown_hours: 48,
    min_cart_value: 0,
    send_window_start: 9,
    send_window_end: 21,
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
  const [expandedCustomers, setExpandedCustomers] = useState(new Set());

  const [orders, setOrders]         = useState([]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [journeyOrderId, setJourneyOrderId] = useState(null);

  const [roi, setRoi]           = useState(null);
  const [roiDays, setRoiDays]   = useState(7);
  const [roiOpen, setRoiOpen]   = useState(true);

  const [optouts, setOptouts]         = useState([]);
  const [optoutsOpen, setOptoutsOpen] = useState(false);
  const [optoutPhone, setOptoutPhone] = useState('');
  const [removingOptout, setRmOptout] = useState('');

  const [connOpen, setConnOpen]   = useState(true);
  const [seqOpen, setSeqOpen]     = useState(true);
  const [testOpen, setTestOpen]   = useState(false);
  const [waTab, setWaTab]         = useState('dashboard');

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
          sequence:          s.sequence?.length ? s.sequence : DEFAULT_SEQUENCE,
          post_order:        s.post_order || { enabled: false, template: 'siparis_onay' },
          cooldown_hours:    s.cooldown_hours ?? 48,
          min_cart_value:    s.min_cart_value ?? 0,
          send_window_start: s.send_window_start ?? 9,
          send_window_end:   s.send_window_end ?? 21,
        });
        setMasked(s.wa_token_masked || '');
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [username, brand]);

  const fetchLogs = useCallback(async () => {
    setLogsL(true);
    try {
      const r = await fetch(`${base}/api/flow/logs${qp}&limit=500`, { headers: authH });
      const d = await r.json();
      if (d.ok) setLogs(d.logs || []);
    } catch { /* ignore */ }
    setLogsL(false);
  }, [username, brand]);

  const fetchOrders = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/flow/orders${qp}&limit=50`, { headers: authH });
      const d = await r.json();
      if (d.ok) setOrders(d.orders || []);
    } catch { /* ignore */ }
  }, [username, brand]);

  const fetchRoi = useCallback(async (days = roiDays) => {
    try {
      const r = await fetch(`${base}/api/flow/roi${qp}&days=${days}`, { headers: authH });
      const d = await r.json();
      if (d.ok) setRoi(d);
    } catch { /* ignore */ }
  }, [username, brand, roiDays]);

  const fetchOptouts = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/flow/optouts`, { headers: authH });
      const d = await r.json();
      if (d.ok) setOptouts(d.phones || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchSettings(); fetchLogs(); fetchOrders(); fetchOptouts(); fetchRoi(); }, [username, brand]);

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

  // useMemo erken return'den önce — Hooks kuralı gereği
  const customerGroups = useMemo(() => {
    const map = {};
    for (const entry of logs) {
      const key = entry.phone || 'unknown';
      if (!map[key]) {
        map[key] = {
          key, name: entry.name || 'Customer',
          phone: entry.phone, product: null,
          entries: [], converted: false,
          lastTs: 0, firstTs: Infinity,
          sentCount: 0, cooldownCount: 0,
          cycleMap: {},
        };
      }
      const g = map[key];
      g.entries.push(entry);
      if (entry.ts > g.lastTs) g.lastTs = entry.ts;
      if (entry.ts < g.firstTs) g.firstTs = entry.ts;
      if (!g.name || g.name === 'Customer') g.name = entry.name || g.name;
      if (entry.converted) g.converted = true;
      if (entry.ok) g.sentCount++;
      if (entry.status === 'cooldown_skip') g.cooldownCount++;

      // Per-cycle (checkout token) grouping
      const tokenKey = entry.token || '__unknown__';
      if (!g.cycleMap[tokenKey]) {
        g.cycleMap[tokenKey] = {
          token: tokenKey,
          product: entry.product || null,
          entries: [],
          converted: false,
          firstTs: Infinity,
          lastTs: 0,
          sentCount: 0,
        };
      }
      const cycle = g.cycleMap[tokenKey];
      cycle.entries.push(entry);
      if (entry.ts < cycle.firstTs) cycle.firstTs = entry.ts;
      if (entry.ts > cycle.lastTs) cycle.lastTs = entry.ts;
      if (!cycle.product && entry.product) cycle.product = entry.product;
      if (entry.converted) cycle.converted = true;
      if (entry.ok) cycle.sentCount++;
    }

    for (const g of Object.values(map)) {
      // Sort cycles chronologically (oldest first)
      g.cycles = Object.values(g.cycleMap).sort((a, b) => a.firstTs - b.firstTs);
      delete g.cycleMap;
      // Sort entries within each cycle chronologically
      for (const c of g.cycles) {
        c.entries.sort((a, b) => a.ts - b.ts);
      }
      // Customer-level product = most recent cycle's product
      g.product = g.cycles.length > 0 ? (g.cycles[g.cycles.length - 1].product || null) : null;
    }

    return Object.values(map).sort((a, b) => b.lastTs - a.lastTs);
  }, [logs]);

  if (loading) return <div className="flex items-center justify-center py-32"><RefreshCw size={20} className="text-textMute animate-spin" /></div>;

  const sentCount      = logs.filter(l => l.ok).length;
  const convertedCount = logs.filter(l => l.converted).length;
  const waAttributedLast4 = new Set(
    logs.filter(l => l.converted && l.ok).map(l => l.phone?.slice(-4)).filter(Boolean)
  );

  function toggleCustomer(key) {
    setExpandedCustomers(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">

      {/* ── Header & Tab Bar ── */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-greenSoft border border-green/20 shrink-0">
          <MessageCircle size={16} className="text-green" />
        </div>
        <div className="shrink-0">
          <h2 className="text-text font-bold text-sm">{t('flow.title')}</h2>
          <p className="text-textMute text-xs">{t('flow.subtitle')}</p>
        </div>
        {/* Tab navigation */}
        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-1 bg-surfaceAlt border border-border rounded-xl p-1">
            {[
              { id: 'dashboard', label: t('flow.tab_dashboard'), icon: BarChart2 },
              { id: 'settings',  label: t('flow.tab_settings'),  icon: Settings  },
              { id: 'optout',    label: t('flow.tab_optout'),    icon: Ban       },
            ].map(tab => (
              <button key={tab.id} onClick={() => setWaTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                  ${waTab === tab.id
                    ? 'bg-surface border border-border text-text shadow-sm'
                    : 'text-textMute hover:text-text'}`}>
                <tab.icon size={11} />
                {tab.label}
                {tab.id === 'optout' && optouts.length > 0 && (
                  <span className="bg-rose/20 text-rose px-1.5 py-px rounded-full text-[9px] font-bold">{optouts.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        {/* Enable/Disable toggle */}
        <button onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
          className="flex items-center gap-1.5 text-sm font-medium transition-colors shrink-0">
          {settings.enabled
            ? <><ToggleRight size={26} className="text-green" /><span className="text-green text-xs">{t('flow.active')}</span></>
            : <><ToggleLeft  size={26} className="text-textMute" /><span className="text-textMute text-xs">{t('flow.inactive')}</span></>}
        </button>
      </div>

      {/* ── DASHBOARD TAB ── */}
      {waTab === 'dashboard' && <>

        {/* Özet istatistikler */}
        {logs.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-surface border border-border rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-green">{sentCount}</p>
              <p className="text-textMute text-[10px]">{t('flow.sent')}</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 text-center cursor-pointer hover:border-blue/40 transition-colors"
              onClick={() => { setOrdersOpen(o => !o); if (!ordersOpen) fetchOrders(); }}>
              <p className="text-lg font-bold text-blue">{orders.length || '—'}</p>
              <p className="text-textMute text-[10px]">{t('flow.tracked')} {ordersOpen ? '▲' : '▼'}</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-emerald-500">{convertedCount}</p>
              <p className="text-textMute text-[10px]">{t('flow.wa_attr')}</p>
            </div>
            <div className="bg-surface border border-border rounded-xl p-3 text-center cursor-pointer hover:border-purple/40 transition-colors"
              onClick={() => setRoiOpen(o => !o)}>
              <p className="text-lg font-bold text-purple">
                {roi?.wa_revenue != null
                  ? `${roi.wa_revenue.toLocaleString('tr-TR', { minimumFractionDigits: 0 })} ${roi.currency || 'TRY'}`
                  : '—'}
              </p>
              <p className="text-textMute text-[10px]">{t('flow.roi_revenue')} {roiOpen ? '▲' : '▼'}</p>
            </div>
          </div>
        )}

        {/* WA Tracked Orders — stats kartına tıklayınca hemen altında açılır */}
        {ordersOpen && (
          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <ShoppingBag size={13} className="text-blue" />
              <div className="flex-1 min-w-0">
                <span className="text-text font-semibold text-sm">{t('flow.wa_orders')}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-textMute text-[10px]">{orders.length} {t('flow.total')}</span>
                  {convertedCount > 0 && (
                    <span className="text-[10px] bg-greenSoft text-green px-1.5 py-0.5 rounded-full">
                      {convertedCount} {t('flow.wa_attributed')}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={fetchOrders} className="p-1.5 rounded-lg bg-surfaceAlt border border-border text-textMute hover:text-text transition-colors">
                <RefreshCw size={11} />
              </button>
            </div>
            {orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <ShoppingBag size={18} className="text-textMute/40" />
                <p className="text-textMute text-xs">{t('flow.no_orders')}</p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[480px] overflow-y-auto">
                {orders.map((o, i) => (
                  <div key={o.order_id || i} className="px-4 py-3 hover:bg-surfaceAlt/40 transition-colors space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {o.order_number && (
                          <span className="text-[10px] font-bold text-green bg-greenSoft border border-green/20 px-1.5 py-0.5 rounded-full">
                            #{o.order_number}
                          </span>
                        )}
                        {o.wa_attributed && (
                          <span className="text-[10px] bg-purple/10 text-purple border border-purple/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                            <MessageCircle size={8} /> WA ✓
                          </span>
                        )}
                        {o.channel && o.channel !== 'Direct' && (
                          <span className="text-[10px] bg-surfaceAlt text-blue border border-blue/20 px-1.5 py-0.5 rounded-full">
                            {o.channel}
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-text">
                          {parseFloat(o.total_price || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {o.currency || 'TRY'}
                        </p>
                        <p className="text-[10px] text-textMute">{timeAgo(o.ts)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        {o.customer_name && <p className="text-xs font-semibold text-text truncate">{anonymized ? maskName(o.customer_name) : o.customer_name}</p>}
                        {o.phone && <p className="text-[10px] text-textMute font-mono">{anonymized ? '***••••' : `***${o.phone.slice(-4)}`}</p>}
                      </div>
                      {o.order_id && (
                        <button
                          onClick={e => { e.stopPropagation(); setJourneyOrderId(o.order_id); }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-blueSoft border border-blue/20 text-blue hover:bg-blue/10 transition-colors shrink-0">
                          <TrendingUp size={9} /> {t('ojrn.order_btn')}
                        </button>
                      )}
                    </div>
                    {o.line_items?.length > 0 && (
                      <div className="space-y-0.5">
                        {o.line_items.slice(0, 3).map((item, j) => (
                          <div key={j} className="flex items-center justify-between text-[10px] text-textMute">
                            <span className="truncate flex-1">{item.quantity}× {item.title}</span>
                            <span className="shrink-0 ml-2 tabular-nums">
                              {parseFloat(item.price || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                            </span>
                          </div>
                        ))}
                        {o.line_items.length > 3 && (
                          <p className="text-[10px] text-textMute/60">+{o.line_items.length - 3} {t('flow.more_items').replace('+{n} ', '')}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* WA ROI Panel */}
        {roiOpen && (
          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <TrendingUp size={13} className="text-purple" />
              <div className="flex-1 min-w-0">
                <span className="text-text font-semibold text-sm">{t('flow.roi_title')}</span>
                <p className="text-textMute text-[10px] mt-0.5">
                  {t('flow.roi_subtitle').replace('{days}', roiDays)}
                </p>
              </div>
              <div className="flex items-center gap-1 mr-1">
                {[7, 14, 30].map(d => (
                  <button key={d}
                    onClick={() => { setRoiDays(d); fetchRoi(d); }}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-colors ${roiDays === d ? 'bg-purple text-bg' : 'bg-surfaceAlt text-textMute hover:text-text border border-border'}`}>
                    {d}{t('flow.roi_days')}
                  </button>
                ))}
              </div>
              <button onClick={() => fetchRoi(roiDays)}
                className="p-1.5 rounded-lg bg-surfaceAlt border border-border text-textMute hover:text-text transition-colors">
                <RefreshCw size={11} />
              </button>
            </div>
            {(!roi || roi.wa_attributed_count === 0) ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <MessageCircle size={18} className="text-textMute/30" />
                <p className="text-textMute text-xs">{t('flow.roi_empty')}</p>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-surfaceAlt rounded-xl p-3 text-center border border-border">
                    <p className="text-base font-bold text-purple">{roi.wa_attributed_count}</p>
                    <p className="text-textMute text-[10px]">{t('flow.roi_orders')}</p>
                  </div>
                  <div className="bg-surfaceAlt rounded-xl p-3 text-center border border-border">
                    <p className="text-base font-bold text-green">
                      {roi.wa_revenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {roi.currency}
                    </p>
                    <p className="text-textMute text-[10px]">{t('flow.roi_revenue')}</p>
                  </div>
                  <div className="bg-surfaceAlt rounded-xl p-3 text-center border border-border">
                    <p className="text-base font-bold text-blue">
                      {roi.total_orders > 0 ? `${Math.round(roi.wa_attributed_count / roi.total_orders * 100)}%` : '—'}
                    </p>
                    <p className="text-textMute text-[10px]">{t('flow.roi_rate')}</p>
                  </div>
                </div>
                {roi.wa_orders?.length > 0 && (
                  <div className="space-y-1.5">
                    {roi.wa_orders.map((o, i) => (
                      <div key={o.order_id || i} className="flex items-center gap-2 px-3 py-2 bg-surfaceAlt rounded-xl border border-border">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className="text-[10px] font-bold text-green bg-greenSoft border border-green/20 px-1.5 py-0.5 rounded-full shrink-0">
                            #{o.order_number}
                          </span>
                          <span className="text-[10px] bg-purple/10 text-purple border border-purple/20 px-1.5 py-0.5 rounded-full shrink-0 flex items-center gap-0.5">
                            <MessageCircle size={8} /> WA ✓
                          </span>
                          {o.customer_name && (
                            <span className="text-xs text-text truncate">{anonymized ? maskName(o.customer_name) : o.customer_name}</span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold text-text tabular-nums">
                            {parseFloat(o.total_price || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {o.currency}
                          </p>
                          <p className="text-[10px] text-textMute">{timeAgo(o.ts)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Gönderim Geçmişi */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <FileText size={13} className="text-textDim" />
            <span className="text-text font-semibold text-sm flex-1">{t('flow.history')}</span>
            <span className="text-textMute text-xs">{logs.length} {t('flow.records')}</span>
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
            <div className="overflow-y-auto max-h-[600px] p-3 space-y-2 custom-scrollbar">
              {customerGroups.length === 0 ? (
                <div className="py-10 text-center">
                  <MessageCircle size={18} className="text-textMute mx-auto mb-2" />
                  <p className="text-textMute text-sm">{t('flow.no_sends')}</p>
                </div>
              ) : customerGroups.map(group => {
                const isOpen = expandedCustomers.has(group.key);
                return (
                  <div key={group.key} className={`rounded-xl border overflow-hidden transition-colors
                    ${group.converted ? 'border-green/30' : group.cooldownCount > 0 ? 'border-amber/20' : 'border-border'}`}>
                    {/* Müşteri özet satırı */}
                    <div onClick={() => toggleCustomer(group.key)}
                      className="flex items-center gap-2.5 p-3 cursor-pointer hover:bg-surfaceAlt/40 transition-colors">
                      <div className="shrink-0">
                        {group.converted
                          ? <ShoppingBag size={13} className="text-green" />
                          : group.sentCount > 0
                            ? <CheckCircle size={13} className="text-green" />
                            : <Clock size={13} className="text-amber" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-text font-semibold text-xs">{anonymized ? maskName(group.name) : group.name}</span>
                          <span className="text-textMute text-[10px] font-mono">{anonymized ? maskPhone(group.phone) : group.phone}</span>
                          {group.converted && (
                            <span className="text-[10px] bg-greenSoft text-green border border-green/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                              <ShoppingBag size={8} />{t('flow.ordered')}
                            </span>
                          )}
                        </div>
                        {group.product && (
                          <p className="text-[10px] text-textMute truncate max-w-[220px] mt-0.5">{group.product}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] bg-surfaceAlt text-textDim px-1.5 py-0.5 rounded-full">
                          {group.sentCount} {t('flow.sent')}
                          {group.cycles.length > 1 && ` · ${group.cycles.length} döngü`}
                          {group.cooldownCount > 0 && ` · ${group.cooldownCount} atlandı`}
                        </span>
                        <span className="text-textMute text-[10px]">
                          {new Date(group.firstTs).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isOpen ? <ChevronUp size={11} className="text-textMute" /> : <ChevronDown size={11} className="text-textMute" />}
                      </div>
                    </div>

                    {/* Açılan journey timeline — döngü bazlı */}
                    {isOpen && (
                      <div className="border-t border-border/60 px-4 pt-2.5 pb-3 bg-surfaceAlt/20 space-y-3">
                        {group.cycles.map((cycle, cycleIdx) => {
                          const cycleStart = new Date(cycle.firstTs).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit' });
                          const cycleEnd   = new Date(cycle.lastTs).toLocaleString('tr-TR',  { day: '2-digit', month: '2-digit' });
                          const sameDay    = cycleStart === cycleEnd;
                          return (
                            <div key={cycle.token || cycleIdx}>
                              {/* Döngü başlık bandı */}
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <div className="h-px flex-1 bg-border/60" />
                                <span className="text-[10px] text-textMute font-medium shrink-0 flex items-center gap-1">
                                  <span className="bg-surfaceAlt border border-border px-1.5 py-0.5 rounded-full text-textDim">
                                    #{cycleIdx + 1}
                                  </span>
                                  {cycle.product && (
                                    <span className="max-w-[160px] truncate text-text">{cycle.product}</span>
                                  )}
                                  <span className="text-textMute">
                                    {sameDay ? cycleStart : `${cycleStart} → ${cycleEnd}`}
                                  </span>
                                  {cycle.converted && (
                                    <span className="bg-greenSoft text-green border border-green/20 px-1 py-0.5 rounded flex items-center gap-0.5">
                                      <ShoppingBag size={8} />{t('flow.ordered')}
                                    </span>
                                  )}
                                </span>
                                <div className="h-px flex-1 bg-border/60" />
                              </div>

                              {/* Adımlar */}
                              <div className="space-y-0">
                                {cycle.entries.map((entry, i) => {
                                  const isCooldown = entry.status === 'cooldown_skip';
                                  const isLast     = i === cycle.entries.length - 1;
                                  return (
                                    <div key={i} className="flex gap-2.5">
                                      <div className="flex flex-col items-center shrink-0 pt-1">
                                        <div className={`w-2 h-2 rounded-full shrink-0
                                          ${isCooldown ? 'bg-amber' : entry.ok ? 'bg-green' : 'bg-rose'}`} />
                                        {!isLast && <div className="w-px bg-border flex-1 mt-0.5 mb-0.5" style={{ minHeight: '14px' }} />}
                                      </div>
                                      <div className={`flex-1 min-w-0 flex items-start justify-between gap-2 ${!isLast ? 'pb-2' : 'pb-0.5'}`}>
                                        <div className="min-w-0">
                                          {isCooldown ? (
                                            <span className="text-[11px] text-amber flex items-center gap-1">
                                              <Clock size={10} />{t('flow.cooldown_skip')}
                                            </span>
                                          ) : (
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className={`text-[11px] font-medium ${entry.ok ? 'text-text' : 'text-rose'}`}>
                                                {entry.ok ? '✓' : '✗'} {entry.step_label || `Step ${(entry.step ?? 0) + 1}`}
                                              </span>
                                              {entry.converted && (
                                                <span className="text-[10px] bg-greenSoft text-green px-1 py-0.5 rounded flex items-center gap-0.5">
                                                  <ShoppingBag size={8} />{t('flow.post_order_lbl')}
                                                </span>
                                              )}
                                              {entry.error && (
                                                <span className="text-[10px] text-rose">{entry.error}</span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        <span className="text-textMute text-[10px] whitespace-nowrap shrink-0">
                                          {new Date(entry.ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        {/* Sipariş verildi satırı (genel) */}
                        {group.converted && (
                          <div className="flex gap-2.5 pt-0.5">
                            <div className="flex flex-col items-center shrink-0 pt-1">
                              <div className="w-2 h-2 rounded-full bg-green shrink-0" />
                            </div>
                            <span className="text-[11px] text-green font-semibold flex items-center gap-1 pb-0.5">
                              <ShoppingBag size={11} />{t('flow.order_placed')}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </>}

      {/* ── SETTINGS TAB ── */}
      {waTab === 'settings' && (
        <div className="max-w-2xl mx-auto space-y-4">

          {/* Bağlantı ayarları */}
          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <button onClick={() => setConnOpen(o => !o)}
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surfaceAlt/40 transition-colors">
              <Key size={13} className="text-textDim shrink-0" />
              <span className="flex-1 text-left text-textDim font-semibold text-xs uppercase tracking-wide">{t('flow.connection')}</span>
              {maskedToken && <span className="text-[10px] text-green bg-greenSoft px-2 py-0.5 rounded-full">{t('flow.connected')}</span>}
              {connOpen ? <ChevronUp size={13} className="text-textMute shrink-0" /> : <ChevronDown size={13} className="text-textMute shrink-0" />}
            </button>
            {connOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-border/60">
                <div className="space-y-1.5 pt-3">
                  <label className="text-[10px] font-semibold text-textMute uppercase tracking-wide">{t('flow.wa_token')}</label>
                  <div className="relative">
                    <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMute" />
                    {anonymized
                      ? <div className="w-full bg-surfaceAlt border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-textMute tracking-widest">• • • • • • • •</div>
                      : <input type="password" value={settings.wa_token} onChange={e => setSettings(s => ({ ...s, wa_token: e.target.value }))}
                          placeholder={maskedToken || 'EAAxxxxxxx…'}
                          className="w-full bg-surfaceAlt border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text placeholder:text-textMute focus:outline-none focus:border-green/60 transition-colors" />
                    }
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-textMute uppercase tracking-wide">{t('flow.phone_id')}</label>
                  <div className="relative">
                    <Hash size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMute" />
                    {anonymized
                      ? <div className="w-full bg-surfaceAlt border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-textMute tracking-widest">• • • • • •</div>
                      : <input value={settings.phone_number_id} onChange={e => setSettings(s => ({ ...s, phone_number_id: e.target.value }))}
                          placeholder="123456789012345"
                          className="w-full bg-surfaceAlt border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text placeholder:text-textMute focus:outline-none focus:border-green/60 transition-colors" />
                    }
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sequence */}
          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <button onClick={() => setSeqOpen(o => !o)}
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surfaceAlt/40 transition-colors">
              <MessageSquare size={13} className="text-textDim shrink-0" />
              <span className="flex-1 text-left text-textDim font-semibold text-xs uppercase tracking-wide">{t('flow.cart_seq')}</span>
              <span className="text-[10px] text-textMute mr-1">{settings.sequence.filter(s => s.enabled).length}/{settings.sequence.length} {t('flow.active')}</span>
              {seqOpen ? <ChevronUp size={13} className="text-textMute shrink-0" /> : <ChevronDown size={13} className="text-textMute shrink-0" />}
            </button>
            {seqOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-border/60">
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
                  <div className="grid grid-cols-3 gap-2 pl-7">
                    <div>
                      <p className="text-[10px] text-textMute mb-1">{t('flow.delay')}</p>
                      <div className="flex items-center gap-1.5">
                        <input type="number" min={5} max={43200} value={step.delay_minutes}
                          onChange={e => updateStep(idx, { delay_minutes: parseInt(e.target.value) || 15 })}
                          className="w-16 bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text text-center focus:outline-none focus:border-green/60" />
                        <span className="text-textMute text-[10px]">dk · {fmtDelay(step.delay_minutes, lang)}</span>
                      </div>
                    </div>
                <div>
                  <p className="text-[10px] text-textMute mb-1">{t('flow.template')}</p>
                  <input value={step.template} onChange={e => updateStep(idx, { template: e.target.value })}
                    className="w-full bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text font-mono focus:outline-none focus:border-green/60" />
                </div>
                <div>
                  <p className="text-[10px] text-textMute mb-1">{t('flow.language')}</p>
                  <select value={step.language || 'tr'} onChange={e => updateStep(idx, { language: e.target.value })}
                    className="w-full bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text focus:outline-none focus:border-green/60">
                    <option value="tr">TR</option>
                    <option value="en">EN</option>
                    <option value="en_US" style={{display:'none'}}>en_US</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Duplicate önleme — cooldown */}
        <div className="mt-1 pt-3 border-t border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-amber shrink-0" />
            <div>
              <p className="text-xs font-medium text-text">{t('flow.cooldown')}</p>
              <p className="text-[10px] text-textMute">{t('flow.cooldown_sub')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input type="number" min={1} max={168} value={settings.cooldown_hours}
              onChange={e => setSettings(s => ({ ...s, cooldown_hours: parseInt(e.target.value) || 48 }))}
              className="w-14 bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text text-center focus:outline-none focus:border-amber/60" />
            <span className="text-textMute text-[10px]">{t('flow.hrs')}</span>
          </div>
        </div>

        {/* Gönderim penceresi */}
        <div className="mt-1 pt-3 border-t border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-blue shrink-0" />
            <div>
              <p className="text-xs font-medium text-text">{t('flow.send_window')}</p>
              <p className="text-[10px] text-textMute">{t('flow.send_window_sub')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input type="number" min={0} max={23} value={settings.send_window_start}
              onChange={e => setSettings(s => ({ ...s, send_window_start: parseInt(e.target.value) ?? 9 }))}
              className="w-12 bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text text-center focus:outline-none focus:border-blue/60" />
            <span className="text-textMute text-[10px]">–</span>
            <input type="number" min={1} max={24} value={settings.send_window_end}
              onChange={e => setSettings(s => ({ ...s, send_window_end: parseInt(e.target.value) ?? 21 }))}
              className="w-12 bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text text-center focus:outline-none focus:border-blue/60" />
            <span className="text-textMute text-[10px]">:00</span>
          </div>
        </div>

        {/* Minimum sepet tutarı */}
        <div className="mt-1 pt-3 border-t border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <ShoppingBag size={12} className="text-green shrink-0" />
            <div>
              <p className="text-xs font-medium text-text">{t('flow.min_cart')}</p>
              <p className="text-[10px] text-textMute">{t('flow.min_cart_sub')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input type="number" min={0} max={99999} step={50} value={settings.min_cart_value}
              onChange={e => setSettings(s => ({ ...s, min_cart_value: parseFloat(e.target.value) || 0 }))}
              className="w-20 bg-surfaceAlt border border-border rounded-lg px-2 py-1 text-xs text-text text-center focus:outline-none focus:border-green/60" />
            <span className="text-textMute text-[10px]">TRY</span>
          </div>
        </div>
        </div>
        )}
      </div>

      {/* Sipariş onayı */}
      <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingBag size={13} className="text-blue shrink-0" />
          <div className="flex-1">
            <p className="text-text font-semibold text-sm">{t('flow.order_confirm')}</p>
            <p className="text-textMute text-[10px]">{t('flow.order_confirm_sub')}</p>
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
        {saved ? t('flow.saved') : saving ? t('flow.saving') : t('flow.save')}
      </button>

      {/* Test */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <button onClick={() => setTestOpen(o => !o)}
          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surfaceAlt/40 transition-colors">
          <Send size={13} className="text-textDim shrink-0" />
          <span className="flex-1 text-left text-textDim font-semibold text-xs uppercase tracking-wide">{t('flow.test')}</span>
          {testOpen ? <ChevronUp size={13} className="text-textMute shrink-0" /> : <ChevronDown size={13} className="text-textMute shrink-0" />}
        </button>
        {testOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/60 pt-3">
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
            {testLoading ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />} {t('flow.send_btn')}
          </button>
        </div>
        {testResult && (
          <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm border ${testResult.ok ? 'bg-greenSoft border-green/20 text-green' : 'bg-roseSoft border-rose/20 text-rose'}`}>
            {testResult.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
            {testResult.ok ? `Sent — ID: ${testResult.message_id}` : (testResult.error || 'Failed')}
          </div>
        )}
        </div>
        )}
      </div>

        </div>
      )}

      {/* ── OPT-OUT TAB ── */}
      {waTab === 'optout' && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
              <div className="p-2 rounded-xl bg-roseSoft border border-rose/20 shrink-0">
                <Ban size={14} className="text-rose" />
              </div>
              <div className="flex-1">
                <p className="text-text font-semibold text-sm">
                  Opt-out {optouts.length > 0 && <span className="text-textMute font-normal text-xs ml-1">({optouts.length})</span>}
                </p>
                <p className="text-textMute text-[10px] mt-0.5">{t('flow.optout_sub')}</p>
              </div>
              <button onClick={fetchOptouts} className="p-1.5 rounded-lg bg-surfaceAlt border border-border text-textMute hover:text-text transition-colors">
                <RefreshCw size={11} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <UserX size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMute" />
                  <input type="tel" value={optoutPhone} onChange={e => setOptoutPhone(e.target.value)}
                    placeholder="+905551234567" onKeyDown={e => e.key === 'Enter' && handleAddOptout()}
                    className="w-full bg-surfaceAlt border border-border rounded-xl pl-8 pr-4 py-2 text-sm text-text placeholder:text-textMute focus:outline-none focus:border-rose/40 transition-colors" />
                </div>
                <button onClick={handleAddOptout} disabled={!optoutPhone.trim()}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs bg-roseSoft border border-rose/20 text-rose hover:bg-rose/20 transition-colors disabled:opacity-40 shrink-0">
                  <Plus size={12} /> {t('flow.add')}
                </button>
              </div>
              {optouts.length === 0
                ? <p className="text-textMute text-xs text-center py-3">{t('flow.empty_list')}</p>
                : <div className="space-y-1 max-h-96 overflow-y-auto custom-scrollbar">
                    {optouts.map(phone => (
                      <div key={phone} className="flex items-center gap-2 px-3 py-1.5 bg-roseSoft/50 border border-rose/15 rounded-lg">
                        <span className="text-xs text-rose flex-1 font-mono">{anonymized ? maskPhone(phone) : phone}</span>
                        <button onClick={() => handleRemoveOptout(phone)} disabled={removingOptout === phone}
                          className="text-textMute hover:text-rose transition-colors disabled:opacity-40">
                          {removingOptout === phone ? <RefreshCw size={11} className="animate-spin" /> : <Minus size={12} />}
                        </button>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </div>
        </div>
      )}

      {/* Order Journey Modal */}
      {journeyOrderId && (
        <OrderJourneyModal
          orderId={journeyOrderId}
          session={session}
          onClose={() => setJourneyOrderId(null)}
        />
      )}

    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({ session, onLogout }) {
  const { t, lang } = useLang();
  const { token, username, brand, tid } = session;
  const qs = `username=${encodeURIComponent(username)}&brand=${encodeURIComponent(brand)}`;

  // Shopify mağaza domain'i — App Embeds linki için
  const shopifyShop = sessionStorage.getItem('spt_shopify_shop') || '';
  const themeEditorUrl = shopifyShop
    ? `https://${shopifyShop}/admin/themes/current/editor?context=apps`
    : null;

  // Onboarding modal — ilk girişte telefon numarası sor
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('spt_onboarding_done');
  });
  function closeOnboarding() {
    localStorage.setItem('spt_onboarding_done', '1');
    setShowOnboarding(false);
  }

  // Billing status
  const [billingError, setBillingError] = useState(null); // null | { error, message, retry_url }
  const [trialDays, setTrialDays]       = useState(null); // kalan deneme günü

  useEffect(() => {
    fetch(`${API_URL}/api/auth/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (r.status === 402) return r.json().then(d => { setBillingError(d.detail || d); });
        return r.json().then(d => { if (d.trial_remaining_days != null) setTrialDays(d.trial_remaining_days); });
      })
      .catch(() => {});
  }, [token]);

  const [anonymized, setAnonymized] = useState(false);
  const [activeView, setActiveView] = useState('live');
  const [liveTab, setLiveTab]           = useState('realtime');
  const [prodOpen, setProdOpen]         = useState(true);
  const [collOpen, setCollOpen]         = useState(false);
  const [searchOpen, setSearchOpen]     = useState(false);
  const [pageOpen, setPageOpen]         = useState(false);
  const [notFoundOpen, setNotFoundOpen] = useState(false);
  const [utmOpen, setUtmOpen]           = useState(true);
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
  const [effectiveTid, setEffectiveTid] = useState(tid);
  const [webhookStatus, setWebhookStatus]   = useState(null);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [convertedOrders, setConvertedOrders] = useState([]);

  const esRef        = useRef(null);
  const pausedRef    = useRef(false);
  const uidCounter   = useRef(0);
  const customerCache = useRef({});
  const retryRef     = useRef(null);
  const fetchOrdersRef = useRef(null);

  const connectSSE = useCallback(() => {
    if (!effectiveTid || !token) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    clearTimeout(retryRef.current);
    setSseStatus('connecting');

    const url = `${API_URL}/api/live/stream?tid=${encodeURIComponent(effectiveTid)}&token=${encodeURIComponent(token)}`;
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

        if (ev.event_type === 'checkout_completed') {
          playOrderSound();
          fetchOrdersRef.current?.();
          if ('Notification' in window && Notification.permission === 'granted') {
            const price = ev.data?.total_price;
            const amt = price ? ` — ₺${parseFloat(price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '';
            new Notification(`🛍️ ${t('notif.new_order')}${amt}`, {
              body: ev.data?.customer_name ? `${t('notif.customer')} ${ev.data.customer_name}` : t('notif.order_body'),
              icon: '/favicon.ico',
              tag: 'order',
            });
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
  }, [effectiveTid, token]);

  useEffect(() => {
    connectSSE();
    return () => {
      clearTimeout(retryRef.current);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [connectSSE]);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const fetchPixelStatus = useCallback(async () => {
    setPixelLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/shopify/pixel/status?${qs}`);
      const data = await r.json();
      setPixelStatus(data);
      if (!tid && data?.tracking_id) setEffectiveTid(data.tracking_id);
    } catch { setPixelStatus(null); }
    setPixelLoading(false);
  }, [qs, tid]);

  useEffect(() => { fetchPixelStatus(); }, [fetchPixelStatus]);

  const fetchConvertedOrders = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/flow/orders?${qs}&limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (d.ok) setConvertedOrders(d.orders || []);
    } catch {}
  }, [qs, token]);

  useEffect(() => { fetchOrdersRef.current = fetchConvertedOrders; }, [fetchConvertedOrders]);
  useEffect(() => { fetchConvertedOrders(); }, [fetchConvertedOrders]);

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
    if (!confirm(t('pixel.uninstall_confirm'))) return;
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

  const todayRevenue = useMemo(() => {
    const nowTR = Date.now() + 3 * 3_600_000;
    const startOfDayTR = nowTR - (nowTR % 86_400_000);
    const startMs = startOfDayTR - 3 * 3_600_000;
    // SSE event'lerinden gelen siparişler (order_id ile dedup için sakla)
    const eventOrderIds = new Set(
      events.filter(ev => ev.event_type === 'checkout_completed' && ev.data?.order_id)
            .map(ev => ev.data.order_id)
    );
    const fromEvents = events
      .filter(ev => ev.event_type === 'checkout_completed' && ev.ts >= startMs)
      .reduce((sum, ev) => sum + parseFloat(ev.data?.total_price || 0), 0);
    // WA orders listesinden, SSE'de olmayanlar (checkout_completed event push edilmemiş siparişler)
    const fromOrders = convertedOrders
      .filter(o => o.ts >= startMs && !eventOrderIds.has(o.order_id))
      .reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
    return fromEvents + fromOrders;
  }, [events, convertedOrders]);

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
      // Scroll depth — en yüksek değeri tut
      if (ev.event_type === 'scroll_depth' && ev.data?.depth) {
        if (!p.maxScrollDepth || ev.data.depth > p.maxScrollDepth) p.maxScrollDepth = ev.data.depth;
      }
      // Attention time — en son ürün sayfasındaki süre
      if (ev.event_type === 'attention_time' && ev.data?.seconds) {
        if (!p.attentionSeconds || ev.data.seconds > p.attentionSeconds) p.attentionSeconds = ev.data.seconds;
      }
    }
    // Cross-reference with WA converted orders — handles case where checkout_completed
    // event was never pushed (guest checkout / server restart lost in-memory session dict)
    const convertedVids = new Set(convertedOrders.map(o => o.vid).filter(Boolean));
    const ordersWithoutVid = convertedOrders.filter(o => !o.vid);
    for (const p of Object.values(map)) {
      if (p.stage === 'converted') continue;
      if (convertedVids.has(p.vid)) {
        p.stage = 'converted';
      } else if (p.stage === 'checkout' && ordersWithoutVid.length > 0) {
        // Timestamp fallback: order placed after visitor's last activity, within 2 hours
        const matched = ordersWithoutVid.some(o => o.ts >= p.lastTs && o.ts - p.lastTs < 120 * 60 * 1000);
        if (matched) p.stage = 'converted';
      }
    }
    const nowTR = Date.now() + 3 * 3_600_000;
    const todayStartMs = (nowTR - (nowTR % 86_400_000)) - 3 * 3_600_000;
    return Object.values(map)
      .map(p => {
        const isReturning = p.firstTs < todayStartMs && p.lastTs >= todayStartMs;
        return { ...p, isReturning, intentScore: calcIntentScore({ ...p, isReturning }) };
      })
      .sort((a, b) => b.lastTs - a.lastTs);
  }, [events, convertedOrders]);

  const memberCount = useMemo(() => visitorProfiles.filter(p => p.customer_id).length, [visitorProfiles]);

  // Abandonment Intelligence: cart/checkout ziyaretçileri risk skoruyla birlikte
  const atRiskVisitors = useMemo(() => {
    const now = Date.now();
    return visitorProfiles
      .filter(p => ['cart', 'checkout'].includes(p.stage) && (now - p.lastTs) > 3 * 60 * 1000)
      .map(p => ({ ...p, riskScore: calcAbandonmentRisk(p, now) }))
      .sort((a, b) => b.riskScore - a.riskScore);
  }, [visitorProfiles]);

  // Eski "abandonedVisitors" (checkout + >15 dk) — StatCard ve eski referanslar için
  const abandonedVisitors = useMemo(() =>
    atRiskVisitors.filter(p => p.stage === 'checkout' && (Date.now() - p.lastTs) > 15 * 60 * 1000)
  , [atRiskVisitors]);

  // #5 Stok-Talep Alarm: son 30 dk içinde aynı ürüne 2+ eş zamanlı bakan aktif ziyaretçiler
  const hotProducts = useMemo(() => {
    const now = Date.now();
    const counts = {};
    visitorProfiles
      .filter(p => now - p.lastTs < 30 * 60 * 1000 && p.stage !== 'converted' && p.lastProduct)
      .forEach(p => {
        if (!counts[p.lastProduct]) counts[p.lastProduct] = { viewers: 0, cartAdders: 0 };
        counts[p.lastProduct].viewers++;
        if (['cart', 'checkout'].includes(p.stage)) counts[p.lastProduct].cartAdders++;
      });
    return Object.entries(counts)
      .filter(([, v]) => v.viewers >= 2)
      .map(([title, v]) => ({ title, ...v }))
      .sort((a, b) => b.viewers - a.viewers || b.cartAdders - a.cartAdders)
      .slice(0, 8);
  }, [visitorProfiles]);

  // #10 Görünmez Sepet Dedektörü: add_to_cart eventi var ama şu an browsing/product stage'inde
  const hiddenCartVisitors = useMemo(() => {
    const now = Date.now();
    return visitorProfiles
      .filter(p => {
        const hasCartEvent = p.events.some(e => e.event_type === 'add_to_cart');
        const notInCart    = !['cart', 'checkout', 'converted'].includes(p.stage);
        const recentlyActive = now - p.lastTs < 2 * 60 * 60 * 1000;
        return hasCartEvent && notInCart && recentlyActive;
      })
      .map(p => {
        const cartEvs = p.events.filter(e => e.event_type === 'add_to_cart');
        const cartProducts = [...new Set(cartEvs.map(e => e.data?.product_title || e.data?.product_id || '').filter(Boolean))];
        const lastCartTs   = Math.max(...cartEvs.map(e => e.ts));
        return { ...p, cartProducts, lastCartTs };
      })
      .sort((a, b) => b.lastCartTs - a.lastCartTs);
  }, [visitorProfiles]);

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

  // Billing expired — tam ekran overlay
  if (billingError) {
    const retryUrl = billingError.retry_url || '';
    const isExpired = billingError.error === 'trial_expired';
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div className="bg-surface border border-border rounded-2xl p-8 max-w-md w-full text-center space-y-5">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto">
            <AlertCircle size={22} className="text-amber-500" />
          </div>
          <div>
            <h2 className="text-text font-bold text-lg">{isExpired ? 'Deneme Süreniz Doldu' : 'Abonelik Gerekli'}</h2>
            <p className="text-textMute text-sm mt-2">{billingError.message || 'Shoptimize Live\'ı kullanmak için aboneliğinizi aktive edin.'}</p>
          </div>
          {retryUrl && (
            <a href={retryUrl}
              className="block w-full py-2.5 rounded-xl bg-green text-bg font-semibold text-sm hover:bg-green/90 transition-colors">
              Aboneliği Aktive Et
            </a>
          )}
          <button onClick={onLogout} className="text-textMute text-xs hover:text-text transition-colors">
            Çıkış Yap
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg p-4">
    {/* Onboarding modal — ilk girişte göster */}
    {showOnboarding && <OnboardingModal token={token} onClose={closeOnboarding} />}

    {/* Trial banner — son 2 günde uyarı göster */}
    {trialDays != null && trialDays <= 2 && (
      <div className="mb-3 flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-600 text-xs font-medium">
        <AlertCircle size={13} className="shrink-0" />
        <span>Deneme sürenizin bitmesine <strong>{trialDays}</strong> gün kaldı. Devam etmek için aboneliğinizi aktive edin.</span>
      </div>
    )}

    <div className="w-full space-y-4">

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
              ? <><span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" /> {t('status.live')}</>
              : sseStatus === 'connecting'
              ? <><span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" /> {t('status.connecting')}</>
              : <><WifiOff size={12} /> {t('status.disconnected')}</>}
          </div>
          {/* View switcher */}
          <div className="flex items-center gap-1 bg-surfaceAlt border border-border rounded-lg p-0.5">
            <button onClick={() => setActiveView('live')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${activeView === 'live' ? 'bg-surface text-text shadow-sm' : 'text-textMute hover:text-text'}`}>
              <Radio size={11} /> {t('nav.live')}
            </button>
            <button onClick={() => setActiveView('flow')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${activeView === 'flow' ? 'bg-surface text-text shadow-sm' : 'text-textMute hover:text-text'}`}>
              <MessageCircle size={11} /> {t('nav.wa')}
            </button>
          </div>
          <LangSwitch />
          <ThemeSwitch />
          <button onClick={() => setAnonymized(a => !a)}
            title={anonymized ? t('nav.anonymized') : t('nav.anonymize')}
            className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs font-bold rounded-full transition-colors
              ${anonymized
                ? 'bg-amber/10 border-amber/40 text-amber hover:bg-amber/20'
                : 'bg-surfaceAlt border-border text-textDim hover:text-text'}`}>
            {anonymized ? <EyeOff size={12} /> : <Eye size={12} />}
            {anonymized ? t('nav.anonymized') : t('nav.anonymize')}
          </button>
          <button onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surfaceAlt border border-borderStrong text-textDim text-xs font-bold rounded-full hover:text-text transition-colors">
            <LogOut size={12} /> {t('nav.logout')}
          </button>
        </div>
      </div>

      {/* WA Otomasyon view */}
      {activeView === 'flow' && <FlowPanel session={session} anonymized={anonymized} />}

      {activeView === 'live' && <>

      {/* Pixel panel — always visible */}
      <div className={`rounded-xl border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3
        ${pixelStatus?.installed ? 'bg-greenSoft/50 border-green/20' : 'bg-surfaceAlt/50 border-borderStrong'}`}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${pixelStatus?.installed ? 'bg-greenSoft' : 'bg-surfaceAlt/40'}`}>
            <Zap size={16} className={pixelStatus?.installed ? 'text-green' : 'text-textDim'} />
          </div>
          <div>
            <p className={`text-sm font-bold ${pixelStatus?.installed ? 'text-green' : 'text-text'}`}>
              {pixelStatus?.installed ? t('pixel.installed') : t('pixel.not_installed')}
            </p>
            <p className="text-textMute text-[10px]">
              {pixelStatus?.installed
                ? `${t('pixel.tracking_id')}: ${pixelStatus.tracking_id || '—'}`
                : themeEditorUrl
                  ? t('pixel.embed_hint')
                  : t('pixel.install_prompt')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pixelStatus?.detected_via === 'events' ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-greenSoft border border-green/20 text-green text-xs font-bold rounded-lg">
              <CheckCircle size={11} /> {t('pixel.active_via_shopify')}
            </span>
          ) : (
            <>
              {pixelStatus?.installed && (
                <button onClick={handleRegisterWebhook} disabled={webhookLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors disabled:opacity-50
                    ${webhookStatus?.registered
                      ? 'bg-greenSoft border-green/20 text-green'
                      : 'bg-blueSoft border-blue/20 text-blue hover:bg-blueSoft/80'}`}>
                  {webhookLoading ? <><RefreshCw size={11} className="animate-spin" /> {t('pixel.installing')}</>
                    : webhookStatus?.registered ? <><CheckCircle size={11} /> {t('pixel.order_active')}</>
                    : <><Zap size={11} /> {t('pixel.order_setup')}</>}
                </button>
              )}
              {pixelStatus?.installed
                ? <button onClick={handleUninstall} disabled={installing || pixelLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-roseSoft border border-rose/20 text-rose text-xs font-bold rounded-lg hover:bg-roseSoft/80 transition-colors disabled:opacity-50">
                    <Trash2 size={12} /> {t('pixel.remove')}
                  </button>
                : themeEditorUrl
                  ? <a
                      href={themeEditorUrl}
                      target="_top"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-green to-teal text-bg text-xs font-bold rounded-lg hover:brightness-105 transition-all shadow-lg no-underline"
                    >
                      <ExternalLink size={12} /> {t('pixel.open_theme_editor')}
                    </a>
                  : <button onClick={handleInstall} disabled={installing || pixelLoading}
                      className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-green to-teal text-bg text-xs font-bold rounded-lg hover:brightness-105 transition-all disabled:opacity-50 shadow-lg">
                      {installing ? <><RefreshCw size={12} className="animate-spin" /> {t('pixel.installing')}</> : <><Zap size={12} /> {t('pixel.one_click')}</>}
                    </button>
              }
            </>
          )}
        </div>
      </div>

      {/* Inner tab switcher */}
      <div className="flex justify-center">
        <div className="flex items-center gap-1 bg-surfaceAlt border border-border rounded-xl p-1">
          <button onClick={() => setLiveTab('realtime')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${liveTab === 'realtime' ? 'bg-surface border border-border text-text shadow-sm' : 'text-textMute hover:text-text'}`}>
            <Radio size={11} /> {t('nav.realtime')}
          </button>
          <button onClick={() => setLiveTab('analytics')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${liveTab === 'analytics' ? 'bg-surface border border-border text-text shadow-sm' : 'text-textMute hover:text-text'}`}>
            <BarChart2 size={11} /> {t('nav.analytics')}
          </button>
        </div>
      </div>

      {/* ── CANLI TAB ── */}
      {liveTab === 'realtime' && (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] xl:grid-cols-[1fr_2fr] gap-4 items-start">

          {/* SOL — KPIs, Abandoned, Funnel */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label={t('stat.events')} sub={t('stat.events_sub')} value={events.length} icon={Activity} color="blue" pulse={sseStatus === 'connected'}
                onClick={() => setDrillDown({ title: t('drill.all_events'), subtitle: `${events.length} events`, products: productStats.slice(0, 20), visitors: visitorProfiles })} />
              <StatCard label={t('stat.visitors')} sub={t('stat.visitors_sub')} value={uniqueVisitorCount} icon={Users} color="purple"
                onClick={() => setDrillDown({ title: t('drill.visitors'), subtitle: `${uniqueVisitorCount} ${t('common.visitors')} · ${visitorProfiles.filter(v => v.isReturning).length} ${t('visitors.returning')}`, products: productStats.slice(0, 20), visitors: visitorProfiles })} />
              <StatCard label={t('stat.members')} sub={t('stat.members_sub')} value={memberCount} icon={CheckCircle} color="teal"
                onClick={() => setDrillDown({ title: t('drill.members'), subtitle: `${memberCount} ${t('stat.members')}`,
                  products: productStats.filter(p => events.some(ev => ev.event_type === 'product_viewed' && visitorProfiles.find(v => v.vid === ev.vid && v.customer_id) && (ev.data?.product_id === p.key || ev.data?.product_title === p.key))),
                  visitors: visitorProfiles.filter(v => v.customer_id) })} />
              <StatCard label={t('stat.cart')} sub={t('stat.cart_sub')} value={evStats['add_to_cart'] || 0} icon={ShoppingCart} color="emerald"
                onClick={() => setDrillDown({ title: t('drill.cart_products'), subtitle: `${evStats['add_to_cart'] || 0} ${t('stat.cart_sub')}`,
                  products: productStats.filter(p => p.carts > 0).sort((a, b) => b.carts - a.carts),
                  visitors: visitorProfiles.filter(v => ['cart','checkout','converted'].includes(v.stage)) })} />
              <StatCard label={t('stat.checkout')} sub={t('stat.checkout_sub')} value={evStats['checkout_started'] || 0} icon={CreditCard} color="yellow"
                onClick={() => setDrillDown({ title: t('drill.checkout_visitors'), subtitle: `${evStats['checkout_started'] || 0} ${t('stat.checkout_sub')}`,
                  products: productStats.slice(0, 20),
                  visitors: visitorProfiles.filter(v => ['checkout','converted'].includes(v.stage)) })} />
              <StatCard label={t('stat.orders')} sub={t('stat.orders_sub')} value={Math.max(evStats['checkout_completed'] || 0, convertedOrders.length)} icon={CheckCircle} color="emerald"
                onClick={() => setDrillDown({ title: t('drill.orders'), subtitle: `${Math.max(evStats['checkout_completed'] || 0, convertedOrders.length)} ${t('stat.orders')}`,
                  products: [], visitors: visitorProfiles.filter(v => v.stage === 'converted') })} />
              <StatCard label={t('stat.revenue')} sub={t('stat.revenue_sub')} value={todayRevenue > 0 ? fmtRevenue(todayRevenue) : (convertedOrders.length > 0 ? fmtRevenue(convertedOrders.reduce((s,o) => s + parseFloat(o.total_price||0), 0)) + '*' : '—')} icon={TrendingUp} color="green"
                onClick={() => setDrillDown({ title: t('drill.revenue'), subtitle: `Today: ₺${todayRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} · WA Total: ₺${convertedOrders.reduce((s,o) => s + parseFloat(o.total_price||0), 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`,
                  products: [], visitors: visitorProfiles.filter(v => v.stage === 'converted') })} />
              <StatCard label={t('stat.abandoned')} sub={t('stat.abandoned_sub')} value={abandonedVisitors.length} icon={CreditCard} color="orange"
                onClick={() => setDrillDown({ title: t('drill.abandoned'), subtitle: t('drill.abandoned_sub'),
                  products: productStats.filter(p => abandonedVisitors.some(v => v.events.some(ev => ev.event_type === 'product_viewed' && (ev.data?.product_id === p.key || ev.data?.product_title === p.key)))),
                  visitors: abandonedVisitors })} />
            </div>

            {/* Abandonment Intelligence Panel */}
            <AbandonmentIntelligencePanel
              atRiskVisitors={atRiskVisitors}
              customerNames={customerNames}
              session={session}
              anonymized={anonymized}
              onVisitorClick={setSelectedVisitor}
            />

            {/* #10 Görünmez Sepet Dedektörü */}
            <HiddenCartPanel visitors={hiddenCartVisitors} customerNames={customerNames} />

            {/* #5 Stok-Talep Alarm */}
            <StockDemandWidget hotProducts={hotProducts} />

            {/* Conversion funnel */}
            {visitorProfiles.length > 0 && <ConversionFunnelWidget stats={funnelStats} />}
          </div>

          {/* SAĞ — Visitors + Live Feed */}
          <div className="space-y-4">
            {visitorProfiles.length > 0 && (
              <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                <SectionHead icon={Users} title={t('visitors.title')} badge={visitorProfiles.length} extra={t('visitors.extra')} />
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                  {visitorProfiles.slice(0, 18).map(profile => (
                    <VisitorCard key={profile.vid} profile={profile}
                      customerName={customerNames[profile.customer_id]}
                      anonymized={anonymized}
                      onClick={() => setSelectedVisitor(profile)} />
                  ))}
                </div>
                {visitorProfiles.length > 18 && (
                  <p className="px-4 pb-3 text-center text-[10px] text-textMute">+{visitorProfiles.length - 18} {t('visitors.more').replace('+{n} ', '')}</p>
                )}
              </div>
            )}

            {/* Live feed */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-textDim" />
                  <span className="text-text text-sm font-bold">{t('feed.title')}</span>
                  {events.length > 0 && (
                    <span className="text-[10px] bg-surfaceAlt text-textDim px-2 py-0.5 rounded-full">{events.length}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPaused(p => !p)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border transition-colors
                      ${paused ? 'bg-amberSoft border-amber/30 text-amber' : 'bg-surfaceAlt border-borderStrong text-textDim hover:text-text'}`}>
                    {paused ? t('feed.resume') : t('feed.pause')}
                  </button>
                  <button onClick={() => setEvents([])}
                    className="p-1.5 bg-surfaceAlt border border-borderStrong text-textDim rounded-lg hover:text-rose transition-colors" title="Clear">
                    <Trash2 size={12} />
                  </button>
                  <button onClick={() => setFeedOpen(o => !o)}
                    className="p-1.5 bg-surfaceAlt border border-borderStrong text-textDim rounded-lg hover:text-text transition-colors">
                    {feedOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
              </div>
              {feedOpen && (
                <div className="overflow-y-auto max-h-[520px] p-3 space-y-2 custom-scrollbar">
                  {events.length === 0
                    ? <div className="py-16 text-center space-y-2">
                        <p className="text-textMute text-sm font-medium">{t('feed.no_events')}</p>
                        <p className="text-textMute text-xs">{t('feed.no_events_sub')}</p>
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
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-surfaceAlt/60 border border-borderStrong flex items-center justify-center">
                  <Radio size={24} className="text-textMute" />
                </div>
                <h3 className="text-text font-bold text-base mb-2">{t('howto.title')}</h3>
                <div className="text-textDim text-sm space-y-2 max-w-sm mx-auto text-left">
                  <p>{t('howto.s1')}</p>
                  <p>{t('howto.s2')}</p>
                  <p>{t('howto.s3')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ANALİZ TAB ── */}
      {liveTab === 'analytics' && (
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 items-start">

          {/* SOL — Products, Collections, Searches, Traffic */}
          <div className="space-y-3">

            {/* Products accordion */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <button onClick={() => setProdOpen(o => !o)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surfaceAlt/40 transition-colors">
                <TrendingUp size={13} className="text-purple shrink-0" />
                <span className="flex-1 text-left text-text font-semibold text-xs uppercase tracking-wide">{t('analytics.products')}</span>
                {productStats.length > 0 && <span className="text-[10px] text-textMute mr-1">{productStats.length}</span>}
                {prodOpen ? <ChevronUp size={13} className="text-textMute shrink-0" /> : <ChevronDown size={13} className="text-textMute shrink-0" />}
              </button>
              {prodOpen && (
                productStats.length > 0
                  ? <div className="p-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 border-t border-border/60">
                      {productStats.map(p => <ProductCard key={p.key} product={p} flash={flashProducts.has(p.key)} />)}
                    </div>
                  : <p className="px-4 py-3 text-[10px] text-textMute border-t border-border/60">{t('analytics.no_products')}</p>
              )}
            </div>

            {/* Collections accordion */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <button onClick={() => setCollOpen(o => !o)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surfaceAlt/40 transition-colors">
                <Layers size={13} className="text-teal shrink-0" />
                <span className="flex-1 text-left text-text font-semibold text-xs uppercase tracking-wide">{t('analytics.collections')}</span>
                {collectionStats.length > 0 && <span className="text-[10px] text-textMute mr-1">{collectionStats.length}</span>}
                {collOpen ? <ChevronUp size={13} className="text-textMute shrink-0" /> : <ChevronDown size={13} className="text-textMute shrink-0" />}
              </button>
              {collOpen && (
                collectionStats.length > 0
                  ? <div className="divide-y divide-border/60 border-t border-border/60">
                      {collectionStats.map((col, i) => (
                        <div key={col.handle} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surfaceAlt/40 transition-colors">
                          <span className="text-[10px] text-textMute w-4 text-right font-mono">{i + 1}</span>
                          <span className="flex-1 text-sm text-text font-medium">{col.handle}</span>
                          <div className="w-16 h-1.5 bg-surfaceAlt rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-teal to-blue rounded-full"
                              style={{ width: `${Math.min(100, (col.count / collectionStats[0].count) * 100)}%` }} />
                          </div>
                          <span className="text-xs font-bold text-textDim w-6 text-right tabular-nums">{col.count}</span>
                        </div>
                      ))}
                    </div>
                  : <p className="px-4 py-3 text-[10px] text-textMute border-t border-border/60">{t('analytics.no_collections')}</p>
              )}
            </div>

            {/* Searches accordion */}
            <div className="bg-surface border border-border rounded-2xl overflow-hidden">
              <button onClick={() => setSearchOpen(o => !o)}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surfaceAlt/40 transition-colors">
                <Search size={13} className="text-textDim shrink-0" />
                <span className="flex-1 text-left text-text font-semibold text-xs uppercase tracking-wide">{t('analytics.searches')}</span>
                {searchStats.length > 0 && <span className="text-[10px] text-textMute mr-1">{searchStats.length}</span>}
                {searchOpen ? <ChevronUp size={13} className="text-textMute shrink-0" /> : <ChevronDown size={13} className="text-textMute shrink-0" />}
              </button>
              {searchOpen && (
                searchStats.length > 0
                  ? <div className="divide-y divide-border/60 border-t border-border/60">
                      {searchStats.map((s, i) => (
                        <div key={s.query} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surfaceAlt/40 transition-colors">
                          <span className="text-[10px] text-textMute w-4 text-right font-mono">{i + 1}</span>
                          <span className="flex-1 text-sm text-text font-medium">"{s.query}"</span>
                          <div className="w-16 h-1.5 bg-surfaceAlt rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-blue to-purple rounded-full"
                              style={{ width: `${Math.min(100, (s.count / searchStats[0].count) * 100)}%` }} />
                          </div>
                          <span className="text-xs font-bold text-textDim w-6 text-right tabular-nums">{s.count}</span>
                        </div>
                      ))}
                    </div>
                  : <p className="px-4 py-3 text-[10px] text-textMute border-t border-border/60">{t('analytics.no_searches')}</p>
              )}
            </div>

            {/* Traffic sources */}
            {visitorProfiles.length > 0 && (
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
            )}
          </div>

          {/* SAĞ — Funnel, UTM, Pages, 404s, RFM */}
          <div className="space-y-3">

            {/* Funnel */}
            {visitorProfiles.length > 0 && <ConversionFunnelWidget stats={funnelStats} />}

            {/* RFM Müşteri Segmentasyonu */}
            <RFMWidget session={session} anonymized={anonymized} />

            {/* UTM campaigns accordion */}
            {utmStats.length > 0 && (
              <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                <button onClick={() => setUtmOpen(o => !o)}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surfaceAlt/40 transition-colors">
                  <BarChart2 size={13} className="text-blue shrink-0" />
                  <span className="flex-1 text-left text-text font-semibold text-xs uppercase tracking-wide">{t('analytics.utm')}</span>
                  <span className="text-[10px] text-textMute mr-1">{utmStats.length}</span>
                  {utmOpen ? <ChevronUp size={13} className="text-textMute shrink-0" /> : <ChevronDown size={13} className="text-textMute shrink-0" />}
                </button>
                {utmOpen && (
                  <div className="divide-y divide-border/60 border-t border-border/60">
                    {utmStats.map(camp => (
                      <div key={camp.campaign}
                        onClick={() => {
                          // Set.has() yerine UTM campaign adıyla direkt eşleştir — daha güvenilir
                          const campVisitors = visitorProfiles.filter(
                            v => (v.utm?.utm_campaign === camp.campaign) ||
                                 Array.from(camp.vids).includes(v.vid)
                          );
                          setDrillDown({
                            title: `Campaign: ${camp.campaign}`,
                            subtitle: `${[camp.source, camp.medium].filter(Boolean).join(' / ')} · ${campVisitors.length} visitors · ${camp.views} views`,
                            products: camp.products,
                            visitors: campVisitors,
                          });
                        }}
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surfaceAlt/40 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text font-semibold truncate">{camp.campaign}</p>
                          <p className="text-[10px] text-textMute truncate">{[camp.source, camp.medium].filter(Boolean).join(' / ')}</p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-bold text-purple tabular-nums">{camp.views}</p>
                            <p className="text-[10px] text-textMute">{t('common.views')}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-green tabular-nums">{camp.carts}</p>
                            <p className="text-[10px] text-textMute">{t('common.cart')}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-blue tabular-nums">{camp.vids.size}</p>
                            <p className="text-[10px] text-textMute">{t('common.visitors')}</p>
                          </div>
                          <ArrowRight size={11} className="text-textMute" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Page stats accordion */}
            {pageStats.length > 0 && (
              <div className="bg-surface border border-border rounded-2xl overflow-hidden">
                <button onClick={() => setPageOpen(o => !o)}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surfaceAlt/40 transition-colors">
                  <Eye size={13} className="text-textDim shrink-0" />
                  <span className="flex-1 text-left text-text font-semibold text-xs uppercase tracking-wide">{t('analytics.pages')}</span>
                  <span className="text-[10px] text-textMute mr-1">{pageStats.length}</span>
                  {pageOpen ? <ChevronUp size={13} className="text-textMute shrink-0" /> : <ChevronDown size={13} className="text-textMute shrink-0" />}
                </button>
                {pageOpen && (
                  <div className="divide-y divide-border/60 border-t border-border/60">
                    {pageStats.map((page, i) => (
                      <div key={page.path} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surfaceAlt/40 transition-colors">
                        <span className="text-[10px] text-textMute w-4 text-right font-mono shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-text font-medium truncate">{page.title}</p>
                          <p className="text-[10px] text-textMute font-mono truncate">{page.path}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-bold text-purple tabular-nums">{page.vids.size}</p>
                            <p className="text-[10px] text-textMute">{t('common.unique')}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-textDim tabular-nums">{page.count}</p>
                            <p className="text-[10px] text-textMute">{t('common.views')}</p>
                          </div>
                          <span className="text-[10px] text-textMute w-14 text-right">{timeAgo(page.lastTs, lang)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 404 pages accordion */}
            {notFoundStats.length > 0 && (
              <div className="bg-roseSoft/50 border border-rose/20 rounded-2xl overflow-hidden">
                <button onClick={() => setNotFoundOpen(o => !o)}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-roseSoft/60 transition-colors">
                  <span className="text-sm font-bold text-rose shrink-0">404</span>
                  <span className="flex-1 text-left text-text font-semibold text-xs uppercase tracking-wide">{t('analytics.not_found')}</span>
                  <span className="text-[10px] bg-roseSoft text-rose px-1.5 py-0.5 rounded-full mr-1">{notFoundStats.length}</span>
                  {notFoundOpen ? <ChevronUp size={13} className="text-rose/60 shrink-0" /> : <ChevronDown size={13} className="text-rose/60 shrink-0" />}
                </button>
                {notFoundOpen && (
                  <div className="divide-y divide-rose/10 border-t border-rose/15">
                    {notFoundStats.map((item, i) => (
                      <div key={item.path} className="flex items-center gap-3 px-4 py-2.5 hover:bg-roseSoft/30 transition-colors">
                        <span className="text-[10px] text-textMute w-4 text-right font-mono shrink-0">{i + 1}</span>
                        <p className="flex-1 text-xs text-text font-mono truncate">{item.path}</p>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-xs font-bold text-rose tabular-nums">{item.vids.size}</p>
                            <p className="text-[10px] text-textMute">{t('common.unique')}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-textDim tabular-nums">{item.count}</p>
                            <p className="text-[10px] text-textMute">{t('common.hits')}</p>
                          </div>
                          <span className="text-[10px] text-textMute w-14 text-right">{timeAgo(item.lastTs, lang)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals — always rendered regardless of tab */}
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
