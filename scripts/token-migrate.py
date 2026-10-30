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

    python scripts/token-migrate.py tasi --shop magaza.myshopify.com
        Tek magazayi tasir. --uygula verilmeden kuru calisir.

    python scripts/token-migrate.py tasi --hepsi --uygula
        Suresiz token'i olan TUM magazalari tasir.

    python scripts/token-migrate.py yenile --shop magaza.myshopify.com
        Expiring bir token'i hemen yeniler (yenileme akisini test eder).
"""
import argparse
import os
import sys
import time

# Proje kokunu yola ekle (scripts/ altindan calistirildiginda)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.db import get_all_shopify_connections                 # noqa: E402
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


def komut_durum(args):
    simdi = int(time.time())
    kayitlar = _kayitlari_topla()

    print(f"\nSHOPIFY_EXPIRING_TOKENS = {'ACIK' if EXPIRING_ENABLED else 'KAPALI'}")
    print(f"{'username':40} {'magaza':34} {'tip':9} {'kalan':12} {'refresh':12} {'billing':14} not")
    print("-" * 150)

    sayac = {"suresiz": 0, "expiring": 0, "yok": 0, "reauth": 0}
    for u, b, ayar in kayitlar:
        token = (ayar.get(K_TOKEN) or "").strip()
        son   = int(ayar.get(K_EXPIRES) or 0)
        ref   = (ayar.get(K_REFRESH) or "").strip()
        rson  = int(ayar.get(K_REF_EXP) or 0)
        shop  = (ayar.get("shop_domain") or "-")[:34]

        if not token:
            tip = "YOK"
            sayac["yok"] += 1
        elif son:
            tip = "expiring"
            sayac["expiring"] += 1
        else:
            tip = "SURESIZ"
            sayac["suresiz"] += 1

        notlar = []
        if str(ayar.get(K_REAUTH) or "") == "1":
            notlar.append("REAUTH GEREK")
            sayac["reauth"] += 1
        if ayar.get(K_MIGRATED):
            gecen = simdi - int(ayar.get(K_MIGRATED) or 0)
            notlar.append(f"tasindi {_sure(gecen)} once")
            if gecen < 7 * 86400 and (ayar.get(K_LEGACY) or "").strip():
                notlar.append("kurtarma penceresi acik")
        if token and son and not ref:
            notlar.append("DIKKAT: expiring ama refresh token YOK")

        print(f"{u[:40]:40} {shop:34} {tip:9} {_sure(son - simdi if son else 0):12} "
              f"{_sure(rson - simdi if rson else 0):12} "
              f"{(ayar.get('billing_status') or '-')[:14]:14} {' · '.join(notlar)}")

    print(f"\n{len(kayitlar)} kayit: {sayac['expiring']} expiring, "
          f"{sayac['suresiz']} SURESIZ (tasinmasi gerekiyor), "
          f"{sayac['yok']} token yok, {sayac['reauth']} reauth bekliyor\n")

    if sayac["suresiz"] and not EXPIRING_ENABLED:
        print("UYARI: SHOPIFY_EXPIRING_TOKENS kapali. Once onu 1 yapip dagitin,")
        print("       sonra tasimayi yapin - yoksa magaza bir sonraki acilisinda")
        print("       tekrar suresiz token alir ve tasima geri alinmis olur.\n")


def _hedefleri_bul(args):
    """--shop / --user / --hepsi secimine gore (username, brand) listesi."""
    kayitlar = _kayitlari_topla()
    hedef = []
    for u, b, ayar in kayitlar:
        shop = (ayar.get("shop_domain") or "").strip().lower()
        token = (ayar.get(K_TOKEN) or "").strip()
        son = int(ayar.get(K_EXPIRES) or 0)

        if args.shop and shop != args.shop.strip().lower():
            continue
        if args.user and u != args.user:
            continue
        if args.hepsi:
            # Sadece tasinmasi gerekenler: token'i olan ve henuz suresiz olanlar
            if not token or son:
                continue
        hedef.append((u, b, ayar))

    if not (args.shop or args.user or args.hepsi):
        print("--shop, --user ya da --hepsi vermelisiniz.")
        sys.exit(2)
    return hedef


def komut_tasi(args):
    hedef = _hedefleri_bul(args)
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
    hedef = _hedefleri_bul(args)
    if not hedef:
        print("Eslesen kayit yok.")
        return
    for u, b, ayar in hedef:
        shop = ayar.get("shop_domain") or "-"
        onceki = token_durumu(u, b)
        if not onceki["son_kullanma"]:
            print(f"  ATLANDI    {shop:36} suresiz token - yenilenecek bir sey yok")
            continue
        yeni = yenile(u, b)
        sonraki = token_durumu(u, b)
        if yeni:
            print(f"  OK         {shop:36} yeni kalan={_sure(sonraki['kalan_sn'] or 0)} "
                  f"refresh={_sure((sonraki['refresh_son'] or 0) - int(time.time()))}")
        else:
            print(f"  BASARISIZ  {shop:36} reauth_gerek={sonraki['reauth_gerek']}")
        time.sleep(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    alt = ap.add_subparsers(dest="komut", required=True)

    alt.add_parser("durum", help="Token tiplerini listeler (salt okunur)")

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
    {"durum": komut_durum, "tasi": komut_tasi, "yenile": komut_yenile}[args.komut](args)


if __name__ == "__main__":
    main()
