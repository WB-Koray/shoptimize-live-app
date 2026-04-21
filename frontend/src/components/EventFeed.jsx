import { useState, useRef, useEffect } from 'react';
import { Card, Text, Button, InlineStack, BlockStack } from '@shopify/polaris';
import {
  Eye, Package, Grid3X3, Search, ShoppingCart, CreditCard, CheckCircle, ShoppingBag
} from 'lucide-react';

const EVENT_CONFIG = {
  page_viewed:          { label: 'Sayfa Görüntülendi',    icon: Eye,          color: '#6b7280', bg: '#f9fafb' },
  product_viewed:       { label: 'Ürün İncelendi',        icon: Package,      color: '#2563eb', bg: '#eff6ff' },
  collection_viewed:    { label: 'Koleksiyon Görüntülendi',icon: Grid3X3,     color: '#7c3aed', bg: '#f5f3ff' },
  search_submitted:     { label: 'Arama Yapıldı',         icon: Search,       color: '#0891b2', bg: '#ecfeff' },
  add_to_cart:          { label: 'Sepete Eklendi',        icon: ShoppingCart, color: '#d97706', bg: '#fffbeb' },
  cart_viewed:          { label: 'Sepet Görüntülendi',    icon: ShoppingBag,  color: '#d97706', bg: '#fef3c7' },
  checkout_started:     { label: 'Ödeme Başlatıldı',      icon: CreditCard,   color: '#ca8a04', bg: '#fefce8' },
  checkout_completed:   { label: 'Sipariş Tamamlandı',    icon: CheckCircle,  color: '#059669', bg: '#ecfdf5' },
};

function timeStr(ts) {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function shortUrl(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url?.slice(0, 40) || '';
  }
}

function shortVid(vid) {
  return vid ? vid.slice(-6) : '?';
}

export default function EventFeed({ events }) {
  const [paused, setPaused] = useState(false);
  const [snapshot, setSnapshot] = useState([]);

  function togglePause() {
    if (!paused) {
      setSnapshot(events);
    }
    setPaused((p) => !p);
  }

  const displayed = paused ? snapshot : events;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <div
              className="live-dot"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: paused ? '#9ca3af' : '#10b981',
                flexShrink: 0,
              }}
            />
            <Text variant="headingMd" as="h2">Canlı Event Akışı</Text>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              ({events.length} event)
            </div>
          </InlineStack>
          <Button
            size="slim"
            onClick={togglePause}
            variant={paused ? 'primary' : 'secondary'}
          >
            {paused ? '▶ Devam' : '⏸ Duraklat'}
          </Button>
        </InlineStack>

        {paused && (
          <div
            style={{
              background: '#fef3c7',
              border: '1px solid #fde68a',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 12,
              color: '#92400e',
            }}
          >
            Akış duraklatıldı — yeni eventler arka planda birikiyor
          </div>
        )}

        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {displayed.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <Text tone="subdued" variant="bodySm">Henüz event yok — mağazanız izleniyor</Text>
            </div>
          ) : (
            displayed.slice(0, 100).map((ev, i) => {
              const cfg = EVENT_CONFIG[ev.event_type] || {
                label: ev.event_type,
                icon: Eye,
                color: '#6b7280',
                bg: '#f9fafb',
              };
              const Icon = cfg.icon;
              return (
                <div
                  key={`${ev.vid}-${ev.ts}-${i}`}
                  className={i === 0 && !paused ? 'event-enter' : ''}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '8px 4px',
                    borderBottom: '1px solid #f9fafb',
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      background: cfg.bg,
                      color: cfg.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
                      {ev.data?.product_title && (
                        <span
                          style={{
                            fontSize: 12,
                            color: '#374151',
                            background: '#f3f4f6',
                            borderRadius: 4,
                            padding: '1px 6px',
                            maxWidth: 180,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {ev.data.product_title}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                      <span style={{ fontFamily: 'monospace' }}>{shortVid(ev.vid)}</span>
                      {' · '}
                      <span title={ev.url}>{shortUrl(ev.url)}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0, paddingTop: 2 }}>
                    {timeStr(ev.ts)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </BlockStack>
    </Card>
  );
}
