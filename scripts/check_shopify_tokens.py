"""
Shopify integration_connections tablosunu kontrol eder.
Kullanım: python scripts/check_shopify_tokens.py
"""
import os, json, sys
import psycopg2
import psycopg2.extras

DSN = os.getenv(
    "INTEGRATIONS_POSTGRES_DSN",
    "postgres://postgres:QpsKsXjAruqyT6XMrLJ8xPrZsvZlOD5U2rpQZNzpOdo7j2ZwnPWfmPTOF8h85ikR@rquqtc0hvaxc5nkgzcneczjg:5432/postgres"
)

def main():
    try:
        conn = psycopg2.connect(DSN, connect_timeout=10)
    except Exception as e:
        print(f"DB bağlantı hatası: {e}")
        sys.exit(1)

    with conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT username, brand, payload_json FROM integration_connections WHERE integration_id = 'shopify' ORDER BY username"
            )
            rows = cur.fetchall()

    print(f"\n{'='*70}")
    print(f"Toplam {len(rows)} Shopify kaydı:")
    print(f"{'='*70}")
    for row in rows:
        data = row["payload_json"] or {}
        if isinstance(data, str):
            data = json.loads(data)
        token = data.get("admin_api_token", "")
        shop  = data.get("shop_domain", "")
        keys  = list(data.keys())
        print(f"\n  username : {row['username']}")
        print(f"  brand    : {row['brand']}")
        print(f"  shop     : {shop!r}")
        print(f"  token    : {'SET (tail: ...'+token[-8:]+')' if token else 'MISSING'}")
        print(f"  keys     : {keys}")

    print(f"\n{'='*70}\n")

    # Token olan kayıtları öne çıkar
    has_token = [(r["username"], r["brand"]) for r in rows if (
        r["payload_json"] or {}
    ) and (r["payload_json"] if isinstance(r["payload_json"], dict) else json.loads(r["payload_json"] or "{}")
    ).get("admin_api_token")]
    if has_token:
        print(f"Token olan kayıtlar: {has_token}")
    else:
        print("Hiçbir kayıtta admin_api_token yok — OAuth hiç tamamlanmamış.")

if __name__ == "__main__":
    main()
