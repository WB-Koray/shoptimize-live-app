import { Card, Text, BlockStack, InlineStack } from '@shopify/polaris';
import { Package, ShoppingCart } from 'lucide-react';

export default function ProductStats({ products }) {
  const maxViews = Math.max(...products.map((p) => p.views), 1);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Package size={18} color="#374151" />
          <Text variant="headingMd" as="h2">En Çok Görüntülenen Ürünler</Text>
        </InlineStack>

        {products.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center' }}>
            <Text tone="subdued" variant="bodySm">Henüz ürün verisi yok</Text>
          </div>
        ) : (
          <BlockStack gap="200">
            {products.map((p, i) => (
              <div key={p.title} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <InlineStack align="space-between" blockAlign="center">
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: '#111',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '75%',
                    }}
                    title={p.title}
                  >
                    <span style={{ color: '#9ca3af', marginRight: 6, fontSize: 12 }}>#{i + 1}</span>
                    {p.title}
                  </div>
                  <InlineStack gap="200">
                    <span style={{ fontSize: 12, color: '#2563eb' }}>
                      <Eye16 /> {p.views}
                    </span>
                    {p.carts > 0 && (
                      <span style={{ fontSize: 12, color: '#d97706' }}>
                        <Cart16 /> {p.carts}
                      </span>
                    )}
                  </InlineStack>
                </InlineStack>
                {/* Progress bar */}
                <div style={{ height: 4, background: '#f3f4f6', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round((p.views / maxViews) * 100)}%`,
                      background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                      borderRadius: 2,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

function Eye16() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline', marginRight: 2 }}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function Cart16() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline', marginRight: 2 }}>
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}
