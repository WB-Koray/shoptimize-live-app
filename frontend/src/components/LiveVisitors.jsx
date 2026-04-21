import { Card, Text, Badge, BlockStack, InlineStack, EmptyState } from '@shopify/polaris';
import { Users } from 'lucide-react';

const STAGE_CONFIG = {
  browsing:  { label: 'Geziniyor',         tone: 'info',     bg: '#f3f4f6', color: '#6b7280' },
  product:   { label: 'Ürün İnceliyor',    tone: 'info',     bg: '#dbeafe', color: '#2563eb' },
  cart:      { label: 'Sepette',           tone: 'warning',  bg: '#fef3c7', color: '#d97706' },
  checkout:  { label: 'Ödeme Yapıyor',     tone: 'attention',bg: '#fef9c3', color: '#ca8a04' },
  converted: { label: 'Satın Aldı',        tone: 'success',  bg: '#d1fae5', color: '#059669' },
};

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s önce`;
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  return `${Math.floor(diff / 3600)} sa önce`;
}

function shortVid(vid) {
  return vid ? `…${vid.slice(-6)}` : '?';
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 32) path = path.slice(0, 30) + '…';
    return path || '/';
  } catch {
    return url?.slice(0, 32) || '/';
  }
}

function sourceIcon(source) {
  const icons = {
    instagram: '📸',
    facebook: '👤',
    tiktok: '🎵',
    google: '🔍',
    youtube: '▶️',
    referral: '🔗',
    direkt: '🏠',
  };
  return icons[source?.toLowerCase()] || '🌐';
}

export default function LiveVisitors({ visitors }) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Users size={18} color="#374151" />
            <Text variant="headingMd" as="h2">Aktif Ziyaretçiler</Text>
          </InlineStack>
          <div
            style={{
              background: visitors.length > 0 ? '#d1fae5' : '#f3f4f6',
              color: visitors.length > 0 ? '#065f46' : '#6b7280',
              borderRadius: 20,
              padding: '2px 10px',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {visitors.length} aktif
          </div>
        </InlineStack>

        {visitors.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <Text tone="subdued" variant="bodySm">Şu anda aktif ziyaretçi yok</Text>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  {['Ziyaretçi', 'Aşama', 'Sayfa', 'Kaynak', 'Ne Zaman'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '6px 12px',
                        fontWeight: 600,
                        color: '#6b7280',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visitors.slice(0, 50).map((v) => {
                  const cfg = STAGE_CONFIG[v.stage] || STAGE_CONFIG.browsing;
                  return (
                    <tr
                      key={v.vid}
                      style={{ borderBottom: '1px solid #f9fafb' }}
                    >
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#374151' }}>
                        {shortVid(v.vid)}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span
                          style={{
                            background: cfg.bg,
                            color: cfg.color,
                            borderRadius: 6,
                            padding: '2px 8px',
                            fontSize: 12,
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {cfg.label}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: '#374151',
                        }}
                        title={v.lastUrl}
                      >
                        {shortUrl(v.lastUrl)}
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: '#6b7280' }}>
                        {sourceIcon(v.source)} {v.source}
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: '#9ca3af', fontSize: 12 }}>
                        {timeAgo(v.ts)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </BlockStack>
    </Card>
  );
}
