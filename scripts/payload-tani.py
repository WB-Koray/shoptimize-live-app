"""
integration_connections tablosundaki payload_json alanlarini teshis eder.

Neden: bazi kayitlar "Expecting value: line 1 column 1" ile parse edilemiyor.
Bos string bu hatayi veremez (kod onu `or {}` ile eliyor), yani degerler dolu
ama JSON degil. Sifreli blob mu, bozulma mi, baska bir format mi — bu script
sirlari aciga cikarmadan soyler: yalnizca ilk 12 karakter ve parse durumu.

Uygulama konteynerinde calistirilir (psycopg2 ve DSN orada mevcut):
    python scripts/payload-tani.py
"""
import json
import os
import sys

import psycopg2

DSN = os.getenv("INTEGRATIONS_POSTGRES_DSN") or os.getenv("DATABASE_URL", "")
if not DSN:
    print("INTEGRATIONS_POSTGRES_DSN / DATABASE_URL tanimli degil.")
    sys.exit(1)

conn = psycopg2.connect(DSN, connect_timeout=10)
cur = conn.cursor()
cur.execute(
    """
    SELECT username, brand, pg_typeof(payload_json)::text,
           length(payload_json::text), payload_json::text
    FROM integration_connections
    WHERE integration_id = 'shopify'
    ORDER BY username, brand
    """
)

print(f"\n{'username':42} {'brand':7} {'tip':6} {'uzunluk':>7}  {'ilk12':14} durum")
print("-" * 112)
sayac = {"ok": 0, "hata": 0}
for u, b, tip, n, tam in cur.fetchall():
    bas = (tam or "")[:12]
    try:
        d = json.loads(tam)
        durum = f"JSON OK ({len(d)} anahtar)" if isinstance(d, dict) else f"JSON ama {type(d).__name__}"
        sayac["ok"] += 1
    except Exception as e:
        durum = f"PARSE HATASI: {e}"
        sayac["hata"] += 1
    print(f"{u:42} {b:7} {tip:6} {n or 0:>7}  {bas!r:14} {durum}")

print(f"\nToplam: {sayac['ok']} okunabilir, {sayac['hata']} okunamayan\n")
