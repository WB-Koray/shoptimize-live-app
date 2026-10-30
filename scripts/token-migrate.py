"""
Shopify offline token'larini SURESIZ -> EXPIRING tipine tasir.

Neden: Shopify 1 Ocak 2027'den sonra suresiz (non-expiring) offline
token'lari GraphQL Admin API'de reddedecek. Taşıma, merchant'in uygulamayi
acmasini beklemeden sunucu tarafinda yapilabiliyor.

DIKKAT - taşıma geri alinamaz:
    Shopify'in dogrudan taşıma akisi eski token'i Admin API icin KALICI
    olarak gecersiz kiliyor. Yanit kaybolursa AYNI eski token ile 7 gun
    icinde tekrar denenirse Shopify ayni cifti donuyor; bu yuzden eski token
    `admin_api_token_legacy` altinda saklanir, silinmez.

    7 gunluk kurtarma su durumlarda biter: yeni cift bir kez yenilendiginde,
    magaza icin yeni bir token alindiginda, ya da 7 gun gectiginde.

ONCE SIRAYI TAMAMLA:
    1. Bu kod canliya cikmis olmali (yenileme altyapisi + arka plan isci).
    2. SHOPIFY_EXPIRING_TOKENS=1 verilmis olmali.
    3. Ancak ondan sonra bu script ile mevcut magazalar tasinir.
    Sira bozulursa tasinan magazalar bir saat sonra yenilenemez.

Uygulama konteynerinde calistirilir (DSN ve SHOPIFY_CLIENT_* orada):

    python scripts/token-migrate.py durum
        Butun kayitlarin token tipini listeler. Hicbir sey degistirmez,
        token degeri basmaz.

    python scripts/token-migrate.py kontrol
        Saklanan token'lar GERCEKTEN calisiyor mu - her biriyle kucuk bir
        Admin API sorgusu atar. Salt okunur. Tasimadan once bunu calistir:
        olu bir token'a tasima denemek bir sey kanitlamaz.

    python scripts/token-migrate.py tasi --shop magaza.myshopify.com
        Tek magazayi tasir. --uygula verilmeden kuru calisir.

    python scripts/token-migrate.py tasi --hepsi --uygula
        Suresiz token'i olan TUM magazalari tasir.

    python scripts/token-migrate.py yenile --shop magaza.myshopify.com
        Expiring bir token'i hemen yeniler (yenileme akisini test eder).
"""
import argparse
import hashlib
import os
import sys
import time

# Proje kokunu yola ekle (scripts/ altindan calistirildiginda)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.db import (                                          # noqa: E402
    ShopLookupError, get_all_shopify_connections, get_payload,
    lookup_username_by_shop,
)
from services.shopify_token import (                                 # noqa: E402
    EXPIRING_ENABLED, K_EXPIRES, K_LEGACY, K_MIGRATED, K_REAUTH,
    K_REF_EXP, K_REFRESH, K_TOKEN, tasi, token_durumu, yenile,
)


def _ayarlar(kayit: dict) -> dict:
    """get_all_shopify_connections kaydindan birlesik ayar sozlugu."""
    ayar = (kayit.get("connection") or {}).get("settings") or {}
    alt = ayar.get("settings")
    if isinstance(alt, dict):
        ayar = {**ayar, **alt}
    return ayar


def _sure(sn: int) -> str:
    if not sn:
        return "-"
    if sn < 0:
        return f"DOLDU ({-sn // 60}dk once)"
    if sn < 7200:
        return f"{sn // 60}dk"
    if sn < 172800:
        return f"{sn // 3600}sa"
    return f"{sn // 86400}gun"


def _kayitlari_topla():
    """(username, brand, ayar) uclulerini doner - token'i olanlar once."""
    sonuc = []
    for kayit in (get_all_shopify_connections() or []):
        ayar = _ayarlar(kayit)
        sonuc.append((kayit["username"], kayit["brand"], ayar))
    return sorted(sonuc, key=lambda x: (not (x[2].get(K_TOKEN) or "").strip(), x[0]))


def _parmak(token: str) -> str:
    """Token'in kimligi - DEGERI SIZDIRMADAN. Ayni token = ayni parmak izi.

    Ayni magazaya bakan birden fazla kayit var; hangilerinin ayni token'i
    tuttugunu bilmeden tasima yapilamaz.
    """
    token = (token or "").strip()
    if not token:
        return "-"
    return hashlib.sha256(token.encode()).hexdigest()[:8]


def _aktif_kayitlar(kayitlar):
    """Her magaza icin uygulamanin GERCEKTEN okudugu kaydi bulur.

    Ayni shop_domain'e bakan birden fazla kayit olabilir (turetilmis
    username'li mukerrerler). lookup_username_by_shop hangisini sectiyse
    uygulama onu kullaniyor demektir; tasima da yalnizca ona yapilmali.

    Doner: {shop_domain_kucuk: (username, brand)}
    """
    sonuc = {}
    for shop in sorted({(a.get("shop_domain") or "").strip().lower()
                        for _, _, a in kayitlar if (a.get("shop_domain") or "").strip()}):
        try:
            bulunan = lookup_username_by_shop(shop)
        except ShopLookupError:
            bulunan = None
        if bulunan:
            sonuc[shop] = (bulunan[0], bulunan[1])
    return sonuc


def komut_durum(args):
    simdi = int(time.time())
    kayitlar = _kayitlari_topla()
    aktif = _aktif_kayitlar(kayitlar)

    # Magazaya gore grupla: mukerrer kayitlar ancak yan yana gorununce fark edilir.
    kayitlar.sort(key=lambda x: ((x[2].get("shop_domain") or "~").lower(), x[0], x[1]))

    print()
    print(f"SHOPIFY_EXPIRING_TOKENS = {'ACIK' if EXPIRING_ENABLED else 'KAPALI'}")
    print()
    basliklar = (f"{'magaza':34} {'username':38} {'brand':8} {'tip':9} {'kalan':9} "
                 f"{'billing':14} {'token':9} {'kul':4} not")
    print(basliklar)
    print("-" * len(basliklar))

    sayac = {"suresiz": 0, "expiring": 0, "yok": 0, "reauth": 0}
    magaza_sayisi = {}
    onceki_shop = None

    for u, b, ayar in kayitlar:
        token = (ayar.get(K_TOKEN) or "").strip()
        son_k = int(ayar.get(K_EXPIRES) or 0)
        ref   = (ayar.get(K_REFRESH) or "").strip()
        rson  = int(ayar.get(K_REF_EXP) or 0)
        shop  = (ayar.get("shop_domain") or "").strip()
        shop_k = shop.lower()

        if token:
            magaza_sayisi.setdefault(shop_k, []).append((u, b))

        if not token:
            tip = "YOK"; sayac["yok"] += 1
        elif son_k:
            tip = "expiring"; sayac["expiring"] += 1
        else:
            tip = "SURESIZ"; sayac["suresiz"] += 1

        kullanilan = aktif.get(shop_k) == (u, b)

        notlar = []
        if str(ayar.get(K_REAUTH) or "") == "1":
            notlar.append("REAUTH GEREK"); sayac["reauth"] += 1
        if son_k and ref:
            notlar.append(f"refresh {_sure(rson - simdi)}")
        if son_k and not ref:
            notlar.append("DIKKAT: expiring ama refresh YOK")
        if ayar.get(K_MIGRATED):
            gecen = simdi - int(ayar.get(K_MIGRATED) or 0)
            notlar.append(f"tasindi {_sure(gecen)} once")
            if gecen < 7 * 86400 and (ayar.get(K_LEGACY) or "").strip():
                notlar.append("kurtarma penceresi acik")

        # Magaza degisince bos satir - gruplar gozle ayrilsin
        if onceki_shop is not None and shop_k != onceki_shop:
            print()
        onceki_shop = shop_k

        print(f"{(shop or '-')[:34]:34} {u[:38]:38} {(b or '-')[:8]:8} {tip:9} "
              f"{_sure(son_k - simdi if son_k else 0):9} "
              f"{(ayar.get('billing_status') or '-')[:14]:14} {_parmak(token):9} "
              f"{'<<<' if kullanilan else '':4} {' - '.join(notlar)}")

    print()
    print(f"{len(kayitlar)} kayit: {sayac['expiring']} expiring, "
          f"{sayac['suresiz']} SURESIZ (tasinmasi gerekiyor), "
          f"{sayac['yok']} token yok, {sayac['reauth']} reauth bekliyor")
    print("<<< = uygulamanin bu magaza icin GERCEKTEN okudugu kayit "
          "(lookup_username_by_shop secimi)")

    # --- Mukerrer uyarisi: tasimanin en tehlikeli tarafi -------------------
    mukerrer = {k: v for k, v in magaza_sayisi.items() if len(v) > 1}
    if mukerrer:
        print()
        print("DIKKAT - ayni magazaya bakan birden fazla token'li kayit var:")
        for shop, liste in sorted(mukerrer.items()):
            secili = aktif.get(shop)
            print(f"  {shop}")
            for u, b in liste:
                isaret = "  <<< tasinacak olan" if (u, b) == secili else ""
                print(f"      {u} / {b}{isaret}")
        print("  Shopify magaza basina TEK gecerli token tutuyor. Ikinci bir kaydi")
        print("  tasimak birincinin ciftini emekliye ayirir. Bu yuzden --hepsi")
        print("  yalnizca <<< isaretli kayitlari tasir, digerlerini atlar.")

    if sayac["suresiz"] and not EXPIRING_ENABLED:
        print()
        print("UYARI: SHOPIFY_EXPIRING_TOKENS kapali. Once onu 1 yapip dagitin,")
        print("       sonra tasimayi yapin - yoksa magaza bir sonraki acilisinda")
        print("       tekrar suresiz token alir ve tasima geri alinmis olur.")
    print()


def _hedefleri_bul(args, sadece_tasinacak=False):
    """--shop / --user / --hepsi secimine gore (username, brand, ayar) listesi.

    --hepsi ve --shop MAGAZA secimidir: her magaza icin YALNIZCA uygulamanin
    okudugu kayit secilir. Ayni magazanin ikinci bir kaydini tasimak,
    birincinin yeni ciftini Shopify tarafinda emekliye ayirir - uygulama
    hangisini okuyorsa o olu kalabilir.

    --user KAYIT secimidir: ne istedigini bilerek veren icin, mukerrer
    filtresi uygulanmaz.
    """
    kayitlar = _kayitlari_topla()
    # Mukerrer filtresi magaza secimlerinde; --user acikca tek kaydi hedefler.
    magaza_secimi = bool(args.hepsi or args.shop) and not args.user
    aktif = _aktif_kayitlar(kayitlar) if magaza_secimi else {}
    hedef, atlanan = [], []

    for u, b, ayar in kayitlar:
        shop = (ayar.get("shop_domain") or "").strip().lower()
        token = (ayar.get(K_TOKEN) or "").strip()
        son_k = int(ayar.get(K_EXPIRES) or 0)

        if args.shop and shop != args.shop.strip().lower():
            continue
        if args.user and u != args.user:
            continue
        if args.hepsi and (not token or (sadece_tasinacak and son_k)):
            continue
        if magaza_secimi and shop in aktif and aktif[shop] != (u, b):
            atlanan.append((u, b, shop))
            continue
        hedef.append((u, b, ayar))

    if not (args.shop or args.user or args.hepsi):
        print("--shop, --user ya da --hepsi vermelisiniz.")
        sys.exit(2)

    if atlanan:
        print()
        print(f"{len(atlanan)} mukerrer kayit atlandi (ayni magazanin aktif "
              f"kaydi zaten listede):")
        for u, b, shop in atlanan:
            print(f"  {shop:36} {u} / {b}")

    return hedef


def komut_tasi(args):
    hedef = _hedefleri_bul(args, sadece_tasinacak=True)
    if not hedef:
        print("Eslesen / tasinmasi gereken kayit yok.")
        return

    kuru = not args.uygula
    print(f"\n{len(hedef)} kayit {'KURU PROVA' if kuru else 'TASINIYOR'}\n")

    if not kuru and not EXPIRING_ENABLED:
        print("DURDURULDU: SHOPIFY_EXPIRING_TOKENS kapali.")
        print("Tasinan magaza bir sonraki acilisinda tekrar suresiz token alir;")
        print("once o degiskeni 1 yapip dagitin. Yine de devam etmek icin --zorla.")
        if not args.zorla:
            sys.exit(3)
        print("--zorla verildi, devam ediliyor.\n")

    basari = 0
    for u, b, ayar in hedef:
        shop = ayar.get("shop_domain") or "-"
        sonuc = tasi(u, b, kuru=kuru)
        durum = sonuc.get("durum", "?")
        ek = ""
        if durum == "tasindi":
            ek = f"omur={sonuc['omur_sn']}sn refresh={_sure(sonuc['refresh_omur'])}"
            basari += 1
        elif durum == "zaten_expiring":
            ek = f"kalan={_sure(sonuc.get('kalan_sn') or 0)}"
        elif sonuc.get("mesaj"):
            ek = sonuc["mesaj"][:140]
        isaret = "OK " if sonuc.get("ok") else "BASARISIZ"
        print(f"  {isaret:10} {shop:36} {durum:18} {ek}")
        if not kuru:
            time.sleep(1)      # Shopify OAuth ucunu yormayalim

    if kuru:
        print("\nKuru prova - hicbir sey degismedi. Uygulamak icin --uygula ekleyin.\n")
    else:
        print(f"\n{basari}/{len(hedef)} tasindi. "
              f"Dogrulamak icin: python scripts/token-migrate.py durum\n")


def komut_yenile(args):
    """Yenileme akisini ELLE test eder.

    zorla=True sart: yenile() normalde son kullanmaya 10 dakikadan fazla
    varsa hicbir sey yapmadan mevcut token'i dondurur. O hâlde bu komut
    "OK" yazar ama aslinda hicbir sey kanitlamaz - token'in degisip
    degismedigi parmak izinden okunmali.
    """
    hedef = _hedefleri_bul(args)
    if not hedef:
        print("Eslesen kayit yok.")
        return
    for u, b, ayar in hedef:
        shop = ayar.get("shop_domain") or "-"
        onceki = token_durumu(u, b)
        if not onceki["son_kullanma"]:
            print(f"  ATLANDI    {shop:36} suresiz token - once tasinmali")
            continue

        eski_parmak = _parmak((get_payload(u, b, "shopify").get(K_TOKEN) or ""))
        yeni = yenile(u, b, zorla=True)
        sonraki = token_durumu(u, b)
        yeni_parmak = _parmak(yeni)

        if not yeni:
            print(f"  BASARISIZ  {shop:36} reauth_gerek={sonraki['reauth_gerek']}")
        elif yeni_parmak == eski_parmak:
            # Istek gitti ama token ayni kaldi: yenileme GERCEKLESMEDI.
            print(f"  DEGISMEDI  {shop:36} token {eski_parmak} ayni - "
                  f"yenileme calismadi, loglara bakin")
        else:
            print(f"  OK         {shop:36} token {eski_parmak} -> {yeni_parmak}  "
                  f"kalan={_sure(sonraki['kalan_sn'] or 0)} "
                  f"refresh={_sure((sonraki['refresh_son'] or 0) - int(time.time()))}")
        time.sleep(1)


_CANLI_SORGU = "{ shop { name myshopifyDomain } }"


def komut_kontrol(args):
    """Saklanan token'larin GERCEKTEN calisip calismadigini olcer.

    Tasima geri alinamaz ve olu bir token'a tasima denemek bir sey
    kanitlamaz - once hangilerinin canli oldugunu bilmek gerekir. Bu komut
    hicbir sey yazmaz: her kayit icin kucuk bir Admin API sorgusu atar.

    Yan fayda: uygulamanin gercekte hangi magazalarda kurulu oldugunu
    soyler. billing_status bayat olabiliyor (ornegin kaldirilmis bir
    magaza hala "active" gorunuyordu), bu olcum ise dogrudan Shopify'a
    soruyor.
    """
    import requests as _rq
    surum = os.getenv("SHOPIFY_API_VERSION", "2026-04")
    kayitlar = _kayitlari_topla()
    aktif = _aktif_kayitlar(kayitlar)
    kayitlar.sort(key=lambda x: ((x[2].get("shop_domain") or "~").lower(), x[0], x[1]))

    baslik = f"{'magaza':36} {'username':38} {'brand':8} {'token':9} {'sonuc':14} ayrinti"
    print()
    print(baslik)
    print("-" * len(baslik))

    sayac = {"canli": 0, "olu": 0, "yok": 0, "hata": 0, "atlandi": 0}
    for u, b, ayar in kayitlar:
        shop  = (ayar.get("shop_domain") or "").strip()
        token = (ayar.get(K_TOKEN) or "").strip()
        if not shop or not token:
            sayac["atlandi"] += 1
            continue
        if aktif.get(shop.lower()) != (u, b):
            # Mukerrer kayit: tasimayacagimiz icin olcmeye de gerek yok.
            sayac["atlandi"] += 1
            continue

        sonuc, ayrinti = "HATA", ""
        try:
            r = _rq.post(
                f"https://{shop}/admin/api/{surum}/graphql.json",
                json={"query": _CANLI_SORGU},
                headers={"X-Shopify-Access-Token": token,
                         "Content-Type": "application/json"},
                timeout=15,
            )
            if r.status_code == 200:
                veri = (r.json().get("data") or {}).get("shop") or {}
                if veri.get("name"):
                    sonuc = "CANLI"; ayrinti = veri["name"][:50]
                    sayac["canli"] += 1
                else:
                    sonuc = "YANIT BOS"; ayrinti = str(r.json())[:80]
                    sayac["hata"] += 1
            elif r.status_code in (401, 403):
                sonuc = "OLU"; ayrinti = f"HTTP {r.status_code} - token gecersiz / uygulama kaldirilmis"
                sayac["olu"] += 1
            elif r.status_code == 404:
                sonuc = "MAGAZA YOK"; ayrinti = "HTTP 404 - magaza silinmis"
                sayac["yok"] += 1
            else:
                ayrinti = f"HTTP {r.status_code} {r.text[:60]}"
                sayac["hata"] += 1
        except Exception as e:
            ayrinti = f"{type(e).__name__}: {e}"[:70]
            sayac["hata"] += 1

        print(f"{shop[:36]:36} {u[:38]:38} {(b or '-')[:8]:8} "
              f"{_parmak(token):9} {sonuc:14} {ayrinti}")
        time.sleep(0.3)

    print()
    print(f"{sayac['canli']} CANLI, {sayac['olu']} olu token, "
          f"{sayac['yok']} magaza yok, {sayac['hata']} hata, "
          f"{sayac['atlandi']} atlandi (token yok / mukerrer)")
    print("Yalnizca CANLI olanlar tasinabilir; digerlerinde tasima zaten basarisiz olur.")
    print()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    alt = ap.add_subparsers(dest="komut", required=True)

    alt.add_parser("durum", help="Token tiplerini listeler (salt okunur)")
    alt.add_parser("kontrol", help="Token'lar gercekten calisiyor mu? (salt okunur)")

    for ad, yardim in (("tasi", "Suresiz token'i expiring'e tasir"),
                       ("yenile", "Expiring token'i hemen yeniler")):
        p = alt.add_parser(ad, help=yardim)
        p.add_argument("--shop", default="", help="magaza.myshopify.com")
        p.add_argument("--user", default="", help="integration_connections.username")
        p.add_argument("--hepsi", action="store_true", help="tasinmasi gereken tum kayitlar")
        if ad == "tasi":
            p.add_argument("--uygula", action="store_true",
                           help="gercekten tasi (verilmezse kuru prova)")
            p.add_argument("--zorla", action="store_true",
                           help="SHOPIFY_EXPIRING_TOKENS kapali olsa bile tasi")

    args = ap.parse_args()
    {"durum": komut_durum, "kontrol": komut_kontrol,
     "tasi": komut_tasi, "yenile": komut_yenile}[args.komut](args)


if __name__ == "__main__":
    main()
