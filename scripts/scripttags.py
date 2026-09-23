"""
Shopify ScriptTag kayıtlarını listeler ve siler.

ScriptTag'ler Shopify Admin arayüzünde görünmez — yalnızca Admin API üzerinden
yönetilir. Bu araç mağazadaki tüm ScriptTag kayıtlarını döker ve istenen kaydı
ID ile siler.

Not: Shopify bir ScriptTag'i yalnızca onu oluşturan uygulamanın token'ına
gösterir/sildirir. Bir tag listede çıkmıyorsa başka bir uygulama oluşturmuştur;
o zaman o uygulamanın token'ıyla çalıştırmak gerekir.

Kullanım:
    python scripts/scripttags.py list
    python scripts/scripttags.py delete gid://shopify/ScriptTag/123456789
    python scripts/scripttags.py create https://ornek.com/pixel.js?tid=...

'create' silinen bir kaydı geri kurmak içindir. Shopify yeni bir ID üretir;
src aynı kaldığı için davranış aynı olur.

Ortam değişkenleri:
    SHOPIFY_SHOP           59fc15-cd.myshopify.com
    SHOPIFY_TOKEN          shpat_... (Admin API access token)
    SHOPIFY_API_VERSION    varsayılan 2026-04
"""
import os
import sys

import requests

SHOP    = os.getenv("SHOPIFY_SHOP", "").strip().replace("https://", "").replace("http://", "").rstrip("/")
TOKEN   = os.getenv("SHOPIFY_TOKEN", "").strip()
VERSION = os.getenv("SHOPIFY_API_VERSION", "2026-04").strip()

_LIST_GQL = """
query ScriptTags($cursor: String) {
  scriptTags(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node { id src displayScope createdAt updatedAt } }
  }
}
"""

_CREATE_GQL = """
mutation ScriptTagCreate($input: ScriptTagInput!) {
  scriptTagCreate(input: $input) {
    scriptTag { id src displayScope }
    userErrors { field message }
  }
}
"""

_DELETE_GQL = """
mutation ScriptTagDelete($id: ID!) {
  scriptTagDelete(id: $id) {
    deletedScriptTagId
    userErrors { field message }
  }
}
"""


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
        print("GraphQL hatası:")
        for e in data["errors"]:
            print(f"  - {e.get('message')}")
        print("\nScriptTag API bu sürümde kaldırılmış olabilir. Daha eski bir sürüm dene:")
        print("  SHOPIFY_API_VERSION=2024-10 python scripts/scripttags.py list")
        sys.exit(1)
    return data.get("data") or {}


def fetch_all():
    tags, cursor = [], None
    while True:
        st = gql(_LIST_GQL, {"cursor": cursor}).get("scriptTags") or {}
        tags.extend(edge["node"] for edge in st.get("edges", []))
        pi = st.get("pageInfo") or {}
        if not pi.get("hasNextPage"):
            return tags
        cursor = pi.get("endCursor")


def cmd_list():
    tags = fetch_all()
    print(f"\n{'='*78}")
    print(f"{SHOP} — {len(tags)} ScriptTag")
    print(f"{'='*78}")
    if not tags:
        print("\nKayıt yok. (Bu token'ın oluşturmadığı tag'ler burada görünmez.)")
    for t in tags:
        print(f"\n  id        : {t['id']}")
        print(f"  src       : {t.get('src','')}")
        print(f"  scope     : {t.get('displayScope','')}")
        print(f"  created   : {t.get('createdAt','')}")
    print(f"\n{'='*78}")
    print("Silmek için:  python scripts/scripttags.py delete <id>\n")


def cmd_create(src):
    """Silinen bir ScriptTag'i geri kurar. Yeni ID atanır, src aynı kalır."""
    existing = [t for t in fetch_all() if t.get("src") == src]
    if existing:
        print(f"Bu src zaten kayıtlı: {existing[0]['id']}")
        print("Aynı script iki kez yüklenmesin diye yeni kayıt oluşturulmadı.")
        return

    print(f"\nOluşturulacak kayıt:\n  src : {src}\n")
    if input("Onaylıyor musun? (evet/hayır): ").strip().lower() not in ("evet", "e", "yes", "y"):
        print("İptal edildi.")
        return

    variables = {"input": {"src": src, "displayScope": "ONLINE_STORE", "cache": False}}
    result = gql(_CREATE_GQL, variables).get("scriptTagCreate") or {}
    errs = result.get("userErrors") or []
    if errs:
        print("Oluşturulamadı:")
        for e in errs:
            print(f"  - {e.get('message')}")
        sys.exit(1)
    tag = result.get("scriptTag") or {}
    print(f"Oluşturuldu: {tag.get('id')}")


def cmd_delete(tag_id):
    # Önce kaydı göster — yanlış tag silinmesin
    match = next((t for t in fetch_all() if t["id"] == tag_id), None)
    if not match:
        print(f"Bu ID mağazada bulunamadı: {tag_id}")
        print("Önce 'list' ile mevcut kayıtları gör.")
        sys.exit(1)

    print(f"\nSilinecek kayıt:\n  id  : {match['id']}\n  src : {match.get('src','')}\n")
    if input("Onaylıyor musun? (evet/hayır): ").strip().lower() not in ("evet", "e", "yes", "y"):
        print("İptal edildi.")
        return

    result = gql(_DELETE_GQL, {"id": tag_id}).get("scriptTagDelete") or {}
    errs = result.get("userErrors") or []
    if errs:
        print("Silinemedi:")
        for e in errs:
            print(f"  - {e.get('message')}")
        sys.exit(1)
    print(f"Silindi: {result.get('deletedScriptTagId')}")


def main():
    if not SHOP or not TOKEN:
        print(__doc__)
        print("HATA: SHOPIFY_SHOP ve SHOPIFY_TOKEN ortam değişkenleri gerekli.")
        sys.exit(1)

    args = sys.argv[1:]
    if not args or args[0] == "list":
        cmd_list()
    elif args[0] == "delete":
        if len(args) < 2:
            print("Kullanım: python scripts/scripttags.py delete <gid://shopify/ScriptTag/...>")
            sys.exit(1)
        cmd_delete(args[1])
    elif args[0] == "create":
        if len(args) < 2:
            print("Kullanım: python scripts/scripttags.py create <https://.../pixel.js?tid=...>")
            sys.exit(1)
        cmd_create(args[1])
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
