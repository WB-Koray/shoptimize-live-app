// Tasarim tezgahi icin gercekci sahte veri.
//
// Neden: panelin yerlesimini ancak DOLU haliyle degerlendirebiliriz. Bos bir
// ekran her zaman duzenli gorunur; sorun 200 ziyaretci ve 600 olay varken
// ortaya cikiyor. Buradaki hacimler canli Welcome Baby verisinden alindi.

const URUNLER = [
  ['Roly Poly Uzun Kol Pijama Takım Lacivert', 'roly-poly-pijama-lacivert', 1199.99, 18],
  ['Skip Hop Zoo Pipetli Suluk Tilki 384ml', 'skip-hop-suluk-tilki', 350, 10],
  ['Micro Mini Deluxe 3 Tekerlekli Scooter Black', 'micro-mini-scooter-black', 3250, 15],
  ['Paw Patrol Pup Squad Yarışçıları', 'paw-patrol-pup-squad', 499.9, 19],
  ["Carter's Layette Erkek Bebek 3'lü Hırkalı Set", 'carters-layette-hirkali', 807, 2],
  ['Lego Classic Yaratıcı Evcil Hayvanlar 11034 Yapım Seti (450 Parça)', 'lego-classic-11034', 1699, 8],
  ['Skip Hop Zoo Beslenme Çantası Tilki', 'skip-hop-beslenme-tilki', 980, 26],
  ['Les Artistes Paris Isı Yalıtımlı Kutu Çelik Termos 280ml Sugar Skull', 'les-artistes-sugar-skull', 1799, 15],
  ['Agu Baby Fay Emzik Sterilizatörü', 'agu-baby-sterilizator', 1999, 7],
  ['Skip Hop Dream Shine Uyku Eğitimi Gece Lambası', 'skip-hop-gece-lambasi', 2099.99, 1],
  ['Pasito A Pasito Cherry Sincap Spiral Aktivite Oyuncağı Flowers', 'pasito-cherry-sincap', 2450, 26],
  ['Walking Mum Sintra Termos Çantası Green', 'walking-mum-sintra', 2499, 13],
];

const ARAMALAR = [
  'skip hop', 'skip hop çanta köpek balığı', 'erkek bebek takım', 'yengeç',
  'carters', 'lego', 'fisher price', 'skip hop tilki', 'skip hop termos',
  '4066239126139', 'rakun', 'önlük', 'simit', 'dock n bay uyku bantı',
];

const KOLEKSIYONLAR = [
  ['erken-kasim-firsatlari', 30], ['carters', 5], ['les-artistes-paris', 3],
  ['oyuncak', 4], ['pelus', 2], ['micro', 1], ['ayakkabi-terlik', 1],
];

const SAYFALAR = [
  ['/blogs/anne-ve-bebek/cin-takvimine-gore-bebek-cinsiyeti-hesaplama', 'Çin Takvimine Göre Bebek Cinsiyeti Hesaplama - 2026 – Welcome Baby'],
  ['/pages/kampanyalar', 'Welcome Baby Sezon Kampanyaları | Güncel İndirim ve Fırsatlar'],
  ['/pages/magazalarimiz', 'Mağazalarımız – Bebek Ürünleri Deneyim Noktaları – Welcome Baby'],
  ['/blogs/cocuk-guvenligi/adac-testli-oto-koltuklari', 'ADAC Testli Oto Koltukları Hakkında Her Şey – Welcome Baby'],
];

const KAYNAKLAR = [
  { referrer: '', utm: {} },                                               // direct
  { referrer: 'https://www.google.com/', utm: {} },                        // search
  { referrer: 'https://l.instagram.com/', utm: { utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'SE | 20 Eylül | Bebek Giyim-Cataloglar' } },
  { referrer: 'https://welcomebaby.com.tr/', utm: {} },
  { referrer: '', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'Google Ads' } },
  { referrer: '', utm: { utm_source: 'shopify_email', utm_medium: 'email', utm_campaign: 'Erken Kasım Fırsatları başladı: %50ye varan indirim_182005104831' } },
  { referrer: '', utm: { utm_source: 'whatsapp', utm_medium: 'campaign', utm_campaign: 'ab669743982b4159' } },
];

const ADLAR = [
  ['Tuğba', 'DEMİREL'], ['Emine', 'Sarı'], ['fatma', 'yavuz'], ['veli', 'güneysu'],
  ['Berk', 'Odabaşı'], ['Begüm Çağan', 'BÜYÜKER'], ['Işık', 'Yılmaz'],
];

let _tohum = 42;
/** Deterministik rastgelelik: her calistirmada AYNI ekran cikmali, yoksa
 *  iki ekran goruntusunu karsilastirmak imkansiz olur. */
function rnd() {
  _tohum = (_tohum * 1103515245 + 12345) & 0x7fffffff;
  return _tohum / 0x7fffffff;
}
const sec = (a) => a[Math.floor(rnd() * a.length)];

export function olaylariUret({ ziyaretci = 200, olay = 620 } = {}) {
  _tohum = 42;
  const simdi = Date.now();
  const vidler = Array.from({ length: ziyaretci }, (_, i) => {
    const k = sec(KAYNAKLAR);
    return {
      vid: 'vis_' + (i + 1000).toString(36).padStart(6, '0'),
      ...k,
      ua: rnd() > 0.7 ? 'Mozilla/5.0 (Macintosh)' : 'Mozilla/5.0 (iPhone)',
      sw: rnd() > 0.7 ? 1440 : 390,
      customer_id: rnd() > 0.93 ? String(8000000000000 + i) : '',
    };
  });

  const olaylar = [];
  const ekle = (v, tip, data = {}, url = '/') => {
    olaylar.push({
      vid: v.vid, event_type: tip, ts: simdi - Math.floor(rnd() * 5 * 60 * 1000),
      url, referrer: v.referrer, utm: v.utm, ua: v.ua, sw: v.sw,
      customer_id: v.customer_id, data,
    });
  };

  while (olaylar.length < olay) {
    const v = sec(vidler);
    const r = rnd();
    if (r < 0.34) {
      const [, handle, , ] = sec(URUNLER);
      ekle(v, 'page_viewed', { title: sec(SAYFALAR)[1] }, sec(SAYFALAR)[0] + (handle ? '' : ''));
    } else if (r < 0.62) {
      const [title, handle, price] = sec(URUNLER);
      ekle(v, 'product_viewed',
        { product_title: title, product_handle: handle, product_price: String(price),
          product_image: '' }, '/products/' + handle);
    } else if (r < 0.72) {
      ekle(v, 'attention_time', { seconds: 10 + Math.floor(rnd() * 120) }, '/search');
    } else if (r < 0.80) {
      ekle(v, 'scroll_depth', { depth: sec([25, 50, 75, 100]) }, '/products/' + sec(URUNLER)[1]);
    } else if (r < 0.88) {
      ekle(v, 'search_submitted', { query: sec(ARAMALAR) }, '/search');
    } else if (r < 0.94) {
      const [ad] = sec(KOLEKSIYONLAR);
      ekle(v, 'collection_viewed', { collection_handle: ad }, '/collections/' + ad);
    } else if (r < 0.97) {
      const [title, handle, price] = sec(URUNLER);
      ekle(v, 'add_to_cart', { product_title: title, product_handle: handle, price: String(price) }, '/cart');
    } else if (r < 0.99) {
      ekle(v, 'checkout_started', {}, '/checkouts/x');
    } else {
      ekle(v, 'page_viewed', { title: '404 Bulunamadı – Welcome Baby' }, '/products/usb-look-and-say-christmas');
    }
  }
  // En yeniden eskiye: sunucu en eskiden gonderir, istemci basa ekler.
  return olaylar.sort((a, b) => b.ts - a.ts);
}

export function gunlukUret(gun = 30) {
  _tohum = 7;
  const simdi = Date.now();
  return Array.from({ length: gun }, (_, i) => {
    const t = new Date(simdi - i * 86400000).toISOString().slice(0, 10);
    const veriVar = i < 12;                      // ilk 12 gun dolu, oncesi bos
    const z = veriVar ? 900 + Math.floor(rnd() * 1800) : 0;
    const urun = Math.floor(z * 0.72);
    const sepet = Math.floor(z * 0.035);
    const odeme = Math.floor(sepet * 0.33);
    const sip = Math.floor(odeme * 0.42);
    return {
      date: t, has_data: veriVar, events: z * 4, visitors: z,
      page_viewed: Math.floor(z * 1.4), product_viewed: urun,
      add_to_cart: sepet, cart_viewed: Math.floor(sepet * 1.3),
      checkout_started: odeme, checkout_completed: sip,
      search_submitted: Math.floor(z * 0.08),
      revenue: Math.round(sip * (900 + rnd() * 2200)),
    };
  });
}

export function siparisUret(n = 50) {
  _tohum = 99;
  const simdi = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const [ad, soyad] = sec(ADLAR);
    const [title] = sec(URUNLER);
    return {
      order_id: String(900000 + i), order_number: String(13300 + n - i),
      total_price: String(400 + Math.floor(rnd() * 4800)), currency: 'TRY',
      customer_name: `${ad} ${soyad}`, phone: '***' + (1000 + i),
      product: title, line_items: [{ title, quantity: 1, price: '980' }],
      channel: sec(['Direct', 'facebook / cpc', 'google / cpc', 'whatsapp / campaign']),
      vid: '', wa_attributed: rnd() > 0.7,
      ts: simdi - Math.floor(rnd() * 5 * 86400000),
    };
  });
}

export const MUSTERI = (id) => {
  const [ad, soyad] = sec(ADLAR);
  return {
    ok: true, customer_id: id, first_name: ad, last_name: soyad,
    email: `${ad.toLowerCase()}@example.com`, phone: '+90555*****',
    orders_count: Math.floor(rnd() * 5), total_spent: String(Math.floor(rnd() * 12000)),
    city: 'İstanbul',
  };
};

export { URUNLER, ARAMALAR, KOLEKSIYONLAR, SAYFALAR, ADLAR };
