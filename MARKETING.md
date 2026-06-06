# Shoptimize Live — Ürün & Pazarlama Dökümanı

> **Hedef kitle:** Shopify mağaza sahipleri · **Dil:** Türkçe mağazalar öncelikli, EN desteği mevcut  
> **URL:** live.shoptimize.com.tr · **Fiyat:** $9.99/ay · 7 gün ücretsiz deneme

---

## Ürün Nedir?

Shoptimize Live, Shopify mağazanıza kurulan ve mağazanızda o an ne olduğunu size gerçek zamanlı olarak gösteren bir analitik ve otomasyon uygulamasıdır.

Google Analytics size dün olanı gösterir. Shoptimize Live size **şu an** olanı gösterir — ve yalnızca göstermekle kalmaz, doğru anda harekete geçmenizi sağlar.

---

## Temel Değer Önerisi

### "Mağazanızda şu an kim var, ne yapıyor, neden ayrılıyor — ve ona ne yapmalısınız?"

Bir fiziksel mağazada satış görevlisi müşteriyi izler: ne bakıyor, neyi eline alıyor, ne zaman duraksıyor. E-ticarette bu görünürlük yoktu. Shoptimize Live bunu değiştiriyor.

---

## Özellikler ve İş Değeri

### 1. Canlı Ziyaretçi Takibi

**Ne yapar:** O an mağazanızda kaç kişi var, hangi ürünü görüyor, hangi sayfada, nereden geldi — canlı olarak takip eder.

**İş değeri:**
- Kampanya açtığınızda anında sonuç görürsünüz — GA'yı beklemenize gerek kalmaz.
- "Reklam çalışıyor mu?" sorusunu reklam yayındayken cevaplar.
- Ani trafik artışlarını (TikTok viral, flash sale) anlık görürsünüz.

---

### 2. Purchase Intent Score — Satın Alma Niyet Skoru

**Ne yapar:** Her aktif ziyaretçiye 0–99 arasında bir niyet skoru verir. Skor şu sinyallere göre hesaplanır:

| Sinyal | Katkı |
|--------|-------|
| Checkout aşamasında olmak | +80 baz puan |
| Sepete ürün eklemek | +52 baz puan |
| Ürün sayfasında olmak | +20 baz puan |
| Geri dönen ziyaretçi | +12 puan |
| Birden fazla ürün incelemek | +3 puan/ürün (max +12) |
| 5 dakikadan uzun oturum | +7 puan toplamda |
| Giriş yapmış üye | +7 puan |
| Sepete birden fazla kez eklemek | +4 puan/ekleme (max +12) |

**İş değeri:**
- Hangi ziyaretçinin "pencere alışverişçisi", hangisinin "alacak adam" olduğunu görürsünüz.
- 70+ skorlu ziyaretçilere öncelik vererek WhatsApp mesajını doğru kişiye gönderirsiniz.
- Yüksek niyet → terk → mesaj zinciri tamamen otomatik çalışır.

---

### 3. Dönüşüm Hunisi (Conversion Funnel)

**Ne yapar:** Ziyaretçi → Ürün Görüntüleme → Sepete Ekleme → Ödeme Başlattı → Sipariş akışının her adımındaki kişi sayısını ve adımlar arası kayıpları gösterir.

**Örnek çıktı:**
```
Ziyaretçi:      142  (100%)
Ürün İnceledi:   89  (%63) ▼ 53 kişi düştü (%37)
Sepete Ekledi:   34  (%24) ▼ 55 kişi düştü (%62)
Ödemeye Geçti:   18  (%13) ▼ 16 kişi düştü (%47)
Sipariş Verdi:    9  (%6)  ▼ 9 kişi düştü (%50)
```

**İş değeri:**
- "Sepete ekliyor ama ödemeye geçmiyor" → ödeme sayfası sorunu var.
- "Ürüne bakıyor ama sepete eklemiyor" → fiyat mı, ürün görseli mi, açıklama mı yetersiz?
- Dönüşüm oranınızı sektör ortalamasıyla karşılaştırabilirsiniz (%1–3 iyi, %3+ mükemmel).

---

### 4. Almost Buyer Radar — Terk İzleme Paneli

**Ne yapar:** Sepette ürünü olan ya da checkout'a başlayıp uzun süredir hareketsiz olan ziyaretçileri risk skoru ile listeler ve tek tıkla WhatsApp mesajı göndermenizi sağlar.

**Risk skoru nasıl hesaplanır:**

| Durum | Risk Puanı |
|-------|-----------|
| 30+ dakikadır hareketsiz | +40 |
| 15–30 dakika hareketsiz | +28 |
| Checkout aşamasında | +30 |
| Sepet aşamasında | +15 |
| Mobil cihaz | +5 |
| Yüksek intent (70+) | +5 |
| Geri dönen ziyaretçi | -10 |
| Kayıtlı üye | -8 |

**İş değeri:**
- Manüel takip yapmanıza gerek kalmaz — sistem kendisi uyarır.
- "Hızlı Gönder" butonu ile terk anında müdahale edebilirsiniz.
- %70+ riskli + sepetinde ürün olan ziyaretçiyi kaçırmazsınız.

---

### 5. WhatsApp Terk Sepeti Otomasyonu

**Ne yapar:** Sepete ürün ekleyip ayrılan müşterilere belirli süre sonra otomatik WhatsApp mesajı gönderir. Çoklu adım (sequence) desteği vardır.

**Nasıl çalışır:**
1. Müşteri mağazanıza gelir, sepete ürün ekler, checkout başlatır.
2. Shopify webhook'u Shoptimize Live'ı haberdar eder.
3. Siz ayarladığınız süre (varsayılan: 15 dakika) geçtikten sonra mesaj gönderilir.
4. Müşteri satın alırsa sonraki mesajlar iptal olur.

**Sequence örneği:**
```
Adım 1 → 15 dakika sonra: "Sepetinde ürün var!" (sepet_hatirlatma)
Adım 2 → 4 saat sonra:   "Hâlâ bekliyoruz..."  (sepet_hatirlatma_2)
Adım 3 → 24 saat sonra:  "Son şans!"            (sepet_hatirlatma_3)
```

**Kontroller:**
- Gönderim penceresi: sabah 09:00 – akşam 21:00 (UTC+3) arası gönderir, gece rahatsız etmez.
- Minimum sepet tutarı: küçük alışverişlerde mesaj göndermez (örn. 100 TL altı).
- Cooldown: aynı telefona X saat içinde tekrar mesaj göndermez.
- Opt-out yönetimi: "STOP" yazan müşteriler listeden çıkar.

**İş değeri:**
- E-posta terk sepeti mesajlarının ortalama açılma oranı %20. WhatsApp mesajlarında bu oran **%90+**.
- Shopify'ın kendi terk sepeti e-postası var ama WhatsApp kanalında değil.
- Otomasyonla her geceyi kaçırdığınız müşteriler geri dönmeye başlar.

---

### 6. RFM Müşteri Segmentasyonu

**Ne yapar:** Son N günün Shopify siparişlerinden müşterilerinizi 7 segmente böler.

**Segmentler:**

| Segment | Tanım | Strateji |
|---------|-------|---------|
| 🏆 Champions | Çok yakın zamanda, sık sık, yüksek tutarda alışveriş | Sadakat programı, VIP |
| 💎 Loyal | Düzenli alışveriş yapan sadık müşteriler | Erken erişim, teşekkür |
| 🌱 Promising | Son zamanda alışveriş yaptı, potansiyel var | Upsell fırsatı |
| ✨ New | İlk kez satın aldı | Onboarding, ikinci alışveriş teşviki |
| ⏰ Needs Attention | Ortalamanın altında, ilgi azalıyor | Hatırlatma kampanyası |
| ⚠️ At-Risk | Alışveriş sıklığı düştü, kaybolma riski var | Geri kazanım kampanyası |
| 😴 Lost | Uzun süredir alışveriş yapmıyor | Son şans teklifi ya da çıkarma |

**RFM nedir?**
- **R**ecency (Yakınlık): Son alışveriş ne kadar yakın zamanda?
- **F**requency (Sıklık): Kaç kez satın aldı?
- **M**onetary (Tutar): Ne kadar harcadı?

**İş değeri:**
- Tüm müşterilerinizi aynı kampanyayla bombardıman etmek yerine doğru segmente doğru mesaj gönderirsiniz.
- "Lost" müşterilerinizi görünce kaç kişiyi kaybettiğinizi anlarsınız.
- Her segmentten en çok harcayan top 10 müşteriyi görebilirsiniz.

---

### 7. Sipariş Yolculuğu (Order Journey)

**Ne yapar:** Belirli bir siparişin arkasındaki tüm yolculuğu gösterir: ilk ziyaretten satın alma anına kadar hangi kanallardan geçti?

**Örnek:**
```
İlk Temas → 14 gün önce → Instagram reklamı
Ara Temas  → 7 gün önce  → Google arama
Son Temas  → Bugün      → Direkt giriş → Sipariş ✓
Dönüşüm süresi: 14 gün · 3 dokunuş
```

**İş değeri:**
- "Hangi kanal satıyor?" sorusunu gerçek satış verisiyle cevaplar (tıklama değil, dönüşüm).
- Son temas mi, ilk temas mı daha önemli? Kendi verinizle görürsünüz.
- Reklam bütçenizi gerçekten dönüştüren kanallara yönlendirirsiniz.

---

### 8. Stok-Talep Alarmı

**Ne yapar:** Şu an birden fazla kişinin aktif olarak baktığı veya sepete eklediği ürünleri "sıcaklık" skoruyla listeler.

**İş değeri:**
- "Bu ürün çok ilgi görüyor, stokta kaç kaldı?" sorusunu anlık yanıtlar.
- Stok uyarısı göstermek için zamanlama yapabilirsiniz.
- Yüksek talep + düşük stok kombinasyonunda aciliyet mesajı hazırlanabilir.

---

### 9. Gizli Sepet Dedektörü

**Ne yapar:** Sepete ürün eklemiş ama checkout başlatmadan sitede gezinmeye devam eden ziyaretçileri gösterir.

**İş değeri:**
- Bu ziyaretçiler teknik olarak "terk etmedi" — hâlâ sitede.
- Sepetinde ürün var ama ödemeye geçmemiş → en kolay dönüştürülecek grup.
- Doğru anda indirim pop-up'ı veya chatbot tetiklenebilir.

---

### 10. Trafik Kaynağı ve UTM Analizi

**Ne yapar:** Ziyaretçilerin nereden geldiğini (Google, Instagram, TikTok, Akakçe, Hepsiburada...) ve UTM kampanyalarının performansını gösterir. Kaynağa tıklayınca o kaynaktan gelen ziyaretçilerin detayına inebilirsiniz.

**İş değeri:**
- TikTok'tan gelen 50 kişiden 2'si alıyor, Instagram'dan gelen 30 kişiden 8'i alıyor → bütçe kararı.
- Akakçe, Hepsiburada, Cimri'den fiyat karşılaştırma trafiği geliyor mu? Görürsünüz.
- UTM parametrelerinizin çalışıp çalışmadığını doğrularsınız.

---

### 11. İç Arama Analizi

**Ne yapar:** Mağazanızın arama kutusunda ne arandığını ve kaç kez arandığını gösterir.

**İş değeri:**
- Müşteriler "kırmızı elbise" arıyor ama siz ürün adını "bordo elbise" koydunuz → SEO sorunu.
- Arama yapılıp sonuç bulunamayanlar → stok veya ürün adlandırma eksikliği.
- En çok aranan ürünleri öne çıkarmak için somut veri.

---

### 12. WA Otomasyon ROI Takibi

**Ne yapar:** Gönderilen her WhatsApp mesajından sonra gelen siparişleri eşleştirir ve net ROI hesaplar.

**İş değeri:**
- "Bu otomasyon gerçekten işe yarıyor mu?" sorusunu sayıyla cevaplar.
- Mesaj başına dönüşüm oranı, getirilen ciro, maliyet görürsünüz.
- Hangi mesaj şablonu daha iyi dönüşüyor? A/B karşılaştırması yapabilirsiniz.

---

## Rakiplerle Karşılaştırma

| Özellik | Shoptimize Live | Klaviyo | Tidio | Shopify Analytics |
|---------|----------------|---------|-------|-------------------|
| Gerçek zamanlı ziyaretçi takibi | ✅ | ❌ | ✅ (sınırlı) | ❌ |
| WhatsApp otomasyonu | ✅ | ❌ | ❌ | ❌ |
| Purchase Intent Score | ✅ | ❌ | ❌ | ❌ |
| RFM segmentasyonu | ✅ | ✅ (pahalı plan) | ❌ | ❌ |
| Sipariş yolculuğu | ✅ | ❌ | ❌ | ✅ (sınırlı) |
| Terk izleme + risk skoru | ✅ | ❌ | ✅ (sınırlı) | ❌ |
| Türkçe WA şablonları | ✅ | ❌ | ❌ | ❌ |
| Fiyat | **$9.99/ay** | $45–$700+/ay | $19–$329/ay | Dahili |

---

## Teknik Güvenilirlik

- **Veri saklama:** Ziyaretçi aktivite verileri 7 gün tutulur, otomatik silinir.
- **Müşteri verisi:** Ad, e-posta, telefon toplanmaz — tamamen anonim ziyaretçi ID'leri kullanılır. Müşteri bilgileri yalnızca Shopify'dan çekilir, Shoptimize sunucularında saklanmaz.
- **GDPR uyum:** Shopify'ın GDPR webhook'larına tam uyumlu — uygulama kaldırılırsa 48 saat içinde tüm veri silinir.
- **Uptime:** Coolify üzerinde containerized deployment, Redis + PostgreSQL yüksek erişilebilirlik.
- **Pixel performansı:** Asenkron yükleme, mağaza hızını etkilemez. Rate limiting: IP başına 60 event/dk.

---

## Kurulum Süreci

1. Shopify App Store'dan "Shop X-Ray WA Cart Recovery" kurulur.
2. Shopify, gerekli izinleri sorar (`read_checkouts`, `read_customers`, `read_orders`).
3. Onay verilince pixel otomatik yüklenir, abonelik onaylanır.
4. **Kurulum süresi: ~2 dakika.** Kod yazmak gerekmez.
5. WhatsApp otomasyonu için Meta Business API token'ı ayrıca girilir (opsiyonel).

---

## Hedef Müşteri Profili

**Birincil:**
- Aylık 50–5000 sipariş alan Shopify mağazaları
- WhatsApp'ı aktif kullanan veya kullanmak isteyen mağazalar
- Türkiye, MENA, Avrupa'daki Türkçe konuşan girişimciler

**İkincil:**
- GA'yı yeterince anlamayan ama satışlarını artırmak isteyen mağaza sahipleri
- Mevcut e-posta terk sepeti dönüşüm oranından memnun olmayanlar
- Müşteri segmentasyonu için Klaviyo gibi pahalı araçlara alternatif arayanlar

---

## Öne Çıkan Kullanım Senaryoları

**Senaryo 1 — Flash Sale İzleme**
> Cumartesi 12:00'de %30 indirim kampanyası açtınız. Shoptimize Live ile kaç kişinin geldiğini, hangilerinin ürüne baktığını, kaçının sepete eklediğini ve dönüşüm oranının saate göre nasıl değiştiğini anlık görürsünüz.

**Senaryo 2 — Terk Kurtarma**
> Bir ziyaretçi sepete 3 ürün ekliyor, checkout başlatıyor ama ödemiyor. 15 dakika sonra otomatik WhatsApp mesajı gidiyor: "Merhaba Ayşe, sepetindeki ürünler seni bekliyor 🛒". Ayşe tıklar ve siparişi tamamlar.

**Senaryo 3 — Kayıp Müşteri Geri Kazanımı**
> RFM analizi 45 "Lost" müşteri olduğunu gösteriyor. Bu müşterilerin listesini görüp özel bir "geri dön" kampanyası oluşturursunuz.

**Senaryo 4 — TikTok Reklamı Optimizasyonu**
> TikTok'tan 200 ziyaretçi geldi ama sadece 2 sipariş. Funnel'a baktığınızda ürün sayfasına geçiş çok düşük — videodaki ürünle mağazadaki ürün eşleşmiyor. Bunu aynı gün tespit edip düzeltirsiniz.

---

## Fiyatlandırma

| Plan | Fiyat | Kapsam |
|------|-------|--------|
| Temel | $9.99/ay | Tüm özellikler dahil |
| Deneme | 7 gün ücretsiz | Kredi kartı gerekmez |

Tüm özellikler tek planda — widget bazlı paket yok. Shopify Billing üzerinden yönetilir, istediğiniz zaman iptal edilebilir.

---

## Sık Sorulan Sorular

**Q: Pixel mağaza hızını etkiler mi?**  
A: Hayır. Script asenkron yüklenir, ana sayfanın render'ını bloklamaz. GTmetrix ve PageSpeed skorunuzu etkilemez.

**Q: WhatsApp için ne gerekiyor?**  
A: Meta WhatsApp Business API erişimi (Meta Business Manager üzerinden başvurulur) ve onaylı mesaj şablonları. Shoptimize Live, şablon oluşturma ve Meta'ya gönderme sürecinde yardımcı olur.

**Q: Verilerim ne kadar güvende?**  
A: Müşteri adı/e-posta/telefon Shoptimize sunucularında saklanmaz. Ziyaretçi aktivite verileri anonim ID'lerle tutulur ve 7 günde silinir.

**Q: Shopify dışı mağazaları destekliyor mu?**  
A: Şu an yalnızca Shopify. Diğer platformlar planlamada.

**Q: Birden fazla mağazam var, ne yapmalıyım?**  
A: Her mağaza ayrı kurulum gerektirir. Multi-brand yönetimi için destek ile iletişime geçin.
