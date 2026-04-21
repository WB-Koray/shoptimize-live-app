import { useState } from 'react';
import {
  Card,
  FormLayout,
  TextField,
  Button,
  Text,
  Banner,
  BlockStack,
} from '@shopify/polaris';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [brand, setBrand] = useState('default');
  const [password, setPassword] = useState('');
  const [manualTid, setManualTid] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!username.trim() || !password.trim()) {
      setError('Kullanıcı adı ve şifre gerekli');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), brand: brand.trim() || 'default', password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.detail || data.error || 'Giriş başarısız');
        return;
      }
      // TID: API'den gelen > elle girilen > boş
      const tid = data.tid || manualTid.trim() || '';
      if (!tid) {
        setError('TID bulunamadı. Aşağıdaki "Tracking ID" alanını doldurun.');
        return;
      }
      onLogin({ token: data.token, username: data.username, brand: data.brand, tid });
    } catch {
      setError('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f6f6f7 0%, #e8e9eb 100%)',
        padding: 16,
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: '#1a1a2e',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 12,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 20 }}>⚡</span>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>Shoptimize Live</span>
          </div>
          <Text variant="bodySm" tone="subdued" as="p">
            Canlı mağaza aktivitesi & ziyaretçi takibi
          </Text>
        </div>

        <Card>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError('')}>
                {error}
              </Banner>
            )}

            <FormLayout>
              <TextField
                label="Kullanıcı Adı"
                value={username}
                onChange={setUsername}
                autoComplete="username"
                placeholder="ornek@siteniz.com"
                helpText="Shopify OAuth sırasında kullanılan e-posta"
              />
              <TextField
                label="Marka"
                value={brand}
                onChange={setBrand}
                autoComplete="off"
                helpText="Genellikle 'default'"
              />
              <TextField
                label="Şifre"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
              <TextField
                label="Tracking ID (TID)"
                value={manualTid}
                onChange={setManualTid}
                autoComplete="off"
                placeholder="koray@ornek.com_default_abc123..."
                helpText="Otomatik bulunmazsa buraya girin. Piksel URL'sinden (?tid=...) kopyalayabilirsiniz."
                monospaced
              />
            </FormLayout>

            <Button
              fullWidth
              variant="primary"
              loading={loading}
              onClick={handleSubmit}
              size="large"
            >
              Giriş Yap
            </Button>
          </BlockStack>
        </Card>

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Text variant="bodyXs" tone="subdued" as="p">
            TID örneği: koray@korayyildiz.com.tr_default_89f03476cdd41216
          </Text>
        </div>
      </div>
    </div>
  );
}
