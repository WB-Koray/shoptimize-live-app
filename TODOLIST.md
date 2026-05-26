# 🗺️ Shoptimize Live — Tam Roadmap

> Son güncelleme: 2026-05-26  
> Durum: 7/10 Katman 3 tamamlandı · Katman 1-2 başlanmadı

---

## 📦 Katman 1 — Shopify API Entegrasyonları

Shopify'ın sağladığı ama henüz kullanmadığımız veriler.

### 1.1 Webhook'lar (Eksik Olanlar)

| Webhook | Ne Sağlar | Durum |
|---------|-----------|-------|
| `customer.joined_segment` | Müşteri segmente eklendi | ⏳ |
| `customer.left_segment` | Müşteri segmentten çıktı | ⏳ |
| `customers/purchasing_summary` | Harcama analizi güncellendi | ⏳ |
| `checkouts/create` | Server-side sepet yaratıldı | ⏳ |
| `checkouts/update` | Checkout'ta her adım | ⏳ |
| `carts/create` + `carts/update` | Gerçek zamanlı sepet | ⏳ |
| `fulfillments/create` | Kargo çıktı bildirimi | ⏳ |
| `disputes/create` | Chargeback uyarısı | ⏳ |
| `app/uninstalled` | Uygulama kaldırıldı → veri temizliği | ⏳ |

### 1.2 Customer GraphQL Alanları

| Alan | Ne Söylüyor | Durum |
|------|-------------|-------|
| `predictedSpendTier` | Shopify ML: low/medium/high spender | ⏳ |
| `lifetimeDuration` | Kaç gündür müşteri | ⏳ |
| `numberOfOrders` | RFM için direkt veri | ✅ (RFM'de kullanılıyor) |
| `totalSpent` | RFM için direkt veri | ✅ (RFM'de kullanılıyor) |
| Customer tags + segmentler | Gelişmiş filtreleme | ⏳ |

### 1.3 CustomerJourneySummary

| Alan | Durum |
|------|-------|
| `firstVisit`, `lastVisit`, `moments` | ✅ Yapıldı (Feature 3) |
| `daysToConversion` | ✅ Yapıldı |
| `customerOrderIndex` | ✅ Yapıldı |

---

## 🧠 Katman 2 — Pixel Davranışsal Zenginleştirme

Şu an pixel sadece sayfa geçişlerini takip ediyor. Eklenecekler:

| # | Veri | Ne Söylüyor | Teknik | Zorluk | Durum |
|---|------|-------------|--------|--------|-------|
| 2.1 | **Scroll depth** (0–100%) | Ürünü gerçekten okudu mu? | `scroll` event, throttled | Orta | ⏳ |
| 2.2 | **Attention time** | Her ürüne kaç saniye baktı? | `visibilitychange` + timer | Orta | ⏳ |
| 2.3 | **Exit intent** | Fareyi sekmeye/üst bara taşıdı | `mousemove` Y threshold | Kolay | ⏳ |
| 2.4 | **Rage click** | Aynı yere 3+ kez hızlı tıkladı | click cluster detection | Orta | ⏳ |
| 2.5 | **Dead zone click** | Tıklandı ama link yok | `click` + DOM check | Orta | ⏳ |
| 2.6 | **Form field drop-off** | Checkout'ta hangi alana takıldı? | `blur` + unfilled fields | Zor | ⏳ |
| 2.7 | **Görüntü zoom** | Ürün görselini büyüttü mü? | `touchstart` zoom / `dblclick` | Kolay | ⏳ |
| 2.8 | **Arama gecikmesi** | Arama yaptı ama sonuçlara tıklamadı | search + no click after | Kolay | ⏳ |
| 2.9 | **Sepet tereddütü** | Sepete ekledi → çıkardı | cart events sequence | Kolay | ⏳ |
| 2.10 | **Geri dön davranışı** | Hızlı geri gitme = tatminsizlik | `popstate` event | Kolay | ⏳ |

> **Not:** Katman 3'teki "#4 Scroll depth + Attention time" bu katmanın 2.1 + 2.2 maddeleriyle örtüşüyor.

---

## 🔥 Katman 3 — Analytics & Intelligence Özellikleri

Öncelik tablosundaki 10 madde.

| # | Özellik | Zorluk | Etki | Durum |
|---|---------|--------|------|-------|
| 1 | **Purchase Intent Score** (canlı 0–100 badge) | Orta | 🔥🔥🔥 | ✅ Yapıldı |
| 2 | **Checkout Drop-off Haritası** (ConversionFunnelWidget) | Kolay | 🔥🔥🔥 | ✅ Yapıldı |
| 3 | **CustomerJourney → Sipariş Filmi** (OrderJourneyModal) | Orta | 🔥🔥🔥 | ✅ Yapıldı |
| 4 | **Scroll depth + Attention time pixel** | Orta | 🔥🔥 | ✅ Yapıldı |
| 5 | **Stok-Talep Alarm** (StockDemandWidget) | Kolay | 🔥🔥🔥 | ✅ Yapıldı |
| 6 | **WA → Sipariş ROI zinciri** | Orta | 🔥🔥🔥 | ✅ Yapıldı |
| 7 | **RFM Segmentasyon** (Müşteri Segmentleri widget) | Orta | 🔥🔥 | ✅ Yapıldı |
| 8 | **"Almost Buyer" Radar** (Abandonment Intelligence) | Zor | 🔥🔥🔥🔥 | ✅ Yapıldı |
| 9 | **Cross-store Benchmarking** (SaaS avantajı) | Zor | 🔥🔥🔥🔥 | ⏳ İleride |
| 10 | **Görünmez Sepet Dedektörü** (HiddenCartPanel) | Kolay | 🔥🔥 | ✅ Yapıldı |

**İlerleme: 9/10** ✅

---

## 🏗️ Katman 4 — SaaS Altyapı & Güvenlik

Ürünü hazır tutmak için gereken altyapı maddeleri.

| # | Madde | Durum |
|---|-------|-------|
| 4.1 | **Billing enforcement** — login'de 402 dönüşü | ✅ Yapıldı |
| 4.2 | **Admin paneli** — tüm merchant'lar, billing durumu | ✅ Yapıldı |
| 4.3 | **Trial bitiş kontrolü** — süre dolduysa erişim kapat | ✅ Yapıldı |
| 4.4 | **Rate limiting** — `/api/live/event` koruması | ✅ Yapıldı |
| 4.5 | **App/Uninstalled webhook** — veri temizliği | ⏳ Bekliyor |
| 4.6 | **Shopify App Store hazırlığı** — scopes, listing, review | ⏳ Bekliyor |
| 4.7 | **Test credentials** — reviewer için test hesabı | ⏳ Bekliyor |
| 4.8 | **ErrorBoundary** — React crash → yeniden yükle | ✅ Yapıldı |
| 4.9 | **Reauth DB lookup** — OAuth token doğru kullanıcıya | ✅ Yapıldı |

---

## 🎯 Önerilen Sıradaki Adımlar

### Kısa vadeli (bu hafta)
1. `4.3` Trial bitiş kontrolü — basit, kritik
2. `4.4` Rate limiting — `/api/live/event` flood koruması
3. `3.4` Scroll depth + attention time pixel (Katman 2.1 + 2.2 ile birlikte)
4. `3.6` WA → Sipariş ROI zinciri

### Orta vadeli (sonraki sprint)
5. `4.5` App/Uninstalled webhook
6. `4.6` Shopify App Store listing hazırlığı
7. `1.1` Eksik webhook'lar (checkout/cart server-side)
8. `2.3` Exit intent detection (pixel)

### Uzun vadeli
9. `3.9` Cross-store benchmarking
10. `1.2` Customer GraphQL — predictedSpendTier entegrasyonu

---

## 📊 Özet

| Katman | Toplam | Tamamlanan | Kalan |
|--------|--------|-----------|-------|
| Katman 1 (Shopify API) | 12 madde | 5 | 7 |
| Katman 2 (Pixel) | 10 madde | 2 | 8 |
| Katman 3 (Analytics) | 10 madde | 9 | 1 |
| Katman 4 (Altyapı) | 9 madde | 7 | 2 |
| **Toplam** | **41 madde** | **23** | **18** |
