// Panelin HER alanini, HER ekran genisliginde acip olcer ve ekran goruntusu alir.
//
// Neden: bugune kadar tasarim korlemesine yapildi - yazip yayinlayip
// kullanicinin ekran goruntusu gondermesi beklendi. "Bu sayfa cok uzun" bir
// testle degil BAKMAKLA anlasilir. Bu script bakmayi ucuz hale getiriyor.
//
// Olctugu sey: sayfanin kac EKRAN boyu oldugu (scrollHeight / viewport).
// Kullanicinin sikayeti "4-5 scroll yapiyorum" idi; bu sayi tam olarak o.
//
// Kullanim:
//   npm run tasarim            (ayri terminalde, dev sunucusu)
//   node design/bak.mjs                     -> hepsi, acik tema
//   node design/bak.mjs --alan simdi        -> tek alan
//   node design/bak.mjs --tema dark
//   node design/bak.mjs --genislik 390

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const ARG = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) =>
    x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a, [])
);

const SUNUCU = ARG.url || 'http://localhost:5174/design.html';
const CIKTI  = ARG.cikti || path.join(process.cwd(), 'design', 'goruntu');

// Alan -> ust navigasyondaki dugme metni
const ALANLAR = {
  simdi:      'Şimdi',
  performans: 'Performans',
  kurtarma:   'Kurtarma',
  plan:       'Plan',
};

const EKRANLAR = [
  { ad: 'masaustu', genislik: 1440, yukseklik: 900 },
  { ad: 'tablet',   genislik: 768,  yukseklik: 1024 },
  { ad: 'telefon',  genislik: 390,  yukseklik: 844 },
];

const secilenAlanlar = ARG.alan ? [ARG.alan] : Object.keys(ALANLAR);
const secilenEkranlar = ARG.genislik
  ? EKRANLAR.filter(e => String(e.genislik) === String(ARG.genislik))
  : EKRANLAR;
const tema = ARG.tema || 'light';

mkdirSync(CIKTI, { recursive: true });

const tarayici = await chromium.launch();
const sonuclar = [];

for (const ekran of secilenEkranlar) {
  const baglam = await tarayici.newContext({
    viewport: { width: ekran.genislik, height: ekran.yukseklik },
    deviceScaleFactor: 1,
    locale: 'tr-TR',
  });
  const sayfa = await baglam.newPage();

  const hatalar = [];
  sayfa.on('pageerror', e => hatalar.push(String(e.message)));
  sayfa.on('console', m => { if (m.type() === 'error') hatalar.push(m.text().slice(0, 160)); });

  await sayfa.goto(`${SUNUCU}?tema=${tema}&dil=tr`, { waitUntil: 'domcontentloaded' });
  // Sahte SSE gecmisi akip bitsin, memolar otursun
  await sayfa.waitForTimeout(2500);

  for (const alan of secilenAlanlar) {
    const etiket = ALANLAR[alan];
    if (!etiket) { console.log(`  ! bilinmeyen alan: ${alan}`); continue; }

    try {
      const dugme = sayfa.locator('button', { hasText: etiket }).first();
      await dugme.waitFor({ state: 'visible', timeout: 8000 });
      await dugme.click();
      await sayfa.waitForTimeout(1600);
    } catch (e) {
      console.log(`  ! ${alan} alanina gecilemedi: ${e.message.slice(0, 80)}`);
    }

    const olcum = await sayfa.evaluate(() => ({
      sayfaYuksekligi: document.documentElement.scrollHeight,
      ekranYuksekligi: window.innerHeight,
      yatayTasma: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollGenisligi: document.documentElement.scrollWidth,
      pencereGenisligi: window.innerWidth,
    }));

    const dosya = path.join(CIKTI, `${alan}-${ekran.ad}-${tema}.png`);
    await sayfa.screenshot({ path: dosya, fullPage: true });

    sonuclar.push({
      alan, ekran: ekran.ad, genislik: ekran.genislik,
      ekranSayisi: +(olcum.sayfaYuksekligi / olcum.ekranYuksekligi).toFixed(1),
      piksel: olcum.sayfaYuksekligi,
      yatayTasma: olcum.yatayTasma,
      hata: hatalar.length,
      dosya,
    });
  }

  if (hatalar.length) {
    console.log(`\n  KONSOL HATALARI (${ekran.ad}):`);
    [...new Set(hatalar)].slice(0, 6).forEach(h => console.log('    ' + h));
  }
  await baglam.close();
}

await tarayici.close();

// ── Rapor ───────────────────────────────────────────────────────────────────
const b = (s, n) => String(s).padEnd(n);
console.log('');
console.log(b('alan', 12) + b('ekran', 10) + b('genislik', 10) +
            b('kac ekran', 11) + b('piksel', 9) + 'notlar');
console.log('-'.repeat(72));

for (const r of sonuclar) {
  const notlar = [];
  // 2 ekrandan uzun bir sayfa "bir bakista anlasilir" olmaktan cikar.
  if (r.ekranSayisi > 3) notlar.push('COK UZUN');
  else if (r.ekranSayisi > 2) notlar.push('uzun');
  if (r.yatayTasma) notlar.push('YATAY TASMA');
  if (r.hata) notlar.push(`${r.hata} konsol hatasi`);
  console.log(b(r.alan, 12) + b(r.ekran, 10) + b(r.genislik, 10) +
              b(r.ekranSayisi, 11) + b(r.piksel, 9) + notlar.join(' · '));
}
console.log('');
console.log(`Goruntuler: ${CIKTI}`);
console.log('Olcut: 1 ekran = tek bakista gorunur. 2+ = kaydirma gerekir. 3+ = kayboluyor.');
