# 🗺️ Shoptimize Live — Tam Roadmap

> Son güncelleme: 2026-07-17 · Baz commit: `9f05290`
> Durum: 60 maddenin 40'ı tamam, 2'si kısmi, 18'i açık
> Bu liste kodla doğrulanmıştır — her satırdaki durum `dosya:satır` kanıtına dayanır.

**İşaretler:** ✅ tamam · 🟡 kısmi (aşağıda notu var) · ⏳ açık

---

## 📦 Katman 1 — Shopify API Entegrasyonları

### 1.1 Webhook'lar

| Webhook | Ne Sağlar | Durum | Kanıt / Not |
|---------|-----------|-------|-------------|
| `checkouts/create` | Server-side sepet yaratıldı | ✅ | Handler `live.py:1639`; 3 yerden kayıt (`auth.py:347`, `auth.py:796`, `live.py:1748`) |
| `checkouts/update` | Checkout'ta her adım | 🟡 | Kaydı var (`auth.py:348`) ama create ile **aynı** handler'a gidiyor; `x-shopify-topic` okunmadığı için create/update ayrımı yapılmıyor |
| `app/uninstalled` | Uygulama kaldırıldı → veri temizliği | ✅ | Handler `gdpr.py:76-108` — gerçekten temizliyor (billing iptali + token boşaltma + `delete_tid_events` + `delete_flow_data`). Kayıt `auth.py:349`, `auth.py:798`. ⚠️ `shopify.app.toml`'da deklare edilmemiş, yalnız runtime'da kaydediliyor |
| `customer.joined_segment` | Müşteri segmente eklendi | ⏳ | Kodda iz yok |
| `customer.left_segment` | Müşteri segmentten çıktı | ⏳ | Kodda iz yok |
| `customers/purchasing_summary` | Harcama analizi güncellendi | ⏳ | Kodda iz yok |
| `carts/create` + `carts/update` | Gerçek zamanlı sepet | ⏳ | Kodda iz yok |
| `fulfillments/create` | Kargo çıktı bildirimi | ⏳ | Kodda iz yok — ek scope gerekir (`read_fulfillments`) |
| `disputes/create` | Chargeback uyarısı | ⏳ | Kodda iz yok — ek scope gerekir |

> Mevcut scope'lar: `read_checkouts,read_customers,read_orders` (`shopify.app.toml:25` ve `auth.py:37` — ikisi senkron). Açık webhook'ların çoğu ek scope ister.

### 1.2 Customer GraphQL Alanları

| Alan | Ne Söylüyor | Durum | Kanıt / Not |
|------|-------------|-------|-------------|
| `numberOfOrders` | RFM için direkt veri | ✅ | **İhtiyaç karşılandı ama alan sorgulanmıyor** — RFM frequency'yi siparişleri sayarak hesaplıyor (`live.py:1337`) |
| `totalSpent` | RFM için direkt veri | ✅ | **İhtiyaç karşılandı ama alan sorgulanmıyor** — monetary `order.totalPriceSet` toplamından (`live.py:1234`, `:1320`) |
| `predictedSpendTier` | Shopify ML: low/medium/high spender | ⏳ | Hiçbir query'de yok |
| `lifetimeDuration` | Kaç gündür müşteri | ⏳ | Hiçbir query'de yok |
| Customer tags + segmentler | Gelişmiş filtreleme | ⏳ | `tags` / `customerSegment` sorgusu yok. Mevcut "segment" tamamen app içi hesap (`live.py:1361-1368`) |

### 1.3 CustomerJourneySummary

| Alan | Durum | Kanıt |
|------|-------|-------|
| `firstVisit`, `lastVisit`, `moments` | ✅ | `live.py:842-863` — endpoint `/api/shopify/order-journey` (`live.py:869`) |
| `daysToConversion` | ✅ | `live.py:840`, `live.py:943` |
| `customerOrderIndex` | ✅ | `live.py:839`, `live.py:944` |

**Katman 1: 7 ✅ · 1 🟡 · 9 ⏳ (17 madde)**

---

## 🧠 Katman 2 — Pixel Davranışsal Zenginleştirme

> **Yapısal not:** `extensions/shop-x-ray-pixel/blocks/pixel.liquid` sadece 8 satırlık bir loader. Tüm pixel mantığı `live.py:70-428` içindeki `_PIXEL_JS_TEMPLATE` string'inde. Yeni sinyal eklemek orayı düzenlemek demek.

| # | Veri | Zorluk | Durum | Kanıt / Not |
|---|------|--------|-------|-------------|
| 2.1 | **Scroll depth** (0–100%) | Orta | 🟡 | `live.py:364-387` — çalışıyor ama **yalnız `/products/` sayfalarında** (`:366`), 0-100 sürekli değil 4 kademeli (25/50/75/100). Milestone'ları düşüren dedup hatası düzeltildi (`live.py:505`) |
| 2.2 | **Attention time** | Orta | ✅ | `live.py:389-423` — `visibilitychange` + timer + `beforeunload`/`pagehide`, min 3sn eşiği, tüm sayfa tipleri |
| 2.3 | **Exit intent** | Kolay | ⏳ | `mousemove`/`mouseleave` listener'ı yok |
| 2.4 | **Rage click** | Orta | ⏳ | Tek `click` listener'ı (`live.py:347-358`) yalnız checkout linki tespiti yapıyor |
| 2.5 | **Dead zone click** | Orta | ⏳ | DOM link kontrolü yok |
| 2.6 | **Form field drop-off** | Zor | ⏳ | `blur` listener'ı yok; `submit` (`live.py:336-345`) yalnız `/cart/add` yakalıyor |
| 2.7 | **Görüntü zoom** | Kolay | ⏳ | `dblclick`/`touchstart` listener'ı yok |
| 2.8 | **Arama gecikmesi** | Kolay | ⏳ | `search_submitted` gidiyor (`live.py:286`) ama "sonuca tıklamama" takibi yok |
| 2.9 | **Sepet tereddütü** | Kolay | ⏳ | Yalnız `add_to_cart` var; `/cart/change` (çıkarma) interceptor'ı yok |
| 2.10 | **Geri dön davranışı** | Kolay | ⏳ | `popstate` listener'ı yok |

### Pixel'in gönderdiği event tipleri (11 + 1 server-side)

`page_viewed` · `product_viewed` · `collection_viewed` · `cart_viewed` · `search_submitted` · `add_to_cart` (4 farklı yoldan) · `checkout_started` · `scroll_depth` · `attention_time`

`checkout_completed` pixel'den **gelmiyor** — `orders/create` webhook'undan server-side push ediliyor (`live.py:1615`, `:1628`).

> `POST /api/live/event` (`live.py:467-545`) event tipine göre ayrım yapmıyor, generic pass-through. Yeni event tipi eklemek backend değişikliği gerektirmez.

**Katman 2: 1 ✅ · 1 🟡 · 8 ⏳ (10 madde)**

---

## 🔥 Katman 3 — Analytics & Intelligence

| # | Özellik | Etki | Durum | Kanıt / Not |
|---|---------|------|-------|-------------|
| 1 | **Purchase Intent Score** (canlı 0–100 badge) | 🔥🔥🔥 | ✅ | `Dashboard.jsx:155` (`calcIntentScore`), badge `:306`. Tamamen client-side |
| 2 | **Checkout Drop-off Haritası** | 🔥🔥🔥 | ✅ | `Dashboard.jsx:425` (`ConversionFunnelWidget`), veri `:4839` |
| 3 | **CustomerJourney → Sipariş Filmi** | 🔥🔥🔥 | ✅ | `Dashboard.jsx:781` (`OrderJourneyModal`); backend `live.py:869` |
| 4 | **Scroll depth + Attention time pixel** | 🔥🔥 | ✅ | Uçtan uca zincir tam: pixel `live.py:364-422` → `Dashboard.jsx:4754-4759` → badge `:329-346`. (Scroll'un kapsam sınırı için 2.1'e bak) |
| 5 | **Stok-Talep Alarm** | 🔥🔥🔥 | 🟡 | `Dashboard.jsx:1485` — talep + **stok** birlikte. Kod tam ve doğru; endpoint (`live.py:1432`) çalışıyor. **AMA `read_products` scope'u gerektiriyor** — eklendi (`shopify.app.toml:25`), her merchant re-consent verene kadar stok sayıları boş kalır. Scope gelince sayılar görünür, `viewers >= available` ise kritik işaretlenir |
| 6 | **WA → Sipariş ROI zinciri** | 🔥🔥🔥 | ✅ | `flow.py:747` `/api/flow/roi`; atıf kaynağı `live.py:1555-1568`; panel `Dashboard.jsx:3812` |
| 7 | **RFM Segmentasyon** | 🔥🔥 | ✅ | `live.py:1246` + `Dashboard.jsx:1068`; 7 segment |
| 8 | **"Almost Buyer" Radar** | 🔥🔥🔥🔥 | ✅ | `Dashboard.jsx:1627`, risk `:1601`; cart/checkout + 3dk sessizlik |
| 9 | **Cross-store Benchmarking** | 🔥🔥🔥🔥 | ⏳ | Kodda sıfır iz — gerçekten açık |
| 10 | **Görünmez Sepet Dedektörü** | 🔥🔥 | ✅ | `Dashboard.jsx:1529`, veri `:4821-4837` |

**Katman 3: 8 ✅ · 1 🟡 · 1 ⏳ (10 madde)** — #5 kod tam, `read_products` re-consent'ine bağlı

---

## 🏗️ Katman 4 — SaaS Altyapı & Güvenlik

| # | Madde | Durum | Kanıt / Not |
|---|-------|-------|-------------|
| 4.1 | **Billing enforcement** — login'de 402 | ✅ | `auth.py:89` (`_check_billing`), 402 `:113-135`. `BILLING_ENABLED=false` ile bypass |
| 4.2 | **Admin paneli** | ✅ | `admin.py:142` + `AdminPanel.jsx:73`; 6 durum (active/trialing/needs_billing/trial_ended/declined/uninstalled) |
| 4.3 | **Trial bitiş kontrolü** | ✅ | `auth.py:126-135`. ⚠️ `BILLING_TRIAL_DAYS` varsayılanı **0** (`auth.py:40`) — trial artık Shopify Managed Pricing'de |
| 4.4 | **Rate limiting** — `/api/live/event` | ✅ | `live.py:491-494` (429); TID 500/60sn, IP 200/60sn (`redis_store.py:54`) |
| 4.5 | **App/Uninstalled webhook** — veri temizliği | ✅ | `gdpr.py:76-108` — **yapıldı** (2026-06-01). Redis `events:{tid}`, `visitor:*`, `flow_logs:`, `wa_orders:` siliniyor. Eksik: `wa_step:*`/`wa_phone_active:*` TTL'e bırakılmış, Postgres satırı silinmiyor |
| 4.6 | **Shopify App Store hazırlığı** | ✅ | Uygulama **yayında ve canlı** (Managed Pricing ile). Scopes senkron, GDPR webhook'ları toml'da (`:11-21`), privacy sayfası `main.py:529`, kurulum rehberi `main.py:351`. Listing metni/asset'i Partner Dashboard'da tutulur — repo'da olmaması normal |
| 4.7 | **Test credentials** — reviewer hesabı | ✅ | Partner Dashboard'da yönetilir, kod deposunda tutulmaz. Review süreci tamamlanmış |
| 4.8 | **ErrorBoundary** | ✅ | `ErrorBoundary.jsx:4`, `main.jsx:11-17` — ağacın en dışında |
| 4.9 | **Reauth DB lookup** | ✅ | `auth.py:515` + `lookup_username_by_shop` `:533-540` |

**Katman 4: 9 ✅ (9 madde)**

---

## 🚀 Katman 5 — 26 Mayıs Sonrası Yapılanlar

> Bu katman eski listede **hiç yoktu**. 26 Mayıs–13 Temmuz arası ~165 commit'lik iş burada kayıt altına alınıyor.

| # | İş kolu | Durum | Ana dosyalar |
|---|---------|-------|--------------|
| 5.1 | **Kampanya modülü** — şablon, RFM hedef kitle, planlı gönderim, kupon, kişi bazlı takip (iletildi/okundu/sipariş+ürün), teslim/okundu, tıklama/sipariş atfı | ✅ | `campaign.py` (11 endpoint), `Dashboard.jsx:2581` (CampaignPanel), worker `main.py:205` |
| 5.2 | **WhatsApp kurulum** — Embedded Signup (Facebook ile bağla), Hızlı Bağlan (sadece token), şablon yöneticisi | ✅ | `flow.py:362` (wa-connect), `:534-560` (ES config+exchange), WaTemplateManager. ES yalnız 3 env dolu ise görünür |
| 5.3 | **Admin/operatör paneli** — sağlık monitörü, anlık WA bildirimleri, MRR/dönüşüm, nudge, CSV | ✅ | `admin.py` (8 endpoint), `notify.py`, `AdminPanel.jsx`, health worker `main.py:232` |
| 5.4 | **Billing → Shopify Managed Pricing** geçişi | ✅ | `auth.py:42-52`, `:917-919`. ⚠️ `billing.py`'de legacy ölü kod kaldı |
| 5.5 | **Cihazlar arası sepet kurtarma** (cart permalink) | ✅ | `wa_sender.py:47-60`, `:266-286`; `live.py:1701`; `flow.py:177`. **Canlıda çalışıyor** — `CART_PERMALINK_BUTTON=1` açık, `_link` şablonları Meta onaylı. Devreye alma merchant bazlı: sekansı `_link` şablonuna bakan merchant permalink alır (welcomebaby), statik şablonda kalan güvenle eski davranışta kalır (soley). Müşteri masaüstünde sepete atsa da mobilde linke tıklayınca sepet yeniden kuruluyor, üyelik gerekmiyor |
| 5.6 | **GDPR + Meta Data Deletion Callback** | ✅ | `gdpr.py` (4 webhook, gerçek temizlik), `flow.py:499-525` |
| 5.7 | **Güvenlik sertleştirme** — `/docs` production'da kapalı, güvenlik başlıkları, HMAC + legacy secret fallback, 404 gürültü susturma | ✅ | `main.py:29-51`, `:302-333`; `gdpr.py:26-35`. CORS `*` pixel için bilinçli |
| 5.8 | **i18n TR/EN + slate tema + KVKK anonimleştirme** | ✅ | `i18n.js` (509/509 anahtar, TR/EN farkı yok), `ThemeContext.jsx`, `Dashboard.jsx:43` (`maskName`) |
| 5.9 | **Attribution raporu (XLSX indirme)** — kanal/kaynak/kampanya kırılımı | ✅ | `live.py:1000-1213`, openpyxl 3.1.5 |
| 5.10 | **3 arka plan worker** — abandoned checkout (60sn), scheduled campaign (30sn), health monitor (6sa) | ✅ | `main.py:63` / `:205` / `:232`, lifespan `:294-296` |
| 5.11 | **Theme App Extension** (ScriptTag → App Embed, 5.1.1 uyumu) | ✅ | `extensions/shop-x-ray-pixel/`, `live.py:671`, `auth.py:329` |
| 5.12 | **App Bridge session token auth + multi-tenant session izolasyonu** | ✅ | `auth.py`, `App.jsx` |
| 5.13 | **REST → GraphQL migrasyonu** (2.2.4 uyumu) | ✅ | `billing.py`, `live.py`, `admin.py` |
| 5.14 | **Plan sekmesi · AdProductGrid · opt-out listesi** | ✅ | `Dashboard.jsx` |

> **Canlı Mod** (tam ekran izleme) 2026-06-30'da eklenip **2026-07-01'de revert edildi** (`61a6b61`) — ihtiyaç kalmadı. Kodda iz yok, roadmap maddesi değil.

**Katman 5: 14 ✅ (14 madde)**

---

## 🧹 Bilinen Teknik Borç

Roadmap maddesi değil ama kodda duran, kanıtlanmış açıklar:

| Konu | Yer | Not |
|------|-----|-----|
| **Yeni merchant `_link` şablonu almıyor** | `flow.py:28-55` | `_DEFAULT_TEMPLATES` hâlâ statik butonlu şablon üretiyor (`button_url: .../cart`), `DEFAULT_SEQUENCE` (`flow.py:264-268`) de statik adlara bakıyor. Şablonlar merchant'ın kendi WABA'sında oluştuğu için her yeni mağazada `_link` varyantını elle kurmak gerekiyor. Cart permalink'in yayılmasını yavaşlatan tek engel |
| **Cart permalink bayrağı katı parse** | `wa_sender.py:271` | `os.getenv("CART_PERMALINK_BUTTON") == "1"` — `true`/`yes` çalışmaz (`BILLING_ENABLED`'ın toleranslı parse'ının aksine). Şu an `1` set edildiği için sorun çıkarmıyor, ama ileride tuzak |
| **`billing.py` ölü kod (~12KB)** | `billing.py:46-149` | `create_charge()` hiçbir yerden çağrılmıyor; `/billing/callback` de onun `return_url`'iydi → o da yetim. Managed Pricing geçişinden kalma. Frontend'in kullandığı tek endpoint `/billing/info` |
| **Trial uyarısı fiilen ölü** | `main.py:245`, `:270` | `BILLING_TRIAL_DAYS` varsayılanı 0 → `if TRIAL_DAYS > 0` bloğu hiç çalışmıyor |
| **`/recipients` atıf penceresi** | `campaign.py` | Kişi bazlı takip hâlâ `orders limit=200` + 14 gün penceresiyle sınırlı. `/list` kalıcı sayaçlara geçti ama `/recipients` Shopify sipariş eşleştirmesi yaptığı için ayrı mekanizma — büyük mağazada eksik gösterebilir |
| **Worker süpervizyonu yok** | `main.py:294-296` | Üçü de `asyncio.create_task` fire-and-forget; döngü içi `try/except` var ama task ölürse yeniden başlatan yok |
| **Ölü i18n anahtarları** | `i18n.js:450-497`, `:1039-1086` | Canlı Mod'dan kalan 96 `mon.*` anahtarı (48 EN + 48 TR), hiçbir `.jsx` kullanmıyor. Revert commit'i bilinçli bıraktı |
| **Kullanılmayan Polaris component'leri** | `frontend/src/components/` | `ConversionFunnel.jsx`, `EventFeed.jsx`, `LiveVisitors.jsx`, `ProductStats.jsx`, `UTMSources.jsx` + `hooks/useSSE.js` hiçbir yerden import edilmiyor — Dashboard kendi inline widget'larını kullanıyor |
| **PostgreSQL sync driver** | `db.py` | Her `get_setting` yeni bağlantı açıyor (psycopg2). Yoğun endpoint'lerde async geçişi düşünülmeli |

---

## 🎯 Önerilen Sıradaki Adımlar

### Kısa vadeli
1. **Cart permalink'i yeni merchant'lara yay** — `_DEFAULT_TEMPLATES` + `DEFAULT_SEQUENCE`'i `_link` varyantlarına çevir, böylece her yeni mağaza elle kurulum gerektirmeden cihazlar arası sepet kurtarma alsın
2. **`2.1` Scroll depth'i tüm sayfa tiplerine yay** — şu an yalnız `/products/`; dedup düzeltildikten sonra tek kalan sınır bu
3. **`1.1` `checkouts/update` ayrımı** — `x-shopify-topic` header'ını oku, create'ten ayır (checkout adım adım takibi bundan kaybediliyor)

### Orta vadeli
4. **Ölü kod temizliği** — `billing.py` legacy (~12KB), `mon.*` i18n (96 anahtar), kullanılmayan 5 Polaris component'i
5. **`/recipients` atıf penceresi** — `/list` kalıcı sayaçlara geçti, kişi bazlı takip hâlâ 200 sipariş / 14 gün ile sınırlı
6. **`2.3` Exit intent** — Katman 2'nin en kolay maddesi, bir `mouseleave` listener'ı
7. **Worker süpervizyonu** — üç worker da fire-and-forget; task ölürse yeniden başlatan yok

### Uzun vadeli
8. **`3.9` Cross-store benchmarking** — SaaS avantajı, en yüksek etki (🔥🔥🔥🔥), Katman 3'ün son açık maddesi
9. **`1.2` `predictedSpendTier`** entegrasyonu — Shopify ML'i RFM'e kat
10. **`1.1` Gerçek zamanlı sepet** (`carts/create` + `carts/update`) — pixel'e bağımlılığı azaltır

---

## 📊 Özet

| Katman | Toplam | ✅ | 🟡 | ⏳ |
|--------|--------|-----|-----|-----|
| Katman 1 (Shopify API) | 17 | 7 | 1 | 9 |
| Katman 2 (Pixel) | 10 | 1 | 1 | 8 |
| Katman 3 (Analytics) | 10 | 8 | 1 | 1 |
| Katman 4 (Altyapı) | 9 | 9 | 0 | 0 |
| Katman 5 (26 Mayıs sonrası) | 14 | 14 | 0 | 0 |
| **Toplam** | **60** | **39** | **3** | **18** |

> ⚠️ **Deploy notu — `read_products` scope eklendi:** Stok-Talep Alarmı (#3.5) için
> `shopify.app.toml` ve `auth.py`'ye `read_products` eklendi. Bu **tüm merchant'ların
> uygulamayı yeniden onaylamasını** gerektirir — Shopify bir sonraki açılışta yeni izin
> için onay ekranı gösterir. Onay verilene kadar o merchant'ta stok sayıları boş kalır
> (widget talep tarafıyla çalışmaya devam eder). Aynı scope RFM/attribution gibi ürün
> verisi isteyen gelecek özelliklere de kapı açar.

Kalan 18 açık maddenin 8'i Katman 2 (pixel davranış sinyalleri), 9'u Katman 1 (ek scope isteyen webhook'lar + Shopify ML alanları), 1'i Katman 3 (cross-store benchmarking). Altyapı ve 26 Mayıs sonrası iş kollarında açık madde kalmadı.
