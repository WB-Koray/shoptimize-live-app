"""
routers/auth.py
Shopify OAuth 2.0 install flow
"""

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse

from services.db import get_setting, set_connection_settings

logger = logging.getLogger(__name__)
router = APIRouter()

SHOPIFY_CLIENT_ID = os.getenv("SHOPIFY_CLIENT_ID", "")
SHOPIFY_CLIENT_SECRET = os.getenv("SHOPIFY_CLIENT_SECRET", "")
APP_URL = os.getenv("SHOPIFY_APP_URL", "https://live.shoptimize.com.tr")
REDIRECT_URI = f"{APP_URL}/auth/shopify/callback"

SCOPES = "read_script_tags,write_script_tags,read_customers,read_orders"

# State token store — in-memory, TTL 10 dakika
_state_store: dict[str, dict] = {}


def _create_state(username: str, brand: str) -> str:
    state = secrets.token_hex(16)
    _state_store[state] = {
        "username": username,
        "brand": brand,
        "ts": time.time(),
    }
    return state


def _verify_state(state: str) -> Optional[dict]:
    data = _state_store.pop(state, None)
    if not data:
        return None
    if time.time() - data["ts"] > 600:  # 10 dakika TTL
        return None
    return data


def _verify_hmac(params: dict, hmac_value: str) -> bool:
    """Shopify HMAC doğrulaması."""
    filtered = {k: v for k, v in params.items() if k != "hmac"}
    message = "&".join(f"{k}={v}" for k, v in sorted(filtered.items()))
    expected = hmac.new(
        SHOPIFY_CLIENT_SECRET.encode(), message.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, hmac_value)


# ---------------------------------------------------------------------------
# Install başlangıcı — mağaza sahibi buraya yönlendirilir
# ---------------------------------------------------------------------------

@router.get("/auth/shopify/install")
async def shopify_install(
    shop: str = Query(...),
    username: str = Query(""),
    brand: str = Query("default"),
):
    """
    Shopify OAuth kurulum başlangıcı.
    Kullanım: GET /auth/shopify/install?shop=mystore.myshopify.com&username=x&brand=default
    """
    shop = shop.strip().lower()
    if not shop.endswith(".myshopify.com"):
        raise HTTPException(400, "Geçersiz shop domain")

    if not SHOPIFY_CLIENT_ID:
        raise HTTPException(500, "SHOPIFY_CLIENT_ID ayarlanmamış")

    state = _create_state(username, brand)

    auth_url = (
        f"https://{shop}/admin/oauth/authorize"
        f"?client_id={SHOPIFY_CLIENT_ID}"
        f"&scope={SCOPES}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&state={state}"
    )

    logger.info("[OAuth] Install başladı: shop=%s username=%s", shop, username)
    return RedirectResponse(auth_url)


# ---------------------------------------------------------------------------
# OAuth callback — Shopify bu URL'i çağırır
# ---------------------------------------------------------------------------

@router.get("/auth/shopify/callback")
async def shopify_callback(
    request: Request,
    code: str = Query(...),
    shop: str = Query(...),
    state: str = Query(...),
    hmac: str = Query(...),
):
    """Shopify OAuth callback — token exchange ve kurulum."""

    # 1. HMAC doğrula
    params = dict(request.query_params)
    if not _verify_hmac(params, hmac):
        raise HTTPException(400, "HMAC doğrulaması başarısız")

    # 2. State doğrula
    state_data = _verify_state(state)
    if not state_data:
        raise HTTPException(400, "Geçersiz veya süresi dolmuş state")

    username = state_data["username"]
    brand = state_data["brand"]

    # 3. Access token al
    try:
        r = requests.post(
            f"https://{shop}/admin/oauth/access_token",
            json={
                "client_id": SHOPIFY_CLIENT_ID,
                "client_secret": SHOPIFY_CLIENT_SECRET,
                "code": code,
            },
            timeout=15,
        )
        if r.status_code != 200:
            raise HTTPException(502, f"Token exchange başarısız: {r.text}")
        token_data = r.json()
        access_token = token_data.get("access_token", "")
        granted_scopes = token_data.get("scope", "")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Token exchange hatası: {e}")

    # 4. Mağaza bilgilerini kaydet
    set_connection_settings(username, brand, "shopify", {
        "shop_domain": shop,
        "admin_api_token": access_token,
        "granted_scopes": granted_scopes,
        "installed_at": int(time.time()),
    })

    logger.info("[OAuth] ✓ Kurulum tamamlandı: shop=%s username=%s", shop, username)

    # 5. Pixel'i otomatik kur
    try:
        from routers.live import _get_or_create_tid, _shopify_headers, _shopify_url
        from services.redis_store import store
        import asyncio

        tid = _get_or_create_tid(username, brand)
        script_url = f"{APP_URL}/pixel.js?tid={tid}"

        requests.post(
            _shopify_url(shop, "script_tags.json"),
            json={"script_tag": {"event": "onload", "src": script_url}},
            headers=_shopify_headers(access_token),
            timeout=15,
        )

        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(store.register_tid_owner(tid, username, brand))

        logger.info("[OAuth] ✓ Pixel kuruldu: tid=%s shop=%s", tid, shop)
    except Exception as e:
        logger.warning("[OAuth] Pixel kurulum hatası (devam ediliyor): %s", e)

    # 6. Webhook'ları kaydet
    try:
        from routers.live import _shopify_headers, _shopify_url
        import secrets as _secrets

        wh_token = get_setting(username, brand, "shopify", "webhook_token", "")
        if not wh_token:
            wh_token = _secrets.token_hex(16)
            set_connection_settings(username, brand, "shopify", {"webhook_token": wh_token})

        for topic, slug in [("orders/create", "orders-create"), ("checkouts/create", "checkouts-create")]:
            callback_url = f"{APP_URL}/api/shopify/webhook/{slug}?token={wh_token}&username={username}&brand={brand}"
            requests.post(
                _shopify_url(shop, "webhooks.json"),
                json={"webhook": {"topic": topic, "address": callback_url, "format": "json"}},
                headers=_shopify_headers(access_token),
                timeout=15,
            )
        logger.info("[OAuth] ✓ Webhook'lar kaydedildi: shop=%s", shop)
    except Exception as e:
        logger.warning("[OAuth] Webhook kurulum hatası: %s", e)

    # 7. Başarı sayfasına yönlendir
    return RedirectResponse(f"{APP_URL}/install/success?shop={shop}")


@router.get("/install/success")
async def install_success(shop: str = Query("")):
    """Kurulum başarı sayfası."""
    return JSONResponse({
        "ok": True,
        "message": f"Shoptimize Live başarıyla kuruldu!",
        "shop": shop,
    })
