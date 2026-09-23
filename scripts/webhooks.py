"""
Magazada kayitli Shopify webhook aboneliklerini listeler.

Hangi topic'lerin kayitli oldugunu ve her birinin hangi URL'e gittigini gosterir.
Bir topic listede yoksa o olay hic bildirilmiyor demektir.

Kullanim:
    python scripts/webhooks.py

Ortam degiskenleri:
    SHOPIFY_SHOP           59fc15-cd.myshopify.com
    SHOPIFY_TOKEN          shpat_... (Admin API access token)
    SHOPIFY_API_VERSION    varsayilan 2026-04
"""
import os
import sys

import requests

SHOP    = os.getenv("SHOPIFY_SHOP", "").strip().replace("https://", "").replace("http://", "").rstrip("/")
TOKEN   = os.getenv("SHOPIFY_TOKEN", "").strip()
VERSION = os.getenv("SHOPIFY_API_VERSION", "2026-04").strip()

_GQL = """
query Webhooks($cursor: String) {
  webhookSubscriptions(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        topic
        createdAt
        endpoint {
          __typename
          ... on WebhookHttpEndpoint { callbackUrl }
        }
      }
    }
  }
}
"""

# Uygulamanin calismasi icin gereken topic'ler
BEKLENEN = ["ORDERS_CREATE", "CHECKOUTS_CREATE", "APP_UNINSTALLED"]


def main():
    if not SHOP or not TOKEN:
        print(__doc__)
        print("HATA: SHOPIFY_SHOP ve SHOPIFY_TOKEN ortam degiskenleri gerekli.")
        sys.exit(1)

    url = f"https://{SHOP}/admin/api/{VERSION}/graphql.json"
    nodes, cursor = [], None
    while True:
        r = requests.post(
            url,
            headers={"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"},
            json={"query": _GQL, "variables": {"cursor": cursor}},
            timeout=20,
        )
        if r.status_code != 200:
            print(f"HTTP {r.status_code}: {r.text[:300]}")
            sys.exit(1)
        data = r.json()
        if data.get("errors"):
            for e in data["errors"]:
                print("GraphQL hatasi:", e.get("message"))
            sys.exit(1)
        conn = (data.get("data") or {}).get("webhookSubscriptions") or {}
        nodes.extend(edge["node"] for edge in conn.get("edges", []))
        pi = conn.get("pageInfo") or {}
        if not pi.get("hasNextPage"):
            break
        cursor = pi.get("endCursor")

    print(f"\n{'='*78}")
    print(f"{SHOP} — {len(nodes)} webhook aboneligi")
    print(f"{'='*78}")
    if not nodes:
        print("\nHic kayitli webhook yok. (Bu token'in olusturmadiklari gorunmez.)")

    kayitli = set()
    for n in nodes:
        topic = n.get("topic", "")
        kayitli.add(topic)
        ep = n.get("endpoint") or {}
        hedef = ep.get("callbackUrl") or ep.get("__typename") or "?"
        print(f"\n  topic   : {topic}")
        print(f"  hedef   : {hedef}")
        print(f"  created : {n.get('createdAt','')}")

    print(f"\n{'='*78}")
    print("Beklenen topic'ler:")
    for t in BEKLENEN:
        print(f"  {'VAR  ' if t in kayitli else 'EKSIK'}  {t}")
    print()


if __name__ == "__main__":
    main()
