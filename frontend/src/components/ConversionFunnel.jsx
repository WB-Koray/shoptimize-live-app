import { Card, Text, BlockStack, InlineStack } from '@shopify/polaris';
import { TrendingDown } from 'lucide-react';

const COLORS = ['#6366f1', '#3b82f6', '#f59e0b', '#ef4444', '#10b981'];

export default function ConversionFunnel({ data }) {
  const maxCount = data[0]?.count || 1;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <TrendingDown size={18} color="#374151" />
          <Text variant="headingMd" as="h2">Dönüşüm Hunisi</Text>
        </InlineStack>

        {data[0]?.count === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center' }}>
            <Text tone="subdued" variant="bodySm">Henüz veri yok</Text>
          </div>
        ) : (
          <BlockStack gap="250">
            {data.map((step, i) => (
              <div key={step.name}>
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodySm" as="span" tone={i === 4 ? 'success' : undefined}>
                    {step.name}
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: COLORS[i],
                        minWidth: 32,
                        textAlign: 'right',
                      }}
                    >
                      {step.count.toLocaleString('tr-TR')}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: '#9ca3af',
                        minWidth: 36,
                        textAlign: 'right',
                      }}
                    >
                      %{step.pct}
                    </span>
                  </InlineStack>
                </InlineStack>

                <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.max((step.count / maxCount) * 100, step.count > 0 ? 2 : 0)}%`,
                      background: COLORS[i],
                      borderRadius: 4,
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>

                {i < data.length - 1 && step.count > 0 && data[i + 1].count > 0 && (
                  <div style={{ fontSize: 10, color: '#d1d5db', textAlign: 'center', marginTop: 2 }}>
                    ↓ %{Math.round((data[i + 1].count / step.count) * 100)} geçiş oranı
                  </div>
                )}
              </div>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
