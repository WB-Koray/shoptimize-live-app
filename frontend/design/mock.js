// fetch + EventSource sahtesi. Panel backend OLMADAN, gercek verinin
// sekliyle calissin diye.
//
// Neden ayri bir tezgah: tasarim isi onlarca yineleme demek. Her yineleme icin
// Docker + API + Redis + Postgres ayaga kaldirmak ve canli veriyi beklemek,
// bakmayi o kadar pahali hale getiriyor ki insan bakmadan yaziyor - bugune
// kadar olan tam olarak buydu.

import { olaylariUret, gunlukUret, siparisUret, MUSTERI } from './fixtures.js';

const OLAYLAR = olaylariUret();

/** Panelin cagirdigi her ucu karsilar. Listede olmayan uc {ok:true} doner;
 *  tasarim icin onemli olan "istek patlamasin" ve duzen bozulmasin. */
const UCLAR = {
  '/api/auth/status': () => ({ ok: true, valid: true }),

  '/api/shopify/pixel/status': () => ({
    ok: true, installed: true, method: 'theme_extension',
    tid: 'spt_devtest0001', shop_domain: 'welcomebaby.com.tr',
  }),

  '/api/live/checkout-stats': () => ({
    ok: true,
    started_count: 38, abandoned_count: 22,
    started: [], abandoned: [],
  }),

  '/api/live/stats/daily': (u) => {
    const gun = Number(new URL(u, location.origin).searchParams.get('days') || 30);
    const tum = gunlukUret(gun * 2);
    const topla = (s) => {
      const alan = ['events', 'visitors', 'product_viewed', 'add_to_cart',
                    'cart_viewed', 'checkout_started', 'checkout_completed',
                    'search_submitted'];
      const t = Object.fromEntries(alan.map(a => [a, s.reduce((x, y) => x + y[a], 0)]));
      t.revenue = s.reduce((x, y) => x + y.revenue, 0);
      t.has_data = s.some(y => y.has_data);
      return t;
    };
    return {
      ok: true, since: tum[11].date,
      days: tum.slice(0, gun), totals: topla(tum.slice(0, gun)),
      previous: topla(tum.slice(gun)),
      channels: [
        { key: 'direct', count: 1352 }, { key: 'google', count: 623 },
        { key: 'facebook', count: 228 }, { key: 'welcomebaby.com.tr', count: 37 },
        { key: 'shopify_email', count: 28 }, { key: 'whatsapp', count: 20 },
        { key: 'tiktok', count: 13 }, { key: 'api6.akakce.com', count: 3 },
      ],
      products: [
        { key: 'Skip Hop Zoo Çocuk Sırt Çantası Tilki', count: 10 },
        { key: 'Skip Hop Zoo Pipetli Suluk Tilki 384ml', count: 10 },
        { key: "Mummy's Baby Kısa Kollu Body", count: 9 },
        { key: 'Skip Hop Zoo Pipetli Suluk Lama 384ml', count: 8 },
        { key: 'Skip Hop Zoo Unicorn Bisiklet', count: 8 },
        { key: "Mummy's Baby Uzun Kol Body", count: 7 },
        { key: 'Skip Hop Sırt Çantası Arı', count: 7 },
      ],
    };
  },

  '/api/flow/orders': () => ({ ok: true, orders: siparisUret(50) }),
  '/api/flow/roi': () => ({
    ok: true, wa_orders: 4, wa_revenue: 4484.32, attribution_rate: 7,
    orders: siparisUret(4),
  }),
  '/api/flow/settings': () => ({
    ok: true, settings: {
      enabled: true, wa_token: 'EAAx***ZDZD', phone_number_id: '513385117106438',
      waba_id: '106388568722083',
      sequence: [
        { delay_minutes: 20, template: 'sepet_hatirlatma_link', lang: 'TR', enabled: true },
        { delay_minutes: 1440, template: 'sepet_hatirlatma_2_link', lang: 'TR', enabled: true },
        { delay_minutes: 2880, template: 'sepet_hatirlatma_3_link', lang: 'TR', enabled: true },
      ],
      cooldown_hours: 48, window_start: 9, window_end: 21, min_cart_total: 0,
      post_order: { enabled: false },
    },
  }),
  '/api/flow/logs': () => ({
    ok: true, logs: Array.from({ length: 24 }, (_, i) => ({
      name: ['fatma yavuz', 'Merve Sarımusaoglu', 'esra çerçioğlu', 'TUĞBA DEMİREL'][i % 4],
      phone: '***' + (1000 + i), product: 'Skip Hop Paslanmaz Çelik Termos Koala 325ml',
      sent_count: 1 + (i % 3), ts: Date.now() - i * 3600000, status: 'sent',
    })),
  }),
  '/api/flow/optouts': () => ({
    ok: true, optouts: Array.from({ length: 131 }, (_, i) => ({
      phone: '+9055' + String(10000000 + i), name: i % 3 ? `Müşteri ${i}` : '',
    })),
  }),
  '/api/flow/template-status': () => ({ ok: true, templates: [], approved: 34, total: 35 }),
  '/api/flow/template-defaults': () => ({ ok: true, templates: [] }),
  '/api/flow/embedded-config': () => ({ ok: true, config_id: '', app_id: '' }),

  '/api/campaign/list': () => ({
    ok: true, campaigns: [
      { id: 'c1', name: 'Erken Kasım kampanyamız başladı! Seçili ürünlerde',
        message: 'Erken Kasım kampanyamız başladı! Seçili ürünlerde',
        status: 'sent', sent: 2480, total: 2481, delivered: 1951, read: 60, clicks: 128,
        audience: 'SMS pazarlama onaylı', ts: Date.now() - 2 * 3600000 },
      { id: 'c2', name: 'Yaz sezonuna özel %25e varan indirimleri kaçır',
        message: 'Yaz sezonuna özel %25e varan indirimleri kaçır',
        status: 'sent', sent: 141, total: 142, delivered: 0, read: 0, clicks: 1,
        audience: 'Tüm müşteriler (sipariş verenler)', ts: Date.now() - 120 * 86400000 },
    ],
  }),
  '/api/campaign/templates': () => ({ ok: true, templates: [
    { name: 'sepet_hatirlatma_3_link', language: 'tr', status: 'APPROVED', category: 'MARKETING' },
  ] }),
  '/api/campaign/audience': () => ({ ok: true, total: 2481, segments: {} }),

  '/api/shopify/products/stock': () => ({ ok: true, products: {} }),
  '/api/shopify/customers/rfm': () => ({ ok: true, segments: {}, has_data: false }),
};

export function mockKur() {
  // ── fetch ────────────────────────────────────────────────────────────────
  const gercekFetch = window.fetch.bind(window);
  window.fetch = async (girdi, secenek) => {
    const url = typeof girdi === 'string' ? girdi : girdi.url;
    let yol;
    try { yol = new URL(url, location.origin).pathname; } catch { yol = url; }

    const el = UCLAR[yol];
    const govde = el ? el(url, secenek) : { ok: true };
    // Gercek bir agda olacagi gibi kucuk bir gecikme: yukleme durumlari da
    // tasarimin parcasi, aninda dolan ekran yaniltici olur.
    await new Promise(r => setTimeout(r, 120));
    if (!el && !yol.startsWith('/api/')) return gercekFetch(girdi, secenek);
    return new Response(JSON.stringify(govde), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };

  // ── EventSource ──────────────────────────────────────────────────────────
  // Panel SSE'den besleniyor. Sunucu once GECMISI en eskiden en yeniye
  // gonderir, sonra canli olaylar akar - tezgah da aynisini yapmali, yoksa
  // sirayla ilgili hatalar burada gorunmez.
  class SahteEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.({});
        const gecmis = [...OLAYLAR].reverse();   // en eskiden en yeniye
        for (const ev of gecmis) this.onmessage?.({ data: JSON.stringify(ev) });
      }, 60);
    }
    close() { this.readyState = 2; }
  }
  window.EventSource = SahteEventSource;

  // Ses ve bildirim tasarim tezgahinda sessiz kalsin
  window.Audio = class { play() { return Promise.resolve(); } };
  if (!('Notification' in window)) window.Notification = { permission: 'denied' };
}

export const SAHTE_OTURUM = {
  username: 'koray@korayyildiz.com.tr',
  brand: 'default',
  token: 'tasarim-tezgahi',
  shop: 'welcomebaby.com.tr',
  tid: 'spt_devtest0001',
};

export { MUSTERI };
