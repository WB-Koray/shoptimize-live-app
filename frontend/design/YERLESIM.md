# Yerleşim Sözleşmesi

Bu dosya panelin **ne kadar yer kaplayacağına** dair kuralları tutar.

Neden var: kurallar yazılı olmadığı sürece her bileşen kendi yüksekliğini,
boşluğunu ve yoğunluğunu kendisi seçiyor. 40 bileşen, 40 ayrı karar, birikerek
4 ekran boyunda bir sayfa. Sorun yetenek değil, kuralsızlık — nitekim bir
sözleşmeyle kurulan Performans alanı 1.0 ekran, sözleşmesiz büyüyen Şimdi
alanı 4.1 ekran çıktı.

Her değişiklikten sonra ölçülür:

```bash
cd frontend && node design/bak.mjs
```

---

## 1. Sayfa yüksekliği bütçesi

Bütçe ekran genişliğine göre değişir: aynı içerik dar ekranda zorunlu olarak
daha uzundur. Üçü de `bak.mjs` ile ölçülür.

| Alan | 1440 (masaüstü) | 768 (tablet) | 390 (telefon) |
|------|-----------------|--------------|----------------|
| Şimdi | ≤ 2.0 | ≤ 2.5 | ≤ 3.0 |
| Performans | ≤ 2.0 | ≤ 2.5 | ≤ 3.0 |
| Kurtarma | ≤ 2.0 | ≤ 2.5 | ≤ 3.0 |
| Plan, Opt-out | ≤ 1.0 | ≤ 1.5 | ≤ 2.0 |

Hedef masaüstünde **1.5**. Bir ekran = o genişliğin viewport yüksekliği
(900 / 1024 / 844 px).

### Yükseklik sınırları kırılıma bağlanır

`max-h-*` değerleri `sm:` değil, düzenin **çok sütuna geçtiği** kırılıma
bağlanır (bu panelde `xl:`). 768px'de düzen hâlâ tek sütun; orada masaüstü
sınırını vermek sayfayı 2.7 ekrana çıkarıyordu.

```jsx
max-h-[300px] sm:max-h-[360px] xl:max-h-[460px]
```

### Tailwind kırılımları KAPSAYICIYA değil EKRANA bakar

Dar bir sütunun içindeki ızgara `xl:grid-cols-4` derse, 1440px ekranda 530px
genişliğindeki kapsayıcıya dört sütun sıkıştırır — 125px'lik kartlar ve
okunamayan metin. Sütun sayısı **kapsayıcının gerçek genişliğine** göre
seçilir.

Üst sınırı aşan bir sayfa kabul edilmez. Yeni bir bölüm eklemek, bütçeyi
aşıyorsa **başka bir bölümün yerini almak** zorundadır. Alt alta eklemek
serbest değildir.

## 2. Katlamanın üstü (fold)

Kaydırmadan görünen ilk ekranda **yalnız o alanın asıl işi** durur:

| Alan | Katlamanın üstünde |
|------|--------------------|
| Şimdi | Canlı durum sayıları + şu an sitede olanlar + canlı akış |
| Performans | Dönem seçici + KPI satırı + trend |
| Kurtarma | Kurtarma hunisi (terk → mesaj → dönüş → ciro) |

Geri kalan her şey katlamanın altında ve **tek bir sekmeli bölümde** toplanır.
Yan yana duran bağımsız bölümler yığmak yasak.

## 3. Uzun listeler sayfayı uzatmaz

Ziyaretçi listesi, canlı akış, gönderim geçmişi gibi **uzunluğu veriye bağlı**
hiçbir liste sayfayı uzatamaz. Kendi kutusunda kaydırılır:

```jsx
<div className="max-h-[520px] overflow-y-auto">
```

`100vh` tabanlı tam ekran kabuk **kullanılmaz**: uygulama Shopify Admin içinde
iframe olarak çalışıyor ve iframe yüksekliği her zaman güvenilir değil. Sabit
`max-h-*` değerleri iframe davranışından bağımsız olarak çalışır.

## 4. Yoğunluk ölçeği

Bileşen kendi boşluğunu icat etmez. Kullanılacak değerler:

| Amaç | Değer |
|------|-------|
| Bölümler arası | `gap-3` (12px) |
| Kart içi dolgu | `p-3` (12px), yoğun listelerde `px-3 py-2` |
| Kart köşesi | `rounded-xl` (kart), `rounded-2xl` (bölüm) |
| Bölüm başlığı | `text-[10px] font-semibold uppercase tracking-wide text-textMute` |
| KPI sayısı | `text-xl font-bold tabular-nums` |
| Liste satırı | `text-[11px]`, satır yüksekliği ≤ 36px |

`gap-4`, `p-4`, `space-y-4` **kullanılmaz** — eski panelin uzunluğunun sessiz
sebebi buydu.

## 5. Ekran genişlikleri

Üçü de her değişiklikte ölçülür: **1440 · 768 · 390**.

- 390'da yatay taşma olamaz (`bak.mjs` raporlar).
- Çok sütunlu ızgaralar `md:` ve `lg:` kırılımlarıyla tanımlanır; yalnız `lg:`
  vermek telefonda tek sütuna düşmek demektir ve genelde istenen budur, ama
  **bilerek** seçilmelidir.

## 6. Erişilebilirlik — yeni yazılan her şeyde

- İkon-only her düğmede `aria-label`
- Açılır bölümlerde `aria-expanded`
- Seçili sekme/filtre düğmelerinde `aria-pressed`
- Dekoratif ikonlarda `aria-hidden="true"`
- Grafiklerin yanında tablo görünümü

Panelin 87 butonundan sıfırında bu niteliklerden biri yoktu; yeni yazılanlarda
olacak.

## 7. Sayı gösterme kuralı

Aynı ekranda **farklı zaman tabanlı sayılar yan yana durmaz**. Duracaksa her
birinin dönemi etiketinde yazar.

Bu kuralın sebebi somut: üst sıradaki sekiz kartın bir kısmı son yarım saati,
bir kısmı bugünü gösteriyordu; merchant ikisini bölüp yanlış dönüşüm oranı
çıkarıyordu.

Ayrıca: elde olmayan bir aralık iddia edilmez. "Son 10 dakika" yazmak için
elde 10 dakikalık veri olmalı — yoksa gerçek pencere hesaplanıp yazılır.
