import { Card, Text, BlockStack, InlineStack } from '@shopify/polaris';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Globe } from 'lucide-react';

const COLORS = ['#6366f1', '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#0891b2', '#d97706'];

const SOURCE_LABELS = {
  instagram: '📸 Instagram',
  facebook: '👤 Facebook',
  tiktok: '🎵 TikTok',
  google: '🔍 Google',
  youtube: '▶️ YouTube',
  referral: '🔗 Referral',
  direkt: '🏠 Direkt',
};

function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    return (
      <div
        style={{
          background: '#1f2937',
          color: '#fff',
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 13,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}
      >
        <div>{payload[0].payload.name}</div>
        <div style={{ fontWeight: 700 }}>{payload[0].value.toLocaleString('tr-TR')} event</div>
      </div>
    );
  }
  return null;
}

export default function UTMSources({ data }) {
  const chartData = data.map((d) => ({
    ...d,
    name: SOURCE_LABELS[d.name] || `🌐 ${d.name}`,
  }));

  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Globe size={18} color="#374151" />
          <Text variant="headingMd" as="h2">Trafik Kaynakları</Text>
        </InlineStack>

        {data.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center' }}>
            <Text tone="subdued" variant="bodySm">Henüz trafik verisi yok</Text>
          </div>
        ) : (
          <BlockStack gap="300">
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={130}
                    tick={{ fontSize: 12, fill: '#374151' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f3f4f6' }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {total > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {data.slice(0, 4).map((d, i) => (
                  <div
                    key={d.name}
                    style={{
                      fontSize: 11,
                      color: '#6b7280',
                      background: '#f9fafb',
                      borderRadius: 6,
                      padding: '3px 8px',
                      border: `1px solid ${COLORS[i % COLORS.length]}40`,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: COLORS[i % COLORS.length] }}>
                      %{Math.round((d.count / total) * 100)}
                    </span>{' '}
                    {SOURCE_LABELS[d.name] || d.name}
                  </div>
                ))}
              </div>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
