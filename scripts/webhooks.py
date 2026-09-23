"""
Magazada kayitli Shopify webhook aboneliklerini listeler.

Hangi topic'lerin kayitli oldugunu ve her birinin hangi URL'e gittigini gosterir.
Bir topic listede yoksa o olay hic bildirilmiyor demektir.

Kullanim:
    python scripts/webhooks.py list
    python scripts/webhooks.py delete gid://shopify/WebhookSubscription/123456789
    python scripts/webhooks.py register APP_UNINSTALLED https://live.shoptimize.com.tr/webhooks/app/uninstalled

Not: Shopify bir aboneligi yalnizca onu olusturan uygulamanin token'ina
gosterir ve sildirir.

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

_DELETE_GQL = """
mutation WebhookDelete($id: ID!) {
  webhookSubscriptionDelete(id: $id) {
    deletedWebhookSubscriptionId
    userErrors { field message }
  }
}
"""

_CREATE_GQL = """
mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
    webhookSubscription { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } }
    userErrors { field message }
  }
}
"""

# Uygulamanin calismasi icin gereken topic'ler
BEKLENEN = ["ORDERS_CREATE", "CHECKOUTS_CREATE", "APP_UNINSTALLED"]


def gql(query, variables=None):
    url = f"https://{SHOP}/admin/api/{VERSION}/graphql.json"
    r = requests.post(
        url,
        headers={"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"},
        json={"query": query, "variables": variables or {}},
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
    return data.get("data") or {}


def fetch_all():
    nodes, cursor = [], None
    while True:
        conn = gql(_GQL, {"cursor": cursor}).get("webhookSubscriptions") or {}
        nodes.extend(edge["node"] for edge in conn.get("edges", []))
        pi = conn.get("pageInfo") or {}
        if not pi.get("hasNextPage"):
            return nodes
        cursor = pi.get("endCursor")


def hedef_of(node):
    ep = node.get("endpoint") or {}
    return ep.get("callbackUrl") or ep.get("__typename") or "?"


def cmd_delete(wid):
    match = next((n for n in fetch_all() if n["id"] == wid), None)
    if not match:
        print(f"Bu ID magazada bulunamadi: {wid}")
        print("Once 'list' ile mevcut abonelikleri gor.")
        sys.exit(1)
    print(f"\nSilinecek abonelik:\n  topic : {match.get('topic')}\n  hedef : {hedef_of(match)}\n")
    if input("Onayliyor musun? (evet/hayir): ").strip().lower() not in ("evet", "e", "yes", "y"):
        print("Iptal edildi.")
        return
    res = gql(_DELETE_GQL, {"id": wid}).get("webhookSubscriptionDelete") or {}
    errs = res.get("userErrors") or []
    if errs:
        for e in errs:
            print("Silinemedi:", e.get("message"))
        sys.exit(1)
    print("Silindi:", res.get("deletedWebhookSubscriptionId"))


def cmd_register(topic, callback_url):
    topic = topic.strip().upper()
    for n in fetch_all():
        if n.get("topic") == topic and hedef_of(n) == callback_url:
            print(f"Bu topic zaten ayni hedefe kayitli: {n['id']}")
            print("Ikinci kayit olusturulmadi (mukerrer teslim olurdu).")
            return
    print(f"\nOlusturulacak abonelik:\n  topic : {topic}\n  hedef : {callback_url}\n")
    if input("Onayliyor musun? (evet/hayir): ").strip().lower() not in ("evet", "e", "yes", "y"):
        print("Iptal edildi.")
        return
    res = gql(_CREATE_GQL, {
        "topic": topic,
        "sub": {"callbackUrl": callback_url, "format": "JSON"},
    }).get("webhookSubscriptionCreate") or {}
    errs = res.get("userErrors") or []
    if errs:
        for e in errs:
            print("Olusturulamadi:", e.get("message"))
        sys.exit(1)
    sub = res.get("webhookSubscription") or {}
    print("Olusturuldu:", sub.get("id"))


def cmd_list():
    nodes = fetch_all()
    print(f"\n{'='*78}")
    print(f"{SHOP} — {len(nodes)} webhook aboneligi")
    print(f"{'='*78}")
    if not nodes:
        print("\nHic kayitli webhook yok. (Bu token'in olusturmadiklari gorunmez.)")

    kayitli = set()
    for n in nodes:
        topic = n.get("topic", "")
        kayitli.add(topic)
        print(f"\n  id      : {n.get('id','')}")
        print(f"  topic   : {topic}")
        print(f"  hedef   : {hedef_of(n)}")
        print(f"  created : {n.get('createdAt','')}")

    print(f"\n{'='*78}")
    print("Beklenen topic'ler:")
    for t in BEKLENEN:
        print(f"  {'VAR  ' if t in kayitli else 'EKSIK'}  {t}")
    print()


def main():
    if not SHOP or not TOKEN:
        print(__doc__)
        print("HATA: SHOPIFY_SHOP ve SHOPIFY_TOKEN ortam degiskenleri gerekli.")
        sys.exit(1)

    args = sys.argv[1:]
    if not args or args[0] == "list":
        cmd_list()
    elif args[0] == "delete":
        if len(args) < 2:
            print("Kullanim: python scripts/webhooks.py delete <gid://shopify/WebhookSubscription/...>")
            sys.exit(1)
        cmd_delete(args[1])
    elif args[0] == "register":
        if len(args) < 3:
            print("Kullanim: python scripts/webhooks.py register <TOPIC> <https://...>")
            sys.exit(1)
        cmd_register(args[1], args[2])
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
