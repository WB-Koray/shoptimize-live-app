"""
routers/billing.py
Shopify Billing API — tekrarlayan abonelik akışı.

Akış:
  1. OAuth install tamamlanınca create_charge() çağrılır
  2. Merchant, Shopify onay sayfasına yönlendirilir
  3. Merchant onaylar → GET /billing/callback?charge_id=X&shop=Y çağrılır
  4. Charge aktive edilir, charge_id DB'ye yazılır
  5. Merchant dashboard'a yönlendirilir
"""

import logging
import os

import requests
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from services.db import get_setting, set_connection_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing")

APP_URL = os.getenv("SHOPIFY_APP_URL", "https://live.shoptimize.com.tr")
SHOPIFY_API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2024-10")

PLAN_NAME = os.getenv("BILLING_PLAN_NAME", "Shoptimize Live")
PLAN_PRICE = float(os.getenv("BILLING_PLAN_PRICE", "9.99"))
PLAN_TRIAL_DAYS = int(os.getenv("BILLING_TRIAL_DAYS", "7"))
TEST_MODE = os.getenv("BILLING_TEST_MODE", "true").lower() == "true"


def _shopify_url(shop: str, path: str) -> str:
    return f"https://{shop}/admin/api/{SHOPIFY_API_VERSION}/{path}"


def _shopify_headers(token: str) -> dict:
    return {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}


def create_charge(shop: str, access_token: str, username: str, brand: str) -> str:
    """
    RecurringApplicationCharge oluştur.
    Dönen değer: merchant'ın yönlendirileceği Shopify onay URL'i.
    """
    return_url = (
        f"{APP_URL}/billing/callback"
        f"?shop={shop}&username={username}&brand={brand}"
    )

    payload = {
        "recurring_application_charge": {
            "name": PLAN_NAME,
            "price": PLAN_PRICE,
            "trial_days": PLAN_TRIAL_DAYS,
            "test": TEST_MODE,
            "return_url": return_url,
        }
    }

    logger.warning("[BILLING] Charge oluşturuluyor: shop=%s token_len=%d test=%s url=%s", shop, len(access_token), TEST_MODE, _shopify_url(shop, "recurring_application_charges.json"))
    r = requests.post(
        _shopify_url(shop, "recurring_application_charges.json"),
        json=payload,
        headers=_shopify_headers(access_token),
        timeout=15,
    )

    if r.status_code not in (200, 201):
        logger.error("[BILLING] Charge hatası: status=%s body=%s headers=%s", r.status_code, r.text, dict(r.headers))
        raise HTTPException(502, f"Billing charge oluşturulamadı: {r.text}")

    charge = r.json().get("recurring_application_charge", {})
    charge_id = charge.get("id")
    confirmation_url = charge.get("confirmation_url", "")

    # Henüz "pending" durumunda — aktive edilmesini bekle
    set_connection_settings(username, brand, "shopify", {
        "billing_charge_id": charge_id,
        "billing_status": "pending",
    })

    logger.info("[BILLING] Charge oluşturuldu: id=%s shop=%s price=%s", charge_id, shop, PLAN_PRICE)
    return confirmation_url


# ---------------------------------------------------------------------------
# Callback — merchant onay/red sonrası Shopify buraya yönlendirir
# ---------------------------------------------------------------------------
@router.get("/callback")
async def billing_callback(
    shop: str = Query(...),
    username: str = Query(...),
    brand: str = Query("default"),
    charge_id: int = Query(...),
):
    access_token = get_setting(username, brand, "shopify", "admin_api_token", "")
    if not access_token:
        raise HTTPException(400, "Mağaza bağlantısı bulunamadı")

    # Charge durumunu kontrol et
    r = requests.get(
        _shopify_url(shop, f"recurring_application_charges/{charge_id}.json"),
        headers=_shopify_headers(access_token),
        timeout=15,
    )
    if r.status_code != 200:
        raise HTTPException(502, f"Charge bilgisi alınamadı: {r.text}")

    charge = r.json().get("recurring_application_charge", {})
    status = charge.get("status", "")

    if status == "declined":
        logger.warning("[BILLING] Merchant ödemeyi reddetti: shop=%s charge_id=%s", shop, charge_id)
        set_connection_settings(username, brand, "shopify", {
            "billing_charge_id": charge_id,
            "billing_status": "declined",
        })
        return RedirectResponse(f"{APP_URL}/billing/declined?shop={shop}")

    if status != "accepted":
        raise HTTPException(400, f"Beklenmeyen charge durumu: {status}")

    # Charge'ı aktive et
    activate_r = requests.post(
        _shopify_url(shop, f"recurring_application_charges/{charge_id}/activate.json"),
        json={},
        headers=_shopify_headers(access_token),
        timeout=15,
    )
    if activate_r.status_code not in (200, 201):
        raise HTTPException(502, f"Charge aktive edilemedi: {activate_r.text}")

    set_connection_settings(username, brand, "shopify", {
        "billing_charge_id": charge_id,
        "billing_status": "active",
    })

    logger.info("[BILLING] Charge aktive edildi: id=%s shop=%s", charge_id, shop)

    from services.auth import create_access_token
    token = create_access_token(username, brand)
    tid = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
    redirect = (
        f"{APP_URL}/?auto_token={token}"
        f"&u={username}&b={brand}"
        + (f"&tid={tid}" if tid else "")
    )
    return RedirectResponse(redirect)


# ---------------------------------------------------------------------------
# Ödeme reddedildi sayfası
# ---------------------------------------------------------------------------
@router.get("/declined")
async def billing_declined(shop: str = Query("")):
    return {
        "ok": False,
        "message": "Abonelik reddedildi. Shoptimize Live'ı kullanmak için ödemeyi onaylamanız gerekiyor.",
        "shop": shop,
        "retry_url": f"{APP_URL}/auth/shopify/install?shop={shop}",
    }
