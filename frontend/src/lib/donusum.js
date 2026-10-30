// Ziyaretci -> "bu ziyarette satin aldi" eslestirmesi.
//
// Neden ayri dosya: bu mantik sessizce yanlis calisabiliyor ve yanlisligi
// ancak bir merchant "bu musteri satin almadi ki" dediginde fark ediliyor.
// Disari alinca test edilebiliyor.
//
// checkout_completed olayi her zaman gelmiyor (misafir odeme, sunucu yeniden
// baslayinca kaybolan oturum sozlugu). Bu yuzden siparis listesiyle capraz
// kontrol gerekiyor. Ama kontrol ZAMANLA SINIRLI olmak zorunda:
//
//   vid localStorage'da saklaniyor  -> tarayici basina KALICI
//   convertedOrders son 30 gun      -> eski siparisler listede duruyor
//
// Sinirsiz eslestirilince son 30 gunde siparis vermis her musteri, siteye her
// girdiginde "Satin Aldi" goruntuleniyordu - sadece geziyor olsa bile.

/** Yalniz son 2 saatin siparisleri bu ziyaretle iliskilendirilebilir. */
export const SIPARIS_PENCERESI = 2 * 60 * 60 * 1000;

/** Event penceresi kirpildigi icin firstTs gercek oturum basindan sonra
 *  olabiliyor; bu pay o kirpilmayi tolere eder. */
export const OTURUM_PAYI = 30 * 60 * 1000;

/**
 * @param {object} profil      {vid, firstTs, lastTs, stage}
 * @param {object} indeks      hazirlaSiparisIndeksi() ciktisi
 * @returns {boolean} bu ziyarette satin alma olmus mu
 */
export function satinAldiMi(profil, indeks) {
  if (profil.stage === 'converted') return true;

  const siparisTs = indeks.vidSiparisTs.get(profil.vid);
  // Siparis BU ziyaretin icinde verilmis olmali. Daha eskisi onceki bir
  // ziyarete ait; ayni kisi olsa bile su anki gezinme bir satin alma degil.
  if (siparisTs && siparisTs >= profil.firstTs - OTURUM_PAYI) return true;

  // vid'i olmayan siparisler icin zaman damgasi yedegi. Yalniz odeme adiminda
  // olanlara uygulanir: gezinen birini siparisle eslestirmek icin cok zayif
  // bir kanit.
  if (profil.stage === 'checkout' && indeks.vidsiz.length) {
    return indeks.vidsiz.some(
      o => o.ts >= profil.lastTs && o.ts - profil.lastTs < SIPARIS_PENCERESI
    );
  }
  return false;
}

/** Siparis listesini bir kez tarayip arama yapilari kurar. */
export function hazirlaSiparisIndeksi(siparisler, simdiMs = Date.now()) {
  const yakin = (siparisler || []).filter(
    o => o && o.ts && simdiMs - o.ts < SIPARIS_PENCERESI
  );
  const vidSiparisTs = new Map();
  for (const o of yakin) {
    if (!o.vid) continue;
    if ((vidSiparisTs.get(o.vid) || 0) < o.ts) vidSiparisTs.set(o.vid, o.ts);
  }
  return { vidSiparisTs, vidsiz: yakin.filter(o => !o.vid) };
}
