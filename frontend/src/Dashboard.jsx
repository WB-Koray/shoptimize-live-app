import { useMemo } from 'react';
import { Page, Layout, Badge, BlockStack } from '@shopify/polaris';
import { Activity, Users, ShoppingCart, CheckCircle } from 'lucide-react';
import { useSSE } from './hooks/useSSE';
import LiveVisitors from './components/LiveVisitors';
import EventFeed from './components/EventFeed';
import ProductStats from './components/ProductStats';
import ConversionFunnel from './components/ConversionFunnel';
import UTMSources from './components/UTMSources';

const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

export function getStage(eventType) {
  if (eventType === 'checkout_completed') return 'converted';
  if (eventType === 'checkout_started') return 'checkout';
  if (eventType === 'cart_viewed' || eventType === 'add_to_cart') return 'cart';
  if (eventType === 'product_viewed' || eventType === 'collection_viewed') return 'product';
  return 'browsing';
}

function getSource(ev) {
  if (ev.utm?.utm_source) return ev.utm.utm_source;
  const ref = ev.referrer || '';
  if (ref.includes('instagram.com')) return 'instagram';
  if (ref.includes('facebook.com')) return 'facebook';
  if (ref.includes('tiktok.com')) return 'tiktok';
  if (ref.includes('google.com')) return 'google';
  if (ref.includes('youtube.com')) return 'youtube';
  if (ref) return 'referral';
  return 'direkt';
}

export default function Dashboard({ session, onLogout }) {
  const { token, username, brand, tid } = session;
  const { events, connected } = useSSE(tid, token);

  const activeVisitors = useMemo(() => {
    const cutoff = Date.now() - ACTIVE_WINDOW_MS;
    const map = new Map();
    // Newest-first, so first occurrence of a vid = most recent
    events.forEach((ev) => {
      if (ev.ts < cutoff) return;
      if (!map.has(ev.vid)) {
        map.set(ev.vid, {
          vid: ev.vid,
          stage: getStage(ev.event_type),
          lastUrl: ev.url,
          source: getSource(ev),
          ts: ev.ts,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
  }, [events]);

  const stats = useMemo(() => {
    let carts = 0;
    let orders = 0;
    events.forEach((ev) => {
      if (ev.event_type === 'add_to_cart') carts++;
      if (ev.event_type === 'checkout_completed') orders++;
    });
    return { total: events.length, active: activeVisitors.length, carts, orders };
  }, [events, activeVisitors.length]);

  const productStats = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => {
      const title = ev.data?.product_title;
      if (!title) return;
      const p = map.get(title) || { title, views: 0, carts: 0, image: ev.data?.product_image || '' };
      if (ev.event_type === 'product_viewed') p.views++;
      if (ev.event_type === 'add_to_cart') p.carts++;
      map.set(title, p);
    });
    return Array.from(map.values())
      .sort((a, b) => b.views - a.carts - (a.views - b.carts))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);
  }, [events]);

  const conversionData = useMemo(() => {
    const s = {
      browsing: new Set(),
      product: new Set(),
      cart: new Set(),
      checkout: new Set(),
      converted: new Set(),
    };
    events.forEach((ev) => {
      const stage = getStage(ev.event_type);
      s[stage].add(ev.vid);
      if (stage === 'converted') {
        s.checkout.add(ev.vid); s.cart.add(ev.vid); s.product.add(ev.vid); s.browsing.add(ev.vid);
      } else if (stage === 'checkout') {
        s.cart.add(ev.vid); s.product.add(ev.vid); s.browsing.add(ev.vid);
      } else if (stage === 'cart') {
        s.product.add(ev.vid); s.browsing.add(ev.vid);
      } else if (stage === 'product') {
        s.browsing.add(ev.vid);
      }
    });
    const total = s.browsing.size || 1;
    return [
      { name: 'Tüm Ziyaretçi', count: s.browsing.size, pct: 100 },
      { name: 'Ürün İnceledi', count: s.product.size, pct: Math.round((s.product.size / total) * 100) },
      { name: 'Sepete Ekledi', count: s.cart.size, pct: Math.round((s.cart.size / total) * 100) },
      { name: 'Ödeme Başlattı', count: s.checkout.size, pct: Math.round((s.checkout.size / total) * 100) },
      { name: 'Satın Aldı', count: s.converted.size, pct: Math.round((s.converted.size / total) * 100) },
    ];
  }, [events]);

  const utmData = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => {
      const src = getSource(ev);
      map.set(src, (map.get(src) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [events]);

  return (
    <Page
      title="Shoptimize Live"
      subtitle={`${username} / ${brand}`}
      primaryAction={{ content: 'Çıkış', onAction: onLogout, tone: 'critical' }}
      titleMetadata={
        <Badge tone={connected ? 'success' : 'attention'}>
          {connected ? '● Canlı' : '○ Bağlanıyor'}
        </Badge>
      }
    >
      <BlockStack gap="500">
        {/* İstatistik Kartları */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          <StatCard icon={<Activity size={22} />} label="Toplam Event" value={stats.total} color="#6366f1" bg="#eef2ff" />
          <StatCard icon={<Users size={22} />} label="Aktif Ziyaretçi" value={stats.active} color="#10b981" bg="#d1fae5" />
          <StatCard icon={<ShoppingCart size={22} />} label="Sepete Ekleme" value={stats.carts} color="#f59e0b" bg="#fef3c7" />
          <StatCard icon={<CheckCircle size={22} />} label="Tamamlanan Sipariş" value={stats.orders} color="#3b82f6" bg="#dbeafe" />
        </div>

        {/* Ana İçerik — 2 sütun */}
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <LiveVisitors visitors={activeVisitors} />
              <EventFeed events={events} />
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <ProductStats products={productStats} />
              <ConversionFunnel data={conversionData} />
              <UTMSources data={utmData} />
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function StatCard({ icon, label, value, color, bg }) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        border: '1px solid #e5e7eb',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: bg,
          color: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#111', lineHeight: 1 }}>{value.toLocaleString('tr-TR')}</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 3 }}>{label}</div>
      </div>
    </div>
  );
}
