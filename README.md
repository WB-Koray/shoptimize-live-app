# Shoptimize Live

Shopify mağazaları için gerçek zamanlı ziyaretçi analitik servisi. Anlık aktivite takibi, WhatsApp terk edilmiş sepet otomasyonu, RFM müşteri segmentasyonu ve conversion funnel analizi sağlar.

**Canlı URL:** https://live.shoptimize.com.tr  
**Shopify App:** Shop X-Ray WA Cart Recovery (`client_id: 1e80272ad8faa2261f770841ddee0377`)

---

## Mimari

```
┌─────────────────────────────────────────────────────────────┐
│                        Coolify (Docker)                     │
│                                                             │
│  ┌──────────────────┐    ┌──────────┐    ┌──────────────┐  │
│  │  React Frontend  │    │  FastAPI │    │    Redis     │  │
│  │  (Vite, dist/)   │───▶│  :8001   │───▶│  (events,   │  │
│  └──────────────────┘    └──────────┘    │   sessions) │  │
│                               │          └──────────────┘  │
│                               │          ┌──────────────┐  │
│                               └─────────▶│  PostgreSQL  │  │
│                                          │  (shared DB) │  │
│                                          └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲
         │ Pixel events (JS)
┌────────────────────┐
│  Shopify Storefront │
│  Theme App Extension│
│  (pixel.liquid)     │
└────────────────────┘
```

**Frontend** → React + Recharts + Lucide, Vite ile build edilip `frontend/dist/` altına. FastAPI `StaticFiles` ile serve eder.  
**Backend** → FastAPI (Python 3.11), `uvicorn` üzerinde port `8001`.  
**Redis** → Canlı event stream, visitor presence, checkout state, rate limiting, dedup.  
**PostgreSQL** → Shopify OAuth tokenları, entegrasyon ayarları, billing durumu. Ana shoptimize backend ile aynı DB paylaşılır (sadece okur/günceller).

---

## Teknoloji Stack

| Katman | Teknoloji |
|--------|-----------|
| Backend | Python 3.11, FastAPI 0.115, Uvicorn |
| Frontend | React 18, Recharts, Lucide React, Vite, Tailwind CSS |
| Veritabanı | PostgreSQL (psycopg2), Redis (redis-py async) |
| HTTP Client | httpx (async Shopify API çağrıları) |
| Auth | JWT (HS256, `AUTH_TOKEN_SECRET`), Shopify OAuth 2.0 |
| Deployment | Docker multi-stage build, Coolify |
| Shopify | Admin GraphQL API 2026-04, Theme App Extension (pixel) |

---

## Proje Yapısı

```
shoptimize-live-app/
├── main.py                    # FastAPI app, lifespan, abandoned checkout worker
├── requirements.txt
├── Dockerfile                 # Multi-stage: Node build → Python serve
├── shopify.app.toml           # Shopify CLI app config
│
├── routers/
│   ├── live.py                # Ana API — pixel, event stream, RFM, customer, webhooks
│   ├── auth.py                # Shopify OAuth install/callback, JWT token, billing trigger
│   ├── billing.py             # Shopify subscription (GraphQL appSubscriptionCreate)
│   ├── flow.py                # WA otomasyon ayarları, log, ROI, opt-out
│   ├── campaign.py            # Toplu WA kampanya broadcast — şablon, hedef kitle, gönderim
│   ├── admin.py               # Operator paneli — merchant listesi, token yönetimi, sağlık
│   └── gdpr.py                # GDPR webhook'ları (data_request, redact, app/uninstalled)
│
├── services/
│   ├── redis_store.py         # Tüm Redis operasyonları (RedisStore sınıfı)
│   ├── db.py                  # PostgreSQL — get_setting, set_connection_settings
│   ├── auth.py                # JWT encode/decode, get_current_user dependency
│   ├── notify.py              # Operatör WhatsApp bildirimleri (dedupe + cooldown)
│   └── wa_sender.py           # WhatsApp Business API mesaj gönderme
│
├── extensions/
│   └── shop-x-ray-pixel/      # Theme App Extension
│       └── blocks/
│           └── pixel.liquid   # Mağazaya inject edilen tracking kodu
│
└── frontend/
    └── src/
        ├── Dashboard.jsx      # Ana dashboard (tüm widget'lar)
        ├── App.jsx            # Router, session yönetimi
        ├── LoginPage.jsx      # Shopify OAuth başlatma + token login
        ├── AdminPanel.jsx     # Operator yönetim paneli
        ├── OnboardingModal.jsx
        ├── i18n.js            # TR/EN çeviri stringleri
        ├── LangContext.jsx
        └── ThemeContext.jsx
```

---

## Routers — Endpoint Özeti

### `live.py` — Core Analytics
| Endpoint | Açıklama |
|----------|----------|
| `GET /pixel.js` | Shopify storefront'a inject edilen tracking script |
| `POST /api/live/event` | Pixel event alımı (rate limited, dedup) |
| `GET /api/live/stream` | SSE — anlık event stream |
| `GET /api/live/events` | Son N event (dashboard ilk yükleme) |
| `GET /api/shopify/pixel/status` | Theme App Extension kurulum durumu |
| `POST /api/shopify/pixel/install` | Webhook kayıt |
| `GET /api/shopify/customer` | Shopify müşteri detayı (admin GraphQL) |
| `GET /api/shopify/order-journey` | CustomerJourneySummary (sipariş yolculuğu) |
| `GET /api/shopify/customers/rfm` | RFM müşteri segmentasyonu |
| `POST /api/shopify/webhook/orders-create` | Sipariş oluştu webhook |
| `POST /api/shopify/webhook/checkouts-create` | Checkout başladı webhook |
| `POST /api/shopify/webhook/register` | Webhook kayıt endpoint |
| `GET/POST /api/wa/webhook` | WhatsApp Business webhook verify/receive |

### `auth.py` — Kimlik Doğrulama
| Endpoint | Açıklama |
|----------|----------|
| `GET /auth/shopify/install` | OAuth flow başlatma → Shopify consent sayfası |
| `GET /auth/shopify/callback` | OAuth callback — token kayıt, billing tetikleme |
| `POST /api/auth/token` | Username/password → JWT |
| `GET /api/auth/status` | Mevcut JWT geçerli mi? |
| `POST /api/auth/shopify-token` | App Bridge session token → JWT |
| `GET /install/success` | Kurulum başarı sayfası (embedded redirect) |

### `flow.py` — WA Otomasyon
| Endpoint | Açıklama |
|----------|----------|
| `GET/POST /api/flow/settings` | Otomasyon ayarları (delay, sequence, pencere) |
| `POST /api/flow/test` | Manuel test mesajı gönder |
| `GET /api/flow/logs` | Gönderim geçmişi |
| `GET /api/flow/roi` | WA → sipariş ROI analizi |
| `GET /api/flow/optouts` | Opt-out listesi |
| `GET /api/flow/template-status` | Meta'daki şablon onay durumları |

### `campaign.py` — Toplu WA Kampanya
| Endpoint | Açıklama |
|----------|----------|
| `GET /api/campaign/templates` | Hazır şablon önerileri + Meta'da onaylı IMAGE-header MARKETING şablonları |
| `POST /api/campaign/template` | Görsel header'lı MARKETING şablonu oluştur → Meta onayına gönder |
| `POST /api/campaign/media` | Görsel upload yedeği (base64 → Redis, public URL) |
| `GET /api/campaign/audience` | Hedef kitle sayıları — RFM segment, yüksek harcayan, SMS onaylı, ulaşılabilir |
| `GET /api/campaign/audience/members` | Seçili segmentteki kişiler (isim, telefon, harcama, opt-out) |
| `POST /api/campaign/send` | Kampanya oluştur → şimdi gönder veya planla |
| `POST /api/campaign/cancel` | Planlanmış kampanyayı iptal et |
| `POST /api/campaign/test` | Kendi numarana test gönderimi |
| `GET /api/campaign/list` | Kampanya geçmişi + teslim/okundu + tıklama/sipariş atfı |
| `GET /api/campaign/recipients` | Kişi bazlı takip (iletildi/okundu/sipariş +ürün +ciro) |
| `GET /campaign-media/{id}` | Upload yedeği görsel servisi (ayrı router) |

Kampanya kitlesi opt-out filtreli, batch (20'lik) + rate-limit'li (2 sn) gönderilir — WhatsApp kalite puanını korumak için. Hedef kitle: son N günde sipariş veren (RFM segmentli) ya da SMS pazarlama onayı vermiş müşteriler.

### `billing.py` — Abonelik
| Endpoint | Açıklama |
|----------|----------|
| `GET /billing/start` | Abonelik başlat → Shopify onay sayfasına yönlendir |
| `GET /billing/callback` | Shopify onay dönüşü → aktive et, DB'ye yaz |

### `admin.py` — Operator Paneli
| Endpoint | Açıklama |
|----------|----------|
| `GET /merchants` | Tüm merchant listesi + billing durumu |
| `GET /health` | Mağaza sağlık monitörü (ölü token, eksik şablon, kayıtsız webhook, kapalı akış, eksik pixel) |
| `POST /test-alert` | Operatör bildirim hattını test et |
| `POST /setup-operator-template` | Operatör WA şablonunu kur |
| `POST /nudge` | Merchant'a hatırlatma bildirimi gönder |
| `POST /set-shopify-token` | Merchant'a token ata |
| `GET /shopify-records` | Ham DB kayıtlarını incele |
| `POST /copy-shopify-token` | Token kopyala (mağaza geçişi) |

---

## Servisler

### `services/redis_store.py` — RedisStore

Tüm geçici state Redis'te saklanır:

| Key Deseni | TTL | İçerik |
|------------|-----|--------|
| `events:{tid}` | 7 gün | Son 5000 event (lpush/ltrim) |
| `visitor:{tid}:{vid}` | 10 dk | Aktif ziyaretçi presence |
| `tid:{username}:{brand}` | - | TID ↔ merchant mapping |
| `checkout:{token}` | - | Terk edilmiş checkout verisi |
| `pending_checkouts` | - | Sorted set — gönderim zamanına göre |
| `step_sent:{token}:{idx}` | - | WA sequence adım gönderildi mi |
| `phone_active:{phone}` | cooldown | Aktif telefon → sequence token |
| `optout:{username}:{brand}` | - | Set — opt-out telefon numaraları |
| `flow_log:{username}:{brand}` | - | WA gönderim logu |
| `online_token:{username}:{brand}` | - | Shopify OAuth online access token |

### `services/db.py` — PostgreSQL

`integration_connections` tablosunu okur/günceller. Şema:

```sql
integration_connections (
  username      TEXT,
  brand         TEXT DEFAULT 'default',
  integration_id TEXT,   -- 'shopify'
  payload_json  JSONB    -- {shop_domain, admin_api_token, billing_status, ...}
)
```

`get_setting(username, brand, integration, key)` → `payload_json` içinde önce `settings` alt objesine, sonra kök seviyeye bakar.

---

## Token Öncelik Sırası

Shopify API çağrılarında token şu sırada aranır:

1. `store.get_online_token(username, brand)` — OAuth ile kurulan mağazalar (short-lived)
2. `get_setting(..., "admin_api_token")` — Eski manuel token (private app)

RFM, CustomerJourney, Customer Detail endpoint'lerinin hepsi bu sırayı takip eder.

---

## Pixelin Çalışma Mantığı

1. Shopify tema `pixel.liquid` block'unu yükler (Theme App Extension).
2. Block, `GET /pixel.js?tid={TID}` ile tracking scriptini alır.
3. Script, `page_view`, `product_view`, `add_to_cart`, `checkout_start`, `purchase` eventlerini `POST /api/live/event` ile gönderir.
4. Server event'i Redis'e yazar + SSE kanalına publish eder.
5. Dashboard `GET /api/live/stream` SSE bağlantısıyla anlık güncelleme alır.

**Rate limit:** IP başına 60 event/dakika, aynı event 10 saniye içinde tekrar gelirse dedup.

---

## Arka Plan Worker'ları

`main.py`'de `lifespan` içinde başlayan üç arka plan task'ı:

### 1. Abandoned Checkout Worker (`_abandoned_checkout_worker`, her 60 sn)
- `store.get_pending_checkouts_before(now)` ile işlem zamanı gelen checkout'ları kontrol eder.
- `flow.py` sequence ayarlarına göre sıralı WA mesajları gönderir.
- Gönderim penceresi (UTC+3), minimum sepet tutarı ve telefon bazlı cooldown kontrolü yapar.
- Sequence tamamlanınca veya müşteri satın alırsa pending listesinden kaldırır.
- Kritik token hatasında (#190/#401) operatöre anlık WA bildirimi atar (mağaza başına saatte 1).

### 2. Scheduled Campaign Worker (`_scheduled_campaign_worker`, her 30 sn)
- `store.get_due_campaigns(now)` ile gönderim zamanı gelen planlı kampanyaları bulur.
- `campaign.execute_campaign(...)` çağırarak toplu WA broadcast'i tetikler.

### 3. Health Monitor Worker (`_health_monitor_worker`, varsayılan 6 saatte bir)
- Her mağaza için `compute_store_health(...)` çalıştırır.
- Boru hattı bozulunca (ölü token, eksik şablon, kayıtsız webhook) operatöre WA bildirimi atar; düzelince "düzeldi" bildirimi gönderir (durum geçişlerinde tek sefer).
- Trial'ı biten mağazalar için (son 24 saat) uyarı gönderir.
- Aralık `HEALTH_MONITOR_INTERVAL_SEC` ile ayarlanır.

---

## Environment Variables

| Variable | Zorunlu | Açıklama |
|----------|---------|----------|
| `REDIS_URL` | ✅ | `redis://host:6379` |
| `DATABASE_URL` veya `INTEGRATIONS_POSTGRES_DSN` | ✅ | PostgreSQL DSN |
| `AUTH_TOKEN_SECRET` | ✅ | JWT imzalama secret (min 32 karakter) |
| `SHOPIFY_CLIENT_ID` | ✅ | Shopify app client ID |
| `SHOPIFY_CLIENT_SECRET` | ✅ | Shopify app client secret |
| `SHOPIFY_APP_URL` | ✅ | `https://live.shoptimize.com.tr` |
| `SHOPIFY_API_VERSION` | — | Default: `2026-04` |
| `SHOPIFY_CLIENT_SECRET_LEGACY` | — | Eski app secret (geçiş dönemi fallback) |
| `DASHBOARD_PASSWORD` | — | Password-login kullanıcıları için |
| `ADMIN_TOKEN` | — | Operator panel erişim token'ı |
| `BILLING_ENABLED` | — | `true`/`false`, default `true` |
| `BILLING_PLAN_NAME` | — | Default: `Shoptimize Live` |
| `BILLING_PLAN_PRICE` | — | Default: `9.99` (USD) |
| `BILLING_TRIAL_DAYS` | — | Default: `7` |
| `BILLING_TEST_MODE` | — | `true`/`false`, test abonelik için |
| `OPERATOR_WA_TOKEN` | — | Operator WA bildirimleri (yeni kayıt) |
| `OPERATOR_WA_PHONE_ID` | — | Operator WA phone number ID |
| `OPERATOR_ALERT_PHONE` | — | Operatör bildirimlerinin gönderileceği telefon |
| `HEALTH_MONITOR_INTERVAL_SEC` | — | Sağlık monitörü aralığı (default `21600` = 6 saat) |
| `WA_WEBHOOK_VERIFY_TOKEN` | — | Meta WA webhook doğrulama token'ı |
| `ENABLE_DOCS` | — | `true` ise Swagger/ReDoc/OpenAPI açılır (default kapalı) |

---

## Deployment — Coolify

Multi-stage Docker build:

```
Stage 1 (node:20-slim)  →  npm ci + vite build → frontend/dist/
Stage 2 (python:3.11-slim) → pip install + dist copy → uvicorn :8001
```

**Build args** (Coolify'da tanımla):
```
VITE_SHOPIFY_CLIENT_ID=1e80272ad8faa2261f770841ddee0377
VITE_API_URL=https://live.shoptimize.com.tr
```

Health check: `GET /health` → `{"ok": true, "service": "shoptimize-live"}`

---

## Shopify App Yapılandırması (`shopify.app.toml`)

- **Scopes:** `read_checkouts, read_customers, read_orders`
- **Webhook API Version:** `2026-04`
- **GDPR Endpoints:** `customers/data_request`, `customers/redact`, `shop/redact`
- **Embedded:** `true` (App Bridge ile dashboard açılır)
- **Theme Extension:** `shop-x-ray-pixel` — `pixel.liquid` block

---

## Dashboard Widget'ları

| Widget | Veri Kaynağı |
|--------|-------------|
| Canlı Ziyaretçiler | Redis SSE stream |
| Conversion Funnel | Redis events (page_view → purchase) |
| Purchase Intent Score | Redis events (heatmap algo) |
| RFM Segmentasyonu | Shopify Admin GraphQL (son N günün siparişleri) |
| Stok-Talep Alarmı | Redis events + Shopify inventory |
| Almost Buyer Radar | Redis events (view/cart ama purchase yok) |
| Gizli Sepet Dedektörü | Webhook checkout events |
| UTM / Kaynak Analizi | Redis events (referrer, utm_source) |
| Sipariş Yolculuğu | Shopify CustomerJourneySummary GraphQL |
| WA ROI Zinciri | Redis flow_log ↔ Shopify orders |

---

## Geliştirme Ortamı

**Bağımlılık servisleri (Redis + PostgreSQL) Docker ile:**
```bash
docker compose -f docker-compose.dev.yml up -d     # Redis :6379 + Postgres :5432
# scripts/dev-schema.sql ilk açılışta integration_connections tablosunu kurar
# ve bir test merchant'ı (dev@localhost, TID spt_devtest0001) seed'ler.
docker compose -f docker-compose.dev.yml down       # durdur (veri kalır)
docker compose -f docker-compose.dev.yml down -v     # veriyi de sil
```

**Backend:**
```bash
python -m venv .venv && .venv/Scripts/activate     # Windows; Linux: source .venv/bin/activate
pip install -r requirements.txt
# ÖNEMLİ: kodda load_dotenv YOK — .env'i uvicorn'a açıkça vermek gerekir:
uvicorn main:app --env-file .env --port 8001 --reload
```

**Frontend (ayrı terminal):**
```bash
cd frontend
npm install
npm run dev      # Vite dev server :5173
# veya production build: npm run build → frontend/dist/
```

`.env` örneği (Docker compose ile birebir uyumlu):
```env
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://shoptimize:shoptimize@localhost:5432/shoptimize
AUTH_TOKEN_SECRET=super-secret-key-min-32-chars
SHOPIFY_CLIENT_ID=1e80272ad8faa2261f770841ddee0377
SHOPIFY_APP_URL=http://localhost:8001
BILLING_ENABLED=false
ENABLE_DOCS=true
DASHBOARD_PASSWORD=devpassword
```

---

## Önemli Notlar

- PostgreSQL bağlantısı **sync** (psycopg2) — her `get_setting` çağrısı yeni bağlantı açar. Yoğun endpoint'lerde async driver geçişi düşünülmeli.
- Online token (OAuth) **short-lived** — süresi dolunca 403 döner. Token öncelik sırası her Shopify API endpoint'inde mutlaka uygulanmalı.
- Pixel script **cache'lenir** (`Cache-Control: public, max-age=300`). TID değişirse eski script 5 dakika daha çalışabilir.
- GDPR `app/uninstalled` webhook veri temizliğini yapar (billing iptali, token boşaltma, Redis event/visitor/flow verisi). `wa_step:*` ve `wa_phone_active:*` anahtarları TTL'e bırakılır; Postgres satırı silinmez.
- `app/uninstalled` ve `checkouts/*` webhook'ları `shopify.app.toml`'da deklare **edilmez** — yalnız OAuth/token-exchange sırasında runtime'da GraphQL ile kaydedilir.
- Cihazlar arası sepet kurtarma (cart permalink) canlıda çalışıyor (`CART_PERMALINK_BUTTON=1`). Permalink yalnız adında "link" geçen dinamik URL butonlu şablonlara eklenir; statik butonlu şablonlar (ör. `sepet_hatirlatma`) etkilenmez — devreye alım merchant bazlı (bkz. TODOLIST.md 5.5).
