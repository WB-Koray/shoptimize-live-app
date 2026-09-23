"""
app/uninstalled webhook'unun HMAC dogrulamasini GUVENLI sekilde test eder.

Neden gerekli: Shopify webhook'u onu kaydeden uygulamanin secret'i ile imzalar.
Kayit custom app token'iyla yapildiysa, Coolify'daki SHOPIFY_CLIENT_SECRET ya da
SHOPIFY_CLIENT_SECRET_LEGACY o app'in secret'i degilse handler 401 doner ve
temizlik (billing iptali, token bosaltma, veri silme) hic calismaz.

Neden guvenli: gonderilen payload'daki myshopify_domain bilerek var olmayan bir
magazayi gosterir. Handler HMAC'i dogrular, eslesen baglanti bulamaz ve hicbir
sey silmez. Yalnizca 200 mu 401 mi dondugune bakariz.

Kullanim:
    python scripts/test-uninstall-hmac.py

Ortam degiskenleri:
    APP_URL        varsayilan https://live.shoptimize.com.tr
    TEST_SECRET    imzalamada kullanilacak secret (custom app'in API secret key'i)
"""
import base64
import hashlib
import hmac
import json
import os
import sys

import requests

APP_URL = os.getenv("APP_URL", "https://live.shoptimize.com.tr").rstrip("/")
SECRET = os.getenv("TEST_SECRET", "").strip()

# Bilerek var olmayan magaza — hicbir baglantiya eslesmez, hicbir sey silinmez
SAHTE_DOMAIN = "hmac-test-does-not-exist.myshopify.com"


def gonder(secret, etiket):
    body = json.dumps({"myshopify_domain": SAHTE_DOMAIN}).encode()
    imza = base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()
    r = requests.post(
        f"{APP_URL}/webhooks/app/uninstalled",
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Hmac-Sha256": imza,
            "X-Shopify-Shop-Domain": SAHTE_DOMAIN,
            "X-Shopify-Topic": "app/uninstalled",
        },
        timeout=20,
    )
    print(f"  {etiket:28} HTTP {r.status_code}  {r.text[:80]}")
    return r.status_code


def main():
    if not SECRET:
        print(__doc__)
        print("HATA: TEST_SECRET ortam degiskeni gerekli.")
        sys.exit(1)

    # Kesilmis degerle test etmek yaniltici 401 uretir: sorun secret'ta sanilir
    # ama aslinda deger eksiktir. Panolardan kopyalarken sik yapilan hata.
    if SECRET.endswith("...") or SECRET.endswith("…"):
        print("HATA: TEST_SECRET kesilmis gorunuyor (sonu '...').")
        print("      Shopify Admin > Develop apps > uygulaman > API credentials >")
        print("      'API secret key' altindaki TAM degeri kullan.")
        sys.exit(1)
    if len(SECRET) < 24:
        print(f"HATA: TEST_SECRET fazla kisa ({len(SECRET)} karakter) — eksik kopyalanmis olabilir.")
        sys.exit(1)

    # Parmak izi: secret'i aciga cikarmadan hangi degerle test edildigini
    # ayirt etmeye yarar. Ayni deger her zaman ayni izi verir.
    iz = hashlib.sha256(SECRET.encode()).hexdigest()[:8]
    print(f"\nSecret parmak izi: {iz}  (uzunluk {len(SECRET)})")
    print(f"Hedef : {APP_URL}/webhooks/app/uninstalled")
    print(f"Magaza: {SAHTE_DOMAIN}  (var olmayan — hicbir veri etkilenmez)\n")

    dogru = gonder(SECRET, "dogru secret ile")
    yanlis = gonder("kesinlikle-yanlis-secret", "yanlis secret ile")

    print()
    if dogru == 200 and yanlis == 401:
        print("SONUC: Secret dogru. app/uninstalled geldiginde temizlik calisacak.")
    elif dogru == 401:
        print("SONUC: Secret ESLESMIYOR. Bu secret'i Coolify'da")
        print("       SHOPIFY_CLIENT_SECRET_LEGACY olarak tanimla, sonra tekrar dene.")
        print("       Aksi halde uygulama kaldirilirsa temizlik hic calismaz.")
    elif yanlis != 401:
        print("SONUC: BEKLENMEDIK — yanlis secret de kabul edildi. Dogrulama devre disi olabilir.")
    else:
        print(f"SONUC: Beklenmedik durum (dogru={dogru}, yanlis={yanlis}).")
    print()


if __name__ == "__main__":
    main()
