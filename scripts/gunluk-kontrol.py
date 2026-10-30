"""
Gunluk sayaclarin gercekten yazildigini dogrular. Salt okunur.

Neden ayri bir arac: sayaclar yazma aninda isleniyor (push_event ->
_gunluk_isle). Yeni bir yazma yolu eklendiginde "kod dogru" demek yetmez -
canli veriyle yazildigini gormek gerekir. Panelin Performans alani tamamen
bu sayaclarin uzerine kurulacak.

Uygulama konteynerinde:

    python scripts/gunluk-kontrol.py
        Her magaza icin son 7 gunun sayaclarini listeler.

    python scripts/gunluk-kontrol.py --gun 30
        Gun sayisini degistirir.

    python scripts/gunluk-kontrol.py --kirilim
        Kanal ve urun kirilimlarini da gosterir.
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.db import get_all_shopify_connections            # noqa: E402
from services.redis_store import store, tr_gun                 # noqa: E402


def _ayarlar(kayit: dict) -> dict:
    ayar = (kayit.get("connection") or {}).get("settings") or {}
    alt = ayar.get("settings")
    if isinstance(alt, dict):
        ayar = {**ayar, **alt}
    return ayar


def _magazalar():
    """(shop_domain, tid) ciftleri - tid'i olan, tekil."""
    gorulen, sonuc = set(), []
    for kayit in (get_all_shopify_connections() or []):
        ayar = _ayarlar(kayit)
        tid  = (ayar.get("pixel_tracking_id") or "").strip()
        shop = (ayar.get("shop_domain") or "").strip()
        if not tid or tid in gorulen:
            continue
        gorulen.add(tid)
        sonuc.append((shop or kayit["username"], tid))
    return sorted(sonuc)


async def ana(args):
    await store.connect()
    try:
        magazalar = _magazalar()
        if not magazalar:
            print("TID'i olan magaza bulunamadi.")
            return

        print()
        print(f"Bugun (UTC+3): {tr_gun()}")

        toplam_olay = 0
        for shop, tid in magazalar:
            baslangic = await store.gunluk_baslangic(tid)
            gunler    = await store.gunluk_istatistik(tid, args.gun)
            veri_var  = [g for g in gunler if g["has_data"]]

            print()
            print(f"{shop}")
            print(f"  tid={tid[:20]}...  sayaclar basladi: {baslangic or 'HENUZ YOK'}")

            if not veri_var:
                print("  (bu aralikta hic sayac yok)")
                continue

            print(f"    {'tarih':12} {'ziyaretci':>9} {'olay':>7} {'sepet':>6} "
                  f"{'odeme':>6} {'siparis':>7} {'ciro':>12}")
            for g in gunler:
                if not g["has_data"]:
                    continue
                toplam_olay += g["events"]
                print(f"    {g['date']:12} {g['visitors']:>9} {g['events']:>7} "
                      f"{g['add_to_cart']:>6} {g['checkout_started']:>6} "
                      f"{g['checkout_completed']:>7} {g['revenue']:>12,.2f}")

            if args.kirilim:
                kanal = await store.gunluk_kirilim(tid, args.gun, "kanal")
                urun  = await store.gunluk_kirilim(tid, args.gun, "urun")
                if kanal:
                    print("    kanal: " + " · ".join(
                        f"{k['key']}={k['count']}" for k in kanal[:8]))
                if urun:
                    print("    urun : " + " · ".join(
                        f"{u['key'][:28]}={u['count']}" for u in urun[:5]))

        print()
        print(f"{len(magazalar)} magaza tarandi, {toplam_olay} olay sayildi.")
        if not toplam_olay:
            print("Hic sayac yoksa: sayaclar yalniz YENI olaylarda yaziliyor -")
            print("deploy sonrasi ilk ziyaretciyi bekleyin.")
        print()
    finally:
        await store.disconnect()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gun", type=int, default=7, help="kac gun geriye (varsayilan 7)")
    ap.add_argument("--kirilim", action="store_true", help="kanal ve urun kirilimini da goster")
    asyncio.run(ana(ap.parse_args()))
