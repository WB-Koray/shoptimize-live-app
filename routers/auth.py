"""
routers/auth.py
Shopify OAuth 2.0 install flow
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from typing import Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from services.db import get_setting, set_connection_settings, lookup_username_by_shop
from services.auth import get_current_user as get_current_user_dep

logger = logging.getLogger(__name__)
router = APIRouter()

SHOPIFY_CLIENT_ID = os.getenv("SHOPIFY_CLIENT_ID", "")
SHOPIFY_CLIENT_SECRET = os.getenv("SHOPIFY_CLIENT_SECRET", "")
# Eski app sürümünün secret'ı (geçiş dönemi için fallback)
SHOPIFY_CLIENT_SECRET_LEGACY = os.getenv("SHOPIFY_CLIENT_SECRET_LEGACY", "")
APP_URL = os.getenv("SHOPIFY_APP_URL", "https://live.shoptimize.com.tr")
REDIRECT_URI = f"{APP_URL}/auth/shopify/callback"
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")
OPERATOR_WA_TOKEN    = os.getenv("OPERATOR_WA_TOKEN", "")
OPERATOR_WA_PHONE_ID = os.getenv("OPERATOR_WA_PHONE_ID", "")

SCOPES = "read_checkouts,read_customers,read_orders"
BILLING_ENABLED = os.getenv("BILLING_ENABLED", "true").strip().lower() in ("true", "1", "yes", "on")
# Managed Pricing: deneme süresi Shopify plan'ında yönetilir → app tarafı 0 (kapalı).
PLAN_TRIAL_DAYS = int(os.getenv("BILLING_TRIAL_DAYS", "0"))
# Managed Pricing: Billing API yerine Shopify'ın fiyatlandırma sayfasına yönlendirilir.
SHOPIFY_APP_HANDLE = os.getenv("SHOPIFY_APP_HANDLE", "shoptimize-live")


def _managed_pricing_url(shop: str) -> str:
    """Shopify managed pricing (plan seçim) sayfası URL'i."""
    handle = shop.replace("https://", "").replace(".myshopify.com", "").strip().rstrip("/")
    return f"https://admin.shopify.com/store/{handle}/charges/{SHOPIFY_APP_HANDLE}/pricing_plans"


def _has_active_subscription(shop: str, token: str) -> bool:
    """Shopify'da aktif abonelik var mı (managed pricing — gerçek durum kaynağı)."""
    if not shop or not token:
        return False
    try:
        from routers.live import _shopify_graphql
        body = _shopify_graphql(shop, token,
                                "{ currentAppInstallation { activeSubscriptions { status } } }")
        subs = ((body.get("data") or {}).get("currentAppInstallation") or {}).get("activeSubscriptions") or []
        return any((s or {}).get("status") == "ACTIVE" for s in subs)
    except Exception as e:
        logger.warning("[BILLING] aktif abonelik sorgusu hatası: %s", e)
        return False

# State token store — in-memory, TTL 10 dakika
_state_store: dict[str, dict] = {}


def _create_state(username: str, brand: str, reauth: bool = False) -> str:
    state = secrets.token_hex(16)
    _state_store[state] = {
        "username": username,
        "brand": brand,
        "ts": time.time(),
        "reauth": reauth,
    }
    return state


def _verify_state(state: str) -> Optional[dict]:
    data = _state_store.pop(state, None)
    if not data:
        return None
    if time.time() - data["ts"] > 600:  # 10 dakika TTL
        return None
    return data


def _check_billing(username: str, brand: str) -> None:
    """
    Billing durumunu doğrula. Sorun varsa HTTPException(402) fırlat.
    BILLING_ENABLED=false ise her zaman geç (dev/self-hosted mod).
    """
    if not BILLING_ENABLED:
        return

    billing_status = get_setting(username, brand, "shopify", "billing_status", "")

    # Aktif abonelik → izin ver
    if billing_status == "active":
        return

    installed_at = int(get_setting(username, brand, "shopify", "installed_at", 0) or 0)

    # Shopify kaydı yok (password-login / self-hosted) → izin ver
    if not installed_at:
        return

    shop = get_setting(username, brand, "shopify", "shop_domain", "")
    retry_url = f"{APP_URL}/auth/shopify/install?shop={shop}" if shop else APP_URL

    # Reddedilmiş → erişimi kapat
    if billing_status == "declined":
        raise HTTPException(
            status_code=402,
            detail={
                "error": "billing_declined",
                "message": "Abonelik reddedildi. Shoptimize Live'ı kullanmak için ödemeyi onaylamanız gerekiyor.",
                "retry_url": retry_url,
            },
        )

    # Aktif DEĞİL + Shopify merchant (none/needs_billing/pending/cancelled/frozen):
    # deneme süresi içindeyse izin ver, dolduysa engelle. Onaylamayan herkes deneme
    # bitince engellenir (önceki bug: yalnızca pending/cancelled/frozen engelleniyordu).
    if installed_at and (time.time() < installed_at + PLAN_TRIAL_DAYS * 86400):
        return  # Deneme süresi dolmamış
    raise HTTPException(
        status_code=402,
        detail={
            "error": "trial_expired",
            "message": "Deneme süreniz doldu. Shoptimize Live'ı kullanmaya devam etmek için aboneliğinizi aktive edin.",
            "retry_url": retry_url,
        },
    )


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

def _shop_to_username(shop: str) -> str:
    """59fc15-cd.myshopify.com → 59fc15-cd"""
    return shop.replace(".myshopify.com", "").strip()


@router.get("/auth/shopify/install")
async def shopify_install(
    shop: str = Query(...),
    username: str = Query(""),   # opsiyonel — verilmezse shop'tan türetilir
    brand: str = Query("default"),
):
    """Shopify OAuth kurulum başlangıcı. App Store kurulumlarında username gerekmez."""
    shop = shop.strip().lower()
    if not shop.endswith(".myshopify.com"):
        raise HTTPException(400, "Geçersiz shop domain")

    if not SHOPIFY_CLIENT_ID:
        raise HTTPException(500, "SHOPIFY_CLIENT_ID ayarlanmamış")

    # App Store'dan gelen kurulumda username yok — shop'tan türet
    if not username:
        username = _shop_to_username(shop)

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
    is_reauth = state_data.get("reauth", False)

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
    if is_reauth:
        # Yeniden giriş: sadece token güncelle
        set_connection_settings(username, brand, "shopify", {"admin_api_token": access_token})
        logger.info("[OAuth] ✓ Yeniden giriş: shop=%s username=%s", shop, username)
    else:
        _updates = {
            "shop_domain": shop,
            "admin_api_token": access_token,
            "granted_scopes": granted_scopes,
        }
        # installed_at'i KORU — daha önce kurulduysa deneme tekrar başlamasın
        # (re-install ile sonsuz deneme açığını önler). Yoksa ilk kurulum say.
        _existing_installed = int(get_setting(username, brand, "shopify", "installed_at", 0) or 0)
        if not _existing_installed:
            _updates["installed_at"] = int(time.time())
        set_connection_settings(username, brand, "shopify", _updates)
        logger.info("[OAuth] ✓ Kurulum tamamlandı: shop=%s username=%s installed_at_korundu=%s",
                    shop, username, bool(_existing_installed))

    # 4b. Mağaza sahibi bilgilerini al ve kaydet (GraphQL)
    owner_phone = ""
    owner_name = ""
    try:
        from routers.live import _shopify_graphql
        _SHOP_GQL = """
        query {
          shop {
            name
            email
            phone
            billingAddress { name phone }
          }
        }
        """
        shop_resp = _shopify_graphql(shop, access_token, _SHOP_GQL)
        shop_info = shop_resp.get("data", {}).get("shop", {})
        billing   = shop_info.get("billingAddress") or {}
        owner_phone = str(shop_info.get("phone") or billing.get("phone") or "").strip()
        owner_name  = str(billing.get("name") or shop_info.get("name") or "").strip()
        # Mağaza görünen adını kaydet (admin panelde handle yerine gerçek isim göster)
        _shop_name = str(shop_info.get("name") or "").strip()
        if _shop_name:
            set_connection_settings(username, brand, "shopify", {"shop_name": _shop_name})
        if owner_phone:
            digits = "".join(c for c in owner_phone if c.isdigit())
            if digits and not owner_phone.startswith("+"):
                owner_phone = f"+9{digits}" if digits.startswith("0") else f"+{digits}"
            from services.redis_store import store as _store
            import asyncio
            if asyncio.get_event_loop().is_running():
                asyncio.ensure_future(_store.set_owner_phone(username, brand, owner_phone))
            logger.info("[OAuth] Mağaza sahibi telefonu kaydedildi: %s", owner_phone[-4:])
    except Exception as e:
        logger.warning("[OAuth] shop GraphQL alınamadı: %s", e)

    if is_reauth:
        # Yeniden giriş: doğrudan dashboard'a yönlendir
        from services.auth import create_access_token as _cat
        new_token = _cat(username, brand)
        tid = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
        redirect = (
            f"{APP_URL}/?auto_token={new_token}"
            f"&u={username}&b={brand}"
            + (f"&tid={tid}" if tid else "")
        )
        return RedirectResponse(redirect)

    # 5. Pixel TID oluştur / kaydet (Theme App Extension embed block'u kullanıcı aktive eder)
    tid = ""
    try:
        from routers.live import _get_or_create_tid
        from services.redis_store import store
        import asyncio

        tid = _get_or_create_tid(username, brand)

        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(store.register_tid_owner(tid, username, brand))

        # NOT: Pixel artık Theme App Extension (App Embed Block) ile yükleniyor.
        # Merchant, Theme Editor > App Embeds bölümünden aktive eder.
        # ScriptTag API'si deprecated olduğu için burada script tag oluşturulmaz.
        logger.info("[OAuth] ✓ TID hazır (Theme App Extension embed): tid=%s shop=%s", tid, shop)
    except Exception as e:
        logger.warning("[OAuth] TID oluşturma hatası (devam ediliyor): %s", e)

    # 6. Webhook'ları kaydet (GraphQL webhookSubscriptionCreate)
    try:
        from routers.live import _shopify_graphql, _WEBHOOK_TOPIC_MAP
        import secrets as _secrets

        wh_token = get_setting(username, brand, "shopify", "webhook_token", "")
        if not wh_token:
            wh_token = _secrets.token_hex(16)
            set_connection_settings(username, brand, "shopify", {"webhook_token": wh_token})

        checkout_url = f"{APP_URL}/api/shopify/webhook/checkouts-create?token={wh_token}&username={username}&brand={brand}"
        webhook_topics = [
            ("orders/create",    f"{APP_URL}/api/shopify/webhook/orders-create?token={wh_token}&username={username}&brand={brand}"),
            ("checkouts/create", checkout_url),
            ("checkouts/update", checkout_url),
            ("app/uninstalled",  f"{APP_URL}/webhooks/app/uninstalled"),
        ]
        _WH_MUT = """
        mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: {callbackUrl: $callbackUrl, format: JSON}) {
            webhookSubscription { id }
            userErrors { field message }
          }
        }
        """
        for topic, callback_url in webhook_topics:
            gql_topic = _WEBHOOK_TOPIC_MAP.get(topic, topic.upper().replace("/", "_"))
            try:
                _shopify_graphql(shop, access_token, _WH_MUT, {"topic": gql_topic, "callbackUrl": callback_url})
            except Exception as _we:
                logger.warning("[OAuth] Webhook kayıt hatası: topic=%s err=%s", topic, _we)
        set_connection_settings(username, brand, "shopify", {"webhooks_registered": "1"})
        logger.info("[OAuth] ✓ Webhook'lar kaydedildi (GraphQL): shop=%s", shop)
    except Exception as e:
        logger.warning("[OAuth] Webhook kurulum hatası: %s", e)

    # 7. Billing — embedded app açıldığında token exchange ile yapılacak
    #    Non-expiring token OAuth'ta alınıyor; billing için expiring token gerekiyor.
    #    auto_token VERMEDEN Shopify admin'e yönlendir → embedded app session yok →
    #    doShopifyAuth() → shopify_session_auth → token exchange → billing charge akışı.
    if BILLING_ENABLED:
        set_connection_settings(username, brand, "shopify", {"billing_status": "needs_billing"})
        # WA mesajı billing onayından sonra (billing/callback'te) gönderilecek.
        logger.info("[OAuth] Billing için admin'e yönlendiriliyor: shop=%s client=%s", shop, SHOPIFY_CLIENT_ID)
        return RedirectResponse(f"https://{shop}/admin/apps/{SHOPIFY_CLIENT_ID}")

    # BILLING_ENABLED=False → direkt giriş
    from services.auth import create_access_token as _cat
    _token = _cat(username, brand)
    if not tid:
        tid = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
    redirect = (
        f"{APP_URL}/?auto_token={_token}"
        f"&u={username}&b={brand}"
        + (f"&tid={tid}" if tid else "")
    )
    _send_welcome_wa(username, brand, owner_name, owner_phone, shop,
                     f"{APP_URL}/?auto_token={_token}&u={username}&b={brand}")
    return RedirectResponse(redirect)


class TokenRequest(BaseModel):
    username: str
    brand: str = "default"
    password: str


@router.post("/api/auth/token")
async def create_dashboard_token(body: TokenRequest):
    """Dashboard JWT token üreteci — DASHBOARD_PASSWORD ile korumalı."""
    if not DASHBOARD_PASSWORD:
        raise HTTPException(500, "DASHBOARD_PASSWORD ayarlanmamış")
    if body.password != DASHBOARD_PASSWORD:
        raise HTTPException(401, "Geçersiz şifre")
    _check_billing(body.username, body.brand)
    from services.auth import create_access_token
    token = create_access_token(body.username, body.brand)
    tid = get_setting(body.username, body.brand, "shopify", "pixel_tracking_id", "")
    return {"ok": True, "token": token, "username": body.username, "brand": body.brand, "tid": tid}


@router.get("/api/auth/status")
async def auth_status(current_user: dict = Depends(get_current_user_dep)):
    """
    JWT geçerliliği + billing durumunu döner.
    Dashboard her açılışta bunu çağırır → billing burada zorlanır (cache'li JWT ile
    giren ama denemesi bitmiş merchant'lar da engellensin diye). Deneme bittiyse 402.
    """
    username = current_user.get("username", "")
    brand    = current_user.get("brand", "default")
    _check_billing(username, brand)   # deneme bittiyse 402 fırlatır → frontend overlay gösterir
    billing_status  = get_setting(username, brand, "shopify", "billing_status",  "")
    installed_at_ts = int(get_setting(username, brand, "shopify", "installed_at", 0) or 0)
    trial_remaining = None
    if billing_status != "active" and installed_at_ts:
        import math
        remaining_sec = (installed_at_ts + PLAN_TRIAL_DAYS * 86400) - time.time()
        trial_remaining = max(0, math.ceil(remaining_sec / 86400))
    return {
        "ok": True,
        "username": username,
        "brand": brand,
        "billing_status": billing_status or "none",
        "trial_remaining_days": trial_remaining,
    }


@router.get("/install/success")
async def install_success(shop: str = Query("")):
    """Kurulum başarı sayfası."""
    return JSONResponse({
        "ok": True,
        "message": f"Shoptimize Live başarıyla kuruldu!",
        "shop": shop,
    })


# ---------------------------------------------------------------------------
# Yardımcı — WA hoş geldiniz mesajı (kurulum tamamlandığında)
# ---------------------------------------------------------------------------

def _send_welcome_wa(username: str, brand: str, owner_name: str, owner_phone: str, shop_domain: str, dashboard_url: str) -> None:
    """
    Mağaza sahibine kurulum tamamlandı WA mesajı gönderir.
    Operator WA credentials gerekir: OPERATOR_WA_TOKEN + OPERATOR_WA_PHONE_ID.

    Meta'da onaylanması gereken template:
      Adı      : shoptimize_kurulum
      Kategori : Utility
      Dil      : tr
      Gövde    : {{1}}, Shoptimize Live mağazanıza başarıyla kuruldu! 🎉\n\nMağaza: {{2}}\n\nDashboard'unuza erişmek için:\n{{3}}\n\n(Link 24 saat geçerlidir)
    """
    if not OPERATOR_WA_TOKEN or not OPERATOR_WA_PHONE_ID:
        return
    if not owner_phone:
        # Redis'te kayıtlı telefonu dene
        try:
            import asyncio
            from services.redis_store import store as _store
            loop = asyncio.get_event_loop()
            if loop.is_running():
                async def _get():
                    r = await _store.get_username_by_phone.__func__  # bulunamaz, pass
                asyncio.ensure_future(_send_welcome_wa_async(username, brand, owner_name, shop_domain, dashboard_url))
                return
        except Exception:
            pass
        return
    try:
        import asyncio
        asyncio.ensure_future(_send_welcome_wa_async_direct(owner_phone, owner_name, shop_domain, dashboard_url))
    except Exception as e:
        logger.warning("[AUTH] WA welcome async başlatılamadı: %s", e)


def _phone_lang(phone: str) -> str:
    """Telefon ülke kodundan dil tahmini: +90 → tr, diğer → en."""
    normalized = phone.lstrip("+")
    return "tr" if normalized.startswith("90") else "en"


async def _send_welcome_wa_async_direct(phone: str, name: str, shop_domain: str, dashboard_url: str) -> None:
    try:
        from services.wa_sender import send_wa_template
        lang = _phone_lang(phone)
        await send_wa_template(
            OPERATOR_WA_TOKEN, OPERATOR_WA_PHONE_ID, phone,
            name=name or ("Değerli üye" if lang == "tr" else "Dear merchant"),
            product=shop_domain,
            order_number=dashboard_url,
            template_name="shoptimize_kurulum",
            language=lang,
        )
    except Exception as e:
        logger.warning("[AUTH] WA welcome gönderilemedi: %s", e)


# ---------------------------------------------------------------------------
# Shopify OAuth ile yeniden giriş (kurulum yapılmaz)
# ---------------------------------------------------------------------------

@router.get("/auth/shopify/reauth")
async def shopify_reauth(
    shop: str = Query(...),
    brand: str = Query("default"),
    username: str = Query(""),
):
    """Mevcut merchant yeniden giriş için Shopify OAuth başlatır (pixel/billing yok)."""
    shop = shop.strip().lower()
    # Sadece handle girilmişse .myshopify.com ekle
    if "." not in shop:
        shop = f"{shop}.myshopify.com"
    elif not shop.endswith(".myshopify.com"):
        raise HTTPException(400, "Geçersiz mağaza adresi. Örnek: mystore.myshopify.com")

    if not SHOPIFY_CLIENT_ID:
        raise HTTPException(500, "Shopify app yapılandırılmamış")

    # username öncelik sırası: 1) explicit param  2) DB lookup  3) shop'tan türet
    if not username:
        found = lookup_username_by_shop(shop)
        if found:
            username, brand = found
            logger.info("[Reauth] DB lookup: shop=%s → username=%s brand=%s", shop, username, brand)
        else:
            username = _shop_to_username(shop)
            logger.warning("[Reauth] DB lookup başarısız, türetildi: shop=%s → username=%s", shop, username)

    state = _create_state(username, brand, reauth=True)

    auth_url = (
        f"https://{shop}/admin/oauth/authorize"
        f"?client_id={SHOPIFY_CLIENT_ID}"
        f"&scope={SCOPES}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&state={state}"
    )
    return RedirectResponse(auth_url)


# ---------------------------------------------------------------------------
# WA ile erişim linki isteği
# ---------------------------------------------------------------------------

class AccessRequest(BaseModel):
    phone: str
    lang: str = "tr"  # "tr" veya "en_US"


@router.post("/api/auth/request-access")
async def request_access(body: AccessRequest):
    """
    Telefon numarasına 1 saatlik dashboard erişim linki gönderir.
    Operator WA credentials gerekir: OPERATOR_WA_TOKEN + OPERATOR_WA_PHONE_ID.

    Meta'da onaylanması gereken template:
      Adı      : dashboard_erisim
      Kategori : Utility
      Dil      : tr
      Gövde    : Shoptimize Live dashboard erişim linkiniz:\n\n{{1}}\n\nLink 1 saat geçerlidir. Başkasıyla paylaşmayın.
    """
    if not OPERATOR_WA_TOKEN or not OPERATOR_WA_PHONE_ID:
        raise HTTPException(503, "WA erişim servisi henüz yapılandırılmamış")

    phone = body.phone.strip()
    if not phone:
        raise HTTPException(400, "Telefon numarası gerekli")

    # Normalize
    digits = "".join(c for c in phone if c.isdigit())
    if phone.startswith("+"):
        phone_e164 = "+" + digits
    elif digits.startswith("0"):
        phone_e164 = "+9" + digits
    else:
        phone_e164 = "+" + digits

    from services.redis_store import store
    mapping = await store.get_username_by_phone(phone_e164)
    if not mapping:
        # Güvenlik: telefon bulunamasa da aynı mesajı döndür
        logger.info("[AUTH] WA access: telefon bulunamadı %s", phone_e164[-4:])
        return {"ok": True, "sent": False}

    username, brand = mapping
    from services.auth import create_access_token
    tid = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
    token = create_access_token(username, brand, expires_days=0, expires_hours=1)  # 1 saat
    access_url = (
        f"{APP_URL}/?auto_token={token}"
        f"&u={username}&b={brand}"
        + (f"&tid={tid}" if tid else "")
    )

    # Dil: istekten al, yoksa telefon ülke kodundan tahmin et
    lang = body.lang if body.lang in ("tr", "en_US", "en") else _phone_lang(phone_e164)
    # panel_access şablonu Meta'da "en" (English) diliyle kayıtlı — "en_US" değil!
    if lang in ("en_US", "en"):
        lang = "en"

    # TR → dashboard_erisim, EN → panel_access (farklı Meta template adları)
    tpl_name = "dashboard_erisim" if lang == "tr" else "panel_access"

    from services.wa_sender import send_wa_template
    logger.info("[AUTH] WA access gönderiliyor: op_phone_id=%s tpl=%s lang=%s",
                OPERATOR_WA_PHONE_ID[-6:] if OPERATOR_WA_PHONE_ID else "?", tpl_name, lang)
    result = await send_wa_template(
        OPERATOR_WA_TOKEN, OPERATOR_WA_PHONE_ID, phone_e164,
        name=access_url,  # {{link}} parametresi
        template_name=tpl_name,
        language=lang,
    )

    if result.get("ok"):
        logger.info("[AUTH] WA access linki gönderildi: %s", phone_e164[-4:])
        return {"ok": True, "sent": True}
    # WA gönderimi başarısız — "not_found" değil "wa_error" olarak işaretle
    logger.warning("[AUTH] WA access gönderimi başarısız: %s", result.get("error", ""))
    return {"ok": True, "sent": False, "reason": "wa_error"}


# ---------------------------------------------------------------------------
# App Bridge session token → dashboard JWT  (embedded app auth)
# ---------------------------------------------------------------------------

class ShopifySessionTokenRequest(BaseModel):
    session_token: str
    activate: bool = False   # True → deneme sürse bile abonelik onayına yönlendir


def _verify_jwt_with_secret(header_b64: str, payload_b64: str, sig_b64: str, secret: str) -> bool:
    """Verilen secret ile JWT HS256 imzasını doğrular."""
    try:
        message   = f"{header_b64}.{payload_b64}".encode()
        sig_padded = sig_b64 + "=" * ((4 - len(sig_b64) % 4) % 4)
        sig_bytes  = base64.urlsafe_b64decode(sig_padded)
        expected   = hmac.new(secret.encode(), message, hashlib.sha256).digest()
        return hmac.compare_digest(expected, sig_bytes)
    except Exception:
        return False


def _verify_shopify_session_token(token: str) -> Optional[dict]:
    """
    Shopify App Bridge session token'ı doğrular (JWT HS256).
    Önce SHOPIFY_CLIENT_SECRET, başarısız olursa SHOPIFY_CLIENT_SECRET_LEGACY dener.
    Bu sayede eski ve yeni app sürümleri aynı backend'i paylaşabilir.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts

        # Önce ana secret'ı dene, sonra legacy fallback
        secrets_to_try = [s for s in [SHOPIFY_CLIENT_SECRET, SHOPIFY_CLIENT_SECRET_LEGACY] if s]
        verified = False
        for idx, secret in enumerate(secrets_to_try):
            if _verify_jwt_with_secret(header_b64, payload_b64, sig_b64, secret):
                if idx > 0:
                    logger.info("[SessTok] Legacy secret ile doğrulandı (eski app sürümü)")
                verified = True
                break

        if not verified:
            logger.warning("[SessTok] Signature mismatch (denenen secret sayısı: %d)", len(secrets_to_try))
            return None

        # Payload decode
        pay_padded = payload_b64 + "=" * ((4 - len(payload_b64) % 4) % 4)
        payload    = json.loads(base64.urlsafe_b64decode(pay_padded))

        # Expiry / nbf
        now = time.time()
        if payload.get("exp", 0) < now:
            logger.warning("[SessTok] Token süresi dolmuş")
            return None
        if payload.get("nbf", now) > now + 10:   # 10sn tolerans
            return None

        # Audience — uyarı ver ama reddetme; imza doğrulaması yeterli güvenlik sağlar.
        # Birden fazla app/client_id ile aynı backend çalışabilir.
        aud = payload.get("aud", "")
        aud_list = aud if isinstance(aud, list) else [aud]
        if SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_ID not in aud_list:
            logger.info("[SessTok] Farklı audience (eski app): aud=%s — devam ediliyor", aud)

        return payload
    except Exception as e:
        logger.warning("[SessTok] Parse hatası: %s", e)
        return None


def _exchange_session_token_for_offline(shop: str, session_token: str) -> Optional[str]:
    """
    Shopify App Bridge session token'ını offline access token ile değiştirir.
    Token Exchange grant (RFC 8693).
    """
    url = f"https://{shop}/admin/oauth/access_token"
    payload = {
        "client_id":            SHOPIFY_CLIENT_ID,
        "client_secret":        SHOPIFY_CLIENT_SECRET,
        "grant_type":           "urn:ietf:params:oauth:grant-type:token-exchange",
        "subject_token":        session_token,
        "subject_token_type":   "urn:ietf:params:oauth:token-type:id_token",
        "requested_token_type": "urn:shopify:params:oauth:token-type:offline-access-token",
    }
    logger.warning("[TokenExchange/offline] Deneniyor: shop=%s", shop)
    try:
        r = requests.post(url, json=payload, timeout=10)
        logger.warning("[TokenExchange/offline] Response: shop=%s status=%d body=%s",
                       shop, r.status_code, r.text[:500])
        if r.status_code == 200:
            data  = r.json()
            token = data.get("access_token", "")
            if token:
                logger.warning("[TokenExchange/offline] ✓ Token alındı: shop=%s token_len=%d prefix=%s",
                               shop, len(token), token[:8])
                return token
            logger.warning("[TokenExchange/offline] 200 ama access_token yok: body=%s", data)
        return None
    except Exception as e:
        logger.warning("[TokenExchange/offline] Hata: shop=%s error=%s", shop, e)
        return None


def _exchange_session_token_for_online(shop: str, session_token: str) -> Optional[str]:
    """
    Shopify App Bridge session token'ını kısa süreli ONLINE access token ile değiştirir.
    Online token'lar ~1 gün geçerlidir ve Shopify tarafından her zaman "expiring" kabul edilir.
    Billing API çağrıları için kullanılır (non-expiring token 403 hatasını önler).
    """
    url = f"https://{shop}/admin/oauth/access_token"
    payload = {
        "client_id":            SHOPIFY_CLIENT_ID,
        "client_secret":        SHOPIFY_CLIENT_SECRET,
        "grant_type":           "urn:ietf:params:oauth:grant-type:token-exchange",
        "subject_token":        session_token,
        "subject_token_type":   "urn:ietf:params:oauth:token-type:id_token",
        "requested_token_type": "urn:shopify:params:oauth:token-type:online-access-token",
    }
    logger.warning("[TokenExchange/online] Deneniyor: shop=%s", shop)
    try:
        r = requests.post(url, json=payload, timeout=10)
        logger.warning("[TokenExchange/online] Response: shop=%s status=%d body=%s",
                       shop, r.status_code, r.text[:500])
        if r.status_code == 200:
            data  = r.json()
            token = data.get("access_token", "")
            if token:
                logger.warning("[TokenExchange/online] ✓ Token alındı: shop=%s token_len=%d prefix=%s",
                               shop, len(token), token[:8])
                return token
            logger.warning("[TokenExchange/online] 200 ama access_token yok: body=%s", data)
        return None
    except Exception as e:
        logger.warning("[TokenExchange/online] Hata: shop=%s error=%s", shop, e)
        return None


def _ensure_webhooks_registered(shop: str, username: str, brand: str, access_token: str) -> None:
    """Token-exchange ile kurulan mağazalarda webhook'ları BİR KEZ kaydeder.
    Modern Shopify install akışı OAuth callback'i atlayıp token exchange kullanabilir;
    o durumda checkouts/create + orders/create webhook'ları hiç kaydolmaz → sepet
    kurtarma çalışmaz. Aynı callback URL'i ile tekrar kayıt Shopify tarafından
    reddedilir (duplicate) → mevcut OAuth mağazalarında zararsızdır."""
    if not access_token:
        return
    if get_setting(username, brand, "shopify", "webhooks_registered", ""):
        return
    try:
        from routers.live import _shopify_graphql, _WEBHOOK_TOPIC_MAP
        import secrets as _secrets
        wh_token = get_setting(username, brand, "shopify", "webhook_token", "")
        if not wh_token:
            wh_token = _secrets.token_hex(16)
            set_connection_settings(username, brand, "shopify", {"webhook_token": wh_token})
        checkout_url = f"{APP_URL}/api/shopify/webhook/checkouts-create?token={wh_token}&username={username}&brand={brand}"
        webhook_topics = [
            ("orders/create",    f"{APP_URL}/api/shopify/webhook/orders-create?token={wh_token}&username={username}&brand={brand}"),
            ("checkouts/create", checkout_url),
            ("checkouts/update", checkout_url),
            ("app/uninstalled",  f"{APP_URL}/webhooks/app/uninstalled"),
        ]
        _WH_MUT = """
        mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: {callbackUrl: $callbackUrl, format: JSON}) {
            webhookSubscription { id }
            userErrors { field message }
          }
        }
        """
        for topic, callback_url in webhook_topics:
            gql_topic = _WEBHOOK_TOPIC_MAP.get(topic, topic.upper().replace("/", "_"))
            try:
                _shopify_graphql(shop, access_token, _WH_MUT, {"topic": gql_topic, "callbackUrl": callback_url})
            except Exception as _we:
                logger.warning("[SessTok] Webhook kayıt hatası: topic=%s err=%s", topic, _we)
        set_connection_settings(username, brand, "shopify", {"webhooks_registered": "1"})
        logger.info("[SessTok] ✓ Webhook'lar kaydedildi (token-exchange): shop=%s", shop)
    except Exception as e:
        logger.warning("[SessTok] Webhook kurulum hatası: %s", e)


@router.post("/api/auth/shopify-token")
async def shopify_session_auth(body: ShopifySessionTokenRequest):
    """
    App Bridge session token → dashboard JWT.
    Shopify admin embedded app için şifresiz otomatik giriş sağlar.

    Ek olarak:
    - Token exchange ile expiring offline token alır ve DB'ye kaydeder (non-expiring token sorununu düzeltir)
    - billing_status=="needs_billing" ise billing charge oluşturur ve onay URL'ini döner
    """
    payload = _verify_shopify_session_token(body.session_token)
    if not payload:
        raise HTTPException(401, "Geçersiz veya süresi dolmuş session token")

    # dest: "https://mystore.myshopify.com"
    dest = payload.get("dest", "")
    shop = dest.replace("https://", "").replace("http://", "").rstrip("/")

    if not shop or not shop.endswith(".myshopify.com"):
        raise HTTPException(401, f"Geçersiz shop: {dest}")

    found = lookup_username_by_shop(shop)
    if not found:
        logger.warning("[SessTok] Mağaza bulunamadı: %s", shop)
        raise HTTPException(404, "Mağaza bulunamadı. Uygulamayı Shopify App Store'dan yükleyin.")

    username, brand = found

    # ── Token exchange: expiring offline token al, DB'yi güncelle ──────────
    new_access_token = _exchange_session_token_for_offline(shop, body.session_token)
    if new_access_token:
        set_connection_settings(username, brand, "shopify", {"admin_api_token": new_access_token})

    # ── Webhook'ları garanti et (OAuth atlandıysa burada kaydedilir) ────────
    _ensure_webhooks_registered(
        shop, username, brand,
        new_access_token or get_setting(username, brand, "shopify", "admin_api_token", ""),
    )

    # ── Online token'ı Redis'e kaydet (user-triggered API çağrıları için) ──
    # Online token her zaman expiring → Admin API 403 hatasını önler.
    import asyncio as _asyncio
    online_tok = _exchange_session_token_for_online(shop, body.session_token)
    if online_tok:
        from services.redis_store import store as _store
        if _asyncio.get_event_loop().is_running():
            _asyncio.ensure_future(_store.set_online_token(username, brand, online_tok))

    from services.auth import create_access_token
    token = create_access_token(username, brand)
    tid   = get_setting(username, brand, "shopify", "pixel_tracking_id", "")

    # ── Billing zorlaması (Managed Pricing) ─────────────────────────────────
    # Bu uygulama Shopify "Managed Pricing" — Billing API ile ücret OLUŞTURULAMAZ.
    # Gerçek abonelik durumu Shopify'dan sorgulanır; gerekirse merchant Shopify'ın
    # fiyatlandırma sayfasına yönlendirilir (billing_url).
    billing_url = None
    if BILLING_ENABLED:
        billing_status = get_setting(username, brand, "shopify", "billing_status", "")

        # Gerçek abonelik durumunu Shopify'dan doğrula (tek doğru kaynak)
        bill_token = online_tok or new_access_token or get_setting(username, brand, "shopify", "admin_api_token", "")
        if bill_token:
            subscribed = _has_active_subscription(shop, bill_token)
            if subscribed and billing_status != "active":
                set_connection_settings(username, brand, "shopify", {"billing_status": "active"})
                billing_status = "active"
            elif not subscribed and billing_status == "active":
                set_connection_settings(username, brand, "shopify", {"billing_status": "needs_billing"})
                billing_status = "needs_billing"

        installed_at = int(get_setting(username, brand, "shopify", "installed_at", 0) or 0)
        trial_active = bool(installed_at) and (time.time() < installed_at + PLAN_TRIAL_DAYS * 86400)
        allow = (billing_status == "active") or (not installed_at) or trial_active
        # Deneme bitti VEYA merchant "Aboneliği Aktive Et"e bastı → managed pricing sayfası
        if (not allow) or (body.activate and billing_status != "active"):
            billing_url = _managed_pricing_url(shop)

    logger.info("[SessTok] ✓ Embedded giriş: shop=%s username=%s billing_url=%s",
                shop, username, "yes" if billing_url else "no")
    return {
        "ok":          True,
        "token":       token,
        "username":    username,
        "brand":       brand,
        "shop":        shop,          # tenant guard: frontend bu shop'u session'a yazar
        "tid":         tid or "",
        "billing_url": billing_url,   # varsa frontend buraya yönlendirir
    }


# ---------------------------------------------------------------------------
# Sahip telefonu kaydet (onboarding modal'dan)
# ---------------------------------------------------------------------------

class OwnerPhoneRequest(BaseModel):
    phone: str


@router.post("/api/auth/owner-phone")
async def save_owner_phone(body: OwnerPhoneRequest, request: Request):
    """Onboarding sırasında mağaza sahibinin telefonunu kaydeder."""
    from services.auth import get_current_user
    user = await get_current_user(request)
    username = user.get("username", "")
    brand = user.get("brand", "default")

    phone = body.phone.strip()
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 7:
        raise HTTPException(400, "Geçersiz telefon numarası")

    if phone.startswith("+"):
        phone_e164 = "+" + digits
    elif digits.startswith("0"):
        phone_e164 = "+9" + digits
    else:
        phone_e164 = "+" + digits

    from services.redis_store import store
    await store.set_owner_phone(username, brand, phone_e164)
    logger.info("[AUTH] Sahip telefonu kaydedildi: %s → %s:%s", phone_e164[-4:], username, brand)
    return {"ok": True, "phone": phone_e164}
