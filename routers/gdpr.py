"""
routers/gdpr.py
Shopify zorunlu GDPR webhook'ları.
Partner Dashboard > App setup > GDPR webhooks bölümüne bu URL'ler girilir:
  - Customer data request : https://live.shoptimize.com.tr/webhooks/customers/data_request
  - Customer redact       : https://live.shoptimize.com.tr/webhooks/customers/redact
  - Shop redact           : https://live.shoptimize.com.tr/webhooks/shop/redact
"""

import base64
import hashlib
import hmac
import json
import logging
import os

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks")

SHOPIFY_CLIENT_SECRET = os.getenv("SHOPIFY_CLIENT_SECRET", "")


def _verify_hmac(body: bytes, header_value: str) -> bool:
    expected = base64.b64encode(
        hmac.new(SHOPIFY_CLIENT_SECRET.encode(), body, hashlib.sha256).digest()
    ).decode()
    return hmac.compare_digest(expected, header_value or "")


async def _read_and_verify(request: Request) -> bytes:
    body = await request.body()
    header = request.headers.get("x-shopify-hmac-sha256", "")
    if not _verify_hmac(body, header):
        raise HTTPException(401, "HMAC doğrulaması başarısız")
    return body


# ---------------------------------------------------------------------------
# 1. Müşteri veri talebi
#    Müşteri "verilerimi göster" talebinde bulununca Shopify tetikler.
#    Bu app anonim visitor_id ile çalışır; customer_id eşleşmesi tutulmadığından
#    dönecek kişisel veri yok — loglamak + 200 dönmek yeterli.
# ---------------------------------------------------------------------------
@router.post("/customers/data_request")
async def customers_data_request(request: Request):
    body = await _read_and_verify(request)
    logger.info("[GDPR] customers/data_request: %s", body[:300].decode(errors="replace"))
    return {"ok": True}


# ---------------------------------------------------------------------------
# 2. Müşteri verisi silme
#    Müşteri "verilerimi sil" talebinde bulununca Shopify tetikler.
#    Aynı gerekçeyle silinecek kişisel veri yok.
# ---------------------------------------------------------------------------
@router.post("/customers/redact")
async def customers_redact(request: Request):
    body = await _read_and_verify(request)
    logger.info("[GDPR] customers/redact: %s", body[:300].decode(errors="replace"))
    return {"ok": True}


# ---------------------------------------------------------------------------
# 3. Mağaza verisi silme
#    Uygulama kaldırıldıktan 48 saat sonra Shopify tetikler.
#    Redis'te o mağazanın TID'ine ait event'leri sil.
# ---------------------------------------------------------------------------
@router.post("/shop/redact")
async def shop_redact(request: Request):
    body = await _read_and_verify(request)
    logger.info("[GDPR] shop/redact: %s", body[:300].decode(errors="replace"))

    try:
        payload = json.loads(body)
        shop_domain = payload.get("myshopify_domain", "")
        if shop_domain:
            from services.db import get_all_shopify_connections
            from services.redis_store import store
            for conn in get_all_shopify_connections():
                settings = conn.get("connection", {}).get("settings", {})
                if settings.get("shop_domain") == shop_domain:
                    tid = settings.get("pixel_tracking_id", "")
                    if tid:
                        await store.delete_tid_events(tid)
                        logger.info("[GDPR] shop/redact: TID=%s silindi (shop=%s)", tid, shop_domain)
    except Exception as e:
        logger.warning("[GDPR] shop/redact işleme hatası (200 dönülüyor): %s", e)

    return {"ok": True}
