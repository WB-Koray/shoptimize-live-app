"""
routers/billing.py
Shopify Billing API — tekrarlayan abonelik akışı (GraphQL).

Akış:
  1. OAuth install tamamlanınca create_charge() çağrılır
  2. Merchant, Shopify onay sayfasına yönlendirilir
  3. Merchant onaylar → GET /billing/callback?charge_id=X&shop=Y çağrılır
  4. Subscription durumu kontrol edilir / aktive edilir, DB'ye yazılır
  5. Merchant dashboard'a yönlendirilir
"""

import logging
import os
import time
from datetime import datetime, timezone

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from services.db import get_setting, set_connection_settings
from services.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing")

APP_URL = os.getenv("SHOPIFY_APP_URL", "https://live.shoptimize.com.tr")
SHOPIFY_GRAPHQL_VERSION = os.getenv("SHOPIFY_API_VERSION", "2026-04")

PLAN_NAME = os.getenv("BILLING_PLAN_NAME", "Shoptimize Live")
PLAN_PRICE = float(os.getenv("BILLING_PLAN_PRICE", "9.99"))
PLAN_TRIAL_DAYS = int(os.getenv("BILLING_TRIAL_DAYS", "7"))
TEST_MODE = os.getenv("BILLING_TEST_MODE", "true").lower() == "true"


def _graphql_url(shop: str) -> str:
    return f"https://{shop}/admin/api/{SHOPIFY_GRAPHQL_VERSION}/graphql.json"


def _graphql_headers(token: str) -> dict:
    return {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}


def create_charge(shop: str, access_token: str, username: str, brand: str) -> str:
    """
    GraphQL appSubscriptionCreate ile abonelik oluştur.
    Dönen değer: merchant'ın yönlendirileceği Shopify onay URL'i.
    """
    return_url = (
        f"{APP_URL}/billing/callback"
        f"?shop={shop}&username={username}&brand={brand}"
    )

    mutation = """
    mutation AppSubscriptionCreate(
      $name: String!,
      $returnUrl: URL!,
      $lineItems: [AppSubscriptionLineItemInput!]!,
      $test: Boolean,
      $trialDays: Int
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        lineItems: $lineItems
        test: $test
        trialDays: $trialDays
      ) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
    """

    variables = {
        "name": PLAN_NAME,
        "returnUrl": return_url,
        "lineItems": [
            {
                "plan": {
                    "appRecurringPricingDetails": {
                        "price": {"amount": str(PLAN_PRICE), "currencyCode": "USD"},
                        "interval": "EVERY_30_DAYS",
                    }
                }
            }
        ],
        "test": TEST_MODE,
        "trialDays": PLAN_TRIAL_DAYS,
    }

    logger.warning(
        "[BILLING] GraphQL abonelik oluşturuluyor: shop=%s test=%s price=%s",
        shop, TEST_MODE, PLAN_PRICE,
    )

    r = requests.post(
        _graphql_url(shop),
        json={"query": mutation, "variables": variables},
        headers=_graphql_headers(access_token),
        timeout=15,
    )

    logger.warning("[BILLING] GraphQL yanıt: status=%d body=%s", r.status_code, r.text[:800])

    if r.status_code != 200:
        logger.error("[BILLING] GraphQL HTTP hatası: status=%s body=%s", r.status_code, r.text)
        raise HTTPException(502, f"Billing oluşturulamadı: {r.text}")

    body = r.json()
    errors = body.get("errors")
    if errors:
        logger.error("[BILLING] GraphQL errors: %s", errors)
        raise HTTPException(502, f"GraphQL hatası: {errors}")

    result = body.get("data", {}).get("appSubscriptionCreate", {})
    user_errors = result.get("userErrors", [])
    if user_errors:
        logger.error("[BILLING] userErrors: %s", user_errors)
        raise HTTPException(502, f"Billing hatası: {user_errors[0].get('message', user_errors)}")

    subscription = result.get("appSubscription") or {}
    gid = subscription.get("id", "")           # gid://shopify/AppSubscription/12345
    confirmation_url = result.get("confirmationUrl", "")

    # GID'den sayısal ID çıkar
    numeric_id = gid.split("/")[-1] if gid else ""

    set_connection_settings(username, brand, "shopify", {
        "billing_charge_id": numeric_id,
        "billing_status": "pending",
    })

    logger.info("[BILLING] AppSubscription oluşturuldu: gid=%s numeric_id=%s shop=%s", gid, numeric_id, shop)
    return confirmation_url


# ---------------------------------------------------------------------------
# Plan bilgisi — dashboard Plan sekmesi için
# ---------------------------------------------------------------------------
@router.get("/info")
async def billing_info_endpoint(
    username: str = Query(""),
    brand: str = Query("default"),
    _: dict = Depends(get_current_user),
):
    billing_status = get_setting(username, brand, "shopify", "billing_status", "") or "none"
    installed_at_ts = int(get_setting(username, brand, "shopify", "installed_at", 0) or 0)
    trial_ends_ts = (installed_at_ts + PLAN_TRIAL_DAYS * 86400) if installed_at_ts else None
    now = time.time()
    days_remaining = None
    if trial_ends_ts:
        days_remaining = max(0, int((trial_ends_ts - now) / 86400))

    def _iso(ts):
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None

    return {
        "ok": True,
        "billing_status": billing_status,
        "plan_name": PLAN_NAME,
        "plan_price": PLAN_PRICE,
        "trial_days": PLAN_TRIAL_DAYS,
        "installed_at": _iso(installed_at_ts) if installed_at_ts else None,
        "trial_ends_at": _iso(trial_ends_ts) if trial_ends_ts else None,
        "days_remaining": days_remaining,
    }


# ---------------------------------------------------------------------------
# Callback — merchant onay/red sonrası Shopify buraya yönlendirir
# ---------------------------------------------------------------------------
@router.get("/callback")
async def billing_callback(
    shop: str = Query(...),
    username: str = Query(...),
    brand: str = Query("default"),
    charge_id: str = Query(...),
):
    """
    Shopify, merchant onayından sonra buraya yönlendirir.
    charge_id = AppSubscription'ın sayısal ID'si.
    """
    access_token = get_setting(username, brand, "shopify", "admin_api_token", "")
    if not access_token:
        raise HTTPException(400, "Mağaza bağlantısı bulunamadı")

    gid = f"gid://shopify/AppSubscription/{charge_id}"

    # ── 1. Subscription durumunu sorgula ────────────────────────────
    status_query = """
    query AppSubscriptionStatus($id: ID!) {
      appSubscription(id: $id) {
        id
        status
        currentPeriodEnd
      }
    }
    """

    r = requests.post(
        _graphql_url(shop),
        json={"query": status_query, "variables": {"id": gid}},
        headers=_graphql_headers(access_token),
        timeout=15,
    )

    logger.warning("[BILLING] Status sorgusu: charge_id=%s status=%d body=%s", charge_id, r.status_code, r.text[:500])

    if r.status_code != 200:
        raise HTTPException(502, f"Subscription bilgisi alınamadı: {r.text}")

    body = r.json()
    sub_data = body.get("data", {}).get("appSubscription") or {}
    status = sub_data.get("status", "")

    if status == "DECLINED":
        logger.warning("[BILLING] Merchant ödemeyi reddetti: shop=%s charge_id=%s", shop, charge_id)
        set_connection_settings(username, brand, "shopify", {
            "billing_charge_id": charge_id,
            "billing_status": "declined",
        })
        return RedirectResponse(f"{APP_URL}/billing/declined?shop={shop}")

    if status == "ACTIVE":
        # Zaten aktif (bazı durumlarda otomatik aktive olur)
        logger.info("[BILLING] Subscription zaten aktif: id=%s shop=%s", charge_id, shop)
        set_connection_settings(username, brand, "shopify", {
            "billing_charge_id": charge_id,
            "billing_status": "active",
        })

    elif status in ("ACCEPTED", "PENDING"):
        # Onaylandı ama aktive edilmesi gerekiyor → appSubscriptionActivate
        activate_mutation = """
        mutation AppSubscriptionActivate($id: ID!) {
          appSubscriptionActivate(id: $id) {
            appSubscription {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }
        """

        act_r = requests.post(
            _graphql_url(shop),
            json={"query": activate_mutation, "variables": {"id": gid}},
            headers=_graphql_headers(access_token),
            timeout=15,
        )

        logger.warning("[BILLING] Activate yanıt: status=%d body=%s", act_r.status_code, act_r.text[:500])

        if act_r.status_code != 200:
            raise HTTPException(502, f"Subscription aktive edilemedi: {act_r.text}")

        act_body = act_r.json()
        act_result = act_body.get("data", {}).get("appSubscriptionActivate", {})
        act_errors = act_result.get("userErrors", [])
        if act_errors:
            logger.error("[BILLING] Activate userErrors: %s", act_errors)
            raise HTTPException(502, f"Activate hatası: {act_errors[0].get('message', act_errors)}")

        activated_status = (act_result.get("appSubscription") or {}).get("status", "")
        logger.info("[BILLING] Subscription aktive edildi: id=%s shop=%s new_status=%s", charge_id, shop, activated_status)

        set_connection_settings(username, brand, "shopify", {
            "billing_charge_id": charge_id,
            "billing_status": "active",
        })

    else:
        raise HTTPException(400, f"Beklenmeyen subscription durumu: {status!r}")

    # ── 2. Merchant'ı dashboard'a yönlendir ─────────────────────────
    from services.auth import create_access_token
    token = create_access_token(username, brand)
    tid = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
    redirect = (
        f"{APP_URL}/?auto_token={token}"
        f"&u={username}&b={brand}"
        + (f"&tid={tid}" if tid else "")
    )

    # Kurulum tamamlandı — WA hoş geldiniz mesajı gönder
    try:
        from routers.auth import _send_welcome_wa
        _send_welcome_wa(
            username, brand,
            owner_name="",
            owner_phone="",
            shop_domain=shop,
            dashboard_url=f"{APP_URL}/?auto_token={token}&u={username}&b={brand}" + (f"&tid={tid}" if tid else ""),
        )
    except Exception as _e:
        logger.warning("[BILLING] WA kurulum mesajı gönderilemedi: %s", _e)

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
