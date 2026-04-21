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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e?.preventDefault?.();
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
      onLogin({ token: data.token, username: data.username, brand: data.brand, tid: data.tid });
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
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ marginBottom: 8 }}>
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
              <Text variant="headingLg" as="span">
                <span style={{ color: '#fff' }}>Shoptimize Live</span>
              </Text>
            </div>
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
      </div>
    </div>
  );
}
