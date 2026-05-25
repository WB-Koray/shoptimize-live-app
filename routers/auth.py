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
from pydantic import BaseModel

from services.db import get_setting, set_connection_settings

logger = logging.getLogger(__name__)
router = APIRouter()

SHOPIFY_CLIENT_ID = os.getenv("SHOPIFY_CLIENT_ID", "")
SHOPIFY_CLIENT_SECRET = os.getenv("SHOPIFY_CLIENT_SECRET", "")
APP_URL = os.getenv("SHOPIFY_APP_URL", "https://live.shoptimize.com.tr")
REDIRECT_URI = f"{APP_URL}/auth/shopify/callback"
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")
OPERATOR_WA_TOKEN    = os.getenv("OPERATOR_WA_TOKEN", "")
OPERATOR_WA_PHONE_ID = os.getenv("OPERATOR_WA_PHONE_ID", "")

SCOPES = "read_script_tags,write_script_tags,read_customers,read_orders,read_checkouts"
BILLING_ENABLED = os.getenv("BILLING_ENABLED", "true").lower() == "true"
PLAN_TRIAL_DAYS = int(os.getenv("BILLING_TRIAL_DAYS", "7"))

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

    # Kayıt yoksa → izin ver (doğrudan kurulum / self-hosted)
    if not billing_status:
        return

    # Aktif abonelik → izin ver
    if billing_status == "active":
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

    # Beklemede / iptal / dondurulmuş → deneme süresi içindeyse izin ver
    if billing_status in ("pending", "cancelled", "frozen"):
        installed_at = int(get_setting(username, brand, "shopify", "installed_at", 0) or 0)
        if installed_at and (time.time() < installed_at + PLAN_TRIAL_DAYS * 86400):
            return  # Deneme süresi dolmamış
        raise HTTPException(
            status_code=402,
            detail={
                "error": "trial_expired",
                "message": f"Deneme süreniz doldu. Shoptimize Live'ı kullanmaya devam etmek için aboneliğinizi aktive edin.",
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
        set_connection_settings(username, brand, "shopify", {
            "shop_domain": shop,
            "admin_api_token": access_token,
            "granted_scopes": granted_scopes,
            "installed_at": int(time.time()),
        })
        logger.info("[OAuth] ✓ Kurulum tamamlandı: shop=%s username=%s", shop, username)

    # 4b. Mağaza sahibi bilgilerini al ve kaydet
    owner_phone = ""
    owner_name = ""
    try:
        from routers.live import _shopify_headers, _shopify_url
        shop_r = requests.get(
            _shopify_url(shop, "shop.json"),
            headers=_shopify_headers(access_token),
            timeout=10,
        )
        if shop_r.status_code == 200:
            shop_info = shop_r.json().get("shop", {})
            owner_phone = str(shop_info.get("phone") or "").strip()
            owner_name  = str(shop_info.get("shop_owner") or shop_info.get("name") or "").strip()
            if owner_phone:
                # E.164 formatına çevir (TR numaraları için)
                digits = "".join(c for c in owner_phone if c.isdigit())
                if digits and not owner_phone.startswith("+"):
                    owner_phone = f"+9{digits}" if digits.startswith("0") else f"+{digits}"
                from services.redis_store import store as _store
                import asyncio
                if asyncio.get_event_loop().is_running():
                    asyncio.ensure_future(_store.set_owner_phone(username, brand, owner_phone))
                logger.info("[OAuth] Mağaza sahibi telefonu kaydedildi: %s", owner_phone[-4:])
    except Exception as e:
        logger.warning("[OAuth] shop.json alınamadı: %s", e)

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

    # 5. Pixel'i otomatik kur
    tid = ""
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

        webhook_topics = [
            ("orders/create",    f"{APP_URL}/api/shopify/webhook/orders-create?token={wh_token}&username={username}&brand={brand}"),
            ("checkouts/create", f"{APP_URL}/api/shopify/webhook/checkouts-create?token={wh_token}&username={username}&brand={brand}"),
            ("app/uninstalled",  f"{APP_URL}/webhooks/app/uninstalled"),
        ]
        for topic, callback_url in webhook_topics:
            requests.post(
                _shopify_url(shop, "webhooks.json"),
                json={"webhook": {"topic": topic, "address": callback_url, "format": "json"}},
                headers=_shopify_headers(access_token),
                timeout=15,
            )
        logger.info("[OAuth] ✓ Webhook'lar kaydedildi: shop=%s", shop)
    except Exception as e:
        logger.warning("[OAuth] Webhook kurulum hatası: %s", e)

    # 7. Billing — onay sayfasına yönlendir
    try:
        from routers.billing import create_charge
        confirmation_url = create_charge(shop, access_token, username, brand)
        # WA kurulum mesajı billing callback'te gönderilecek — orada auto_token var
        return RedirectResponse(confirmation_url)
    except Exception as e:
        logger.warning("[OAuth] Billing oluşturulamadı, direkt giriş yapılıyor: %s", e)
        from services.auth import create_access_token
        token = create_access_token(username, brand)
        if not tid:
            tid = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
        redirect = (
            f"{APP_URL}/?auto_token={token}"
            f"&u={username}&b={brand}"
            + (f"&tid={tid}" if tid else "")
        )
        # WA kurulum mesajı gönder
        _send_welcome_wa(username, brand, owner_name, owner_phone, shop, f"{APP_URL}/?auto_token={token}&u={username}&b={brand}")
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
    """Telefon ülke kodundan dil tahmini: +90 → tr, diğer → en_US."""
    normalized = phone.lstrip("+")
    return "tr" if normalized.startswith("90") else "en_US"


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

    username = _shop_to_username(shop)
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
    if lang == "en":
        lang = "en_US"

    # TR → dashboard_erisim, EN → panel_access (farklı Meta template adları)
    tpl_name = "dashboard_erisim" if lang == "tr" else "panel_access"

    from services.wa_sender import send_wa_template
    result = await send_wa_template(
        OPERATOR_WA_TOKEN, OPERATOR_WA_PHONE_ID, phone_e164,
        name=access_url,  # {{link}} parametresi
        template_name=tpl_name,
        language=lang,
    )

    if result.get("ok"):
        logger.info("[AUTH] WA access linki gönderildi: %s", phone_e164[-4:])
    return {"ok": True, "sent": result.get("ok", False)}


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
