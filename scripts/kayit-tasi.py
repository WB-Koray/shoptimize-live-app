"""
integration_connections kayitlari arasinda billing bilgisini tasir ve fazla
kaydi siler.

Neden gerekli: payload_json sifreleme destegi yokken uygulama magazanin gercek
kaydini okuyamiyor, shop adindan username turetip YENI bos kayit aciyordu.
Abonelik satin alma o bos kayda islendi; kayit silinmeden once billing bilgisi
gercek kayda tasinmali, yoksa magaza ikinci kez odeme yapmak zorunda kalir.

Uygulama konteynerinde, repo kokunden calistirilir:
    python scripts/kayit-tasi.py incele  <user1> <brand1> [<user2> <brand2> ...]
    python scripts/kayit-tasi.py tasi    <kaynak_user> <kaynak_brand> <hedef_user> <hedef_brand>
    python scripts/kayit-tasi.py sil     <user> <brand>

Gerekli ortam degiskenleri: INTEGRATIONS_POSTGRES_DSN (ya da DATABASE_URL) ve
DATA_ENCRYPTION_KEY (sifreli kayitlar icin).
"""
import sys

import psycopg2.extras

from services.db import _get_conn, payload_coz, payload_sifreli_mi, payload_yaz

# Billing icin kalici olarak yazilan alanlar (bkz. routers/billing.py).
# installed_at TASINMAZ: kod onu bilerek koruyor, tasimak deneme suresini
# yeniden baslatabilir.
TASINACAK = ("billing_status", "billing_charge_id")


def kaydi_oku(cur, user, brand):
    cur.execute(
        "SELECT payload_json FROM integration_connections "
        "WHERE username=%s AND brand=%s AND integration_id='shopify' LIMIT 1",
        (user, brand),
    )
    row = cur.fetchone()
    if not row:
        return None, None
    ham = row["payload_json"]
    return payload_coz(ham), payload_sifreli_mi(ham)


def yazdir(baslik, user, brand, veri, sifreli):
    print(f"\n  {baslik}: {user} / {brand}")
    if veri is None:
        print("    KAYIT YOK")
        return
    print(f"    format : {'sifreli (enc1:)' if sifreli else 'duz JSON'}")
    print(f"    alanlar: {sorted(veri.keys())}")
    for k in TASINACAK + ("shop_domain", "installed_at"):
        if k in veri:
            print(f"    {k:18} = {veri[k]!r}")


def cmd_incele(args):
    ciftler = [(args[i], args[i + 1]) for i in range(0, len(args) - 1, 2)]
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for u, b in ciftler:
                veri, sifreli = kaydi_oku(cur, u, b)
                yazdir("KAYIT", u, b, veri, sifreli)
    print()


def cmd_tasi(args):
    if len(args) != 4:
        print("Kullanim: tasi <kaynak_user> <kaynak_brand> <hedef_user> <hedef_brand>")
        sys.exit(1)
    ku, kb, hu, hb = args
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            kaynak, _ks = kaydi_oku(cur, ku, kb)
            hedef, hs = kaydi_oku(cur, hu, hb)
            if kaynak is None:
                print(f"Kaynak kayit yok: {ku}/{kb}"); sys.exit(1)
            if hedef is None:
                print(f"Hedef kayit yok: {hu}/{hb}"); sys.exit(1)

            yazdir("KAYNAK", ku, kb, kaynak, _ks)
            yazdir("HEDEF (once)", hu, hb, hedef, hs)

            tasinacak = {k: kaynak[k] for k in TASINACAK if k in kaynak}
            if not tasinacak:
                print("\nKaynakta tasinacak billing alani yok.")
                return
            print(f"\n  Tasinacak: {tasinacak}")
            if input("\nOnayliyor musun? (evet/hayir): ").strip().lower() not in ("evet", "e"):
                print("Iptal edildi."); return

            hedef.update(tasinacak)
            cur.execute(
                "UPDATE integration_connections SET payload_json=%s, "
                "updated_at=EXTRACT(EPOCH FROM NOW())::bigint "
                "WHERE username=%s AND brand=%s AND integration_id='shopify'",
                (payload_yaz(hedef, hs), hu, hb),
            )
            print(f"  guncellendi ({cur.rowcount} satir)")

    # Dogrulama ayri baglantida — yazilan deger gercekten okunabiliyor mu
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            veri, sifreli = kaydi_oku(cur, hu, hb)
            yazdir("HEDEF (sonra)", hu, hb, veri, sifreli)
    print()


def cmd_sil(args):
    if len(args) != 2:
        print("Kullanim: sil <user> <brand>")
        sys.exit(1)
    u, b = args
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            veri, sifreli = kaydi_oku(cur, u, b)
            if veri is None:
                print(f"Kayit zaten yok: {u}/{b}"); return
            yazdir("SILINECEK", u, b, veri, sifreli)

            # Koruma: billing bilgisi tasinmadan silme
            if veri.get("billing_status") in ("active", "pending"):
                print(f"\n  UYARI: bu kayitta billing_status={veri['billing_status']!r} var.")
                print("  Once 'tasi' ile gercek kayda tasi, yoksa abonelik bilgisi kaybolur.")
                if input("  Yine de sil? (SIL yaz): ").strip() != "SIL":
                    print("Iptal edildi."); return
            elif input(f"\nSilmek icin kullanici adini yaz ({u}): ").strip() != u:
                print("Eslesmedi, iptal edildi."); return

            cur.execute(
                "DELETE FROM integration_connections "
                "WHERE username=%s AND brand=%s AND integration_id='shopify'",
                (u, b),
            )
            print(f"  silindi ({cur.rowcount} satir)")


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(1)
    komut, kalan = args[0], args[1:]
    if komut == "incele":
        cmd_incele(kalan)
    elif komut == "tasi":
        cmd_tasi(kalan)
    elif komut == "sil":
        cmd_sil(kalan)
    else:
        print(__doc__); sys.exit(1)


if __name__ == "__main__":
    main()
