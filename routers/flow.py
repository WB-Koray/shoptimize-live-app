"""
Flow (Otomasyon) API — WhatsApp terk edilmiş ödeme bildirimleri.
Sequence ayarları, log görüntüleme, test gönderimi, opt-out yönetimi.
"""

import logging
import requests as _requests
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from services.auth import get_current_user
from services.redis_store import store
from services.wa_sender import send_wa_template

META_GRAPH = "https://graph.facebook.com/v19.0"

# Varsayılan şablon tanımları — merchant düzenleyebilir
_DEFAULT_TEMPLATES = [
    {
        "name": "sepet_hatirlatma",
        "body_tr": "Merhaba {{1}}, sepetinizde {{2}} bıraktınız! Hâlâ sizi bekliyor 🛒",
        "body_en": "Hi {{1}}, you left {{2}} in your cart! It's still waiting for you 🛒",
    },
    {
        "name": "sepet_hatirlatma_2",
        "body_tr": "{{1}}, sepetinizdeki ürünler hâlâ duruyor. Stoklar sınırlı olabilir! ⏰",
        "body_en": "{{1}}, the items in your cart are still there. Stocks may be limited! ⏰",
    },
    {
        "name": "sepet_hatirlatma_3",
        "body_tr": "Son hatırlatma: {{1}}, sepetinizdeki {{2}} için fırsatı kaçırmayın! 🎯",
        "body_en": "Last reminder: {{1}}, don't miss out on {{2}} still in your cart! 🎯",
    },
    {
        "name": "siparis_onay",
        "body_tr": "Teşekkürler {{1}}! {{2}} siparişiniz alındı ve hazırlanıyor. 📦",
        "body_en": "Thank you {{1}}! Your order for {{2}} has been received and is being prepared. 📦",
    },
]


def _get_waba_id(phone_number_id: str, token: str) -> str | None:
    """Phone Number ID'den WhatsApp Business Account ID'yi alır."""
    try:
        r = _requests.get(
            f"{META_GRAPH}/{phone_number_id}",
            params={"fields": "whatsapp_business_account", "access_token": token},
            timeout=10,
        )
        data = r.json()
        return data.get("whatsapp_business_account", {}).get("id")
    except Exception as e:
        logger.warning("[WA Templates] WABA ID alınamadı: %s", e)
        return None


def _create_template(waba_id: str, token: str, name: str, body: str, language: str) -> dict:
    """Tek bir WhatsApp template oluşturur ve Meta'ya onaya gönderir."""
    payload = {
        "name": name,
        "language": language,
        "category": "MARKETING",
        "components": [{"type": "BODY", "text": body}],
    }
    r = _requests.post(
        f"{META_GRAPH}/{waba_id}/message_templates",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    return r.json()


def _get_template_statuses(waba_id: str, token: str, names: list[str]) -> dict:
    """Template'lerin onay durumlarını döner: {name_lang: status}"""
    result = {}
    try:
        r = _requests.get(
            f"{META_GRAPH}/{waba_id}/message_templates",
            params={"fields": "name,language,status", "limit": 100, "access_token": token},
            timeout=10,
        )
        for tpl in r.json().get("data", []):
            key = f"{tpl['name']}_{tpl['language']}"
            result[key] = tpl.get("status", "UNKNOWN")
    except Exception as e:
        logger.warning("[WA Templates] Durum alınamadı: %s", e)
    return result

logger = logging.getLogger(__name__)
router = APIRouter()

DEFAULT_SEQUENCE = [
    {"delay_minutes": 15,   "template": "sepet_hatirlatma",   "language": "tr", "enabled": True,  "label": "First reminder"},
    {"delay_minutes": 1440, "template": "sepet_hatirlatma_2", "language": "tr", "enabled": False, "label": "After 24 hours"},
    {"delay_minutes": 2880, "template": "sepet_hatirlatma_3", "language": "tr", "enabled": False, "label": "After 48 hours"},
]


@router.get("/api/flow/settings")
async def get_flow_settings(
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    settings = await store.get_flow_settings(username, brand)
    if settings.get("wa_token"):
        settings["wa_token_masked"] = "•" * 8 + settings["wa_token"][-4:]
        settings["wa_token"] = ""
    if "sequence" not in settings:
        settings["sequence"] = DEFAULT_SEQUENCE
    return {"ok": True, "settings": settings}


@router.post("/api/flow/settings")
async def save_flow_settings(
    request_data: dict,
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    existing = await store.get_flow_settings(username, brand)

    wa_token = request_data.get("wa_token", "").strip()
    if not wa_token and existing.get("wa_token"):
        wa_token = existing["wa_token"]

    # Sequence doğrulama
    raw_seq = request_data.get("sequence", existing.get("sequence", DEFAULT_SEQUENCE))
    sequence = []
    for step in raw_seq:
        sequence.append({
            "delay_minutes": max(5, min(43200, int(step.get("delay_minutes", 15)))),
            "template":      str(step.get("template", "sepet_hatirlatma")).strip(),
            "language":      str(step.get("language", "tr")).strip() or "tr",
            "enabled":       bool(step.get("enabled", False)),
            "label":         str(step.get("label", "Adım")).strip()[:50],
        })

    settings = {
        "enabled":           bool(request_data.get("enabled", False)),
        "wa_token":          wa_token,
        "phone_number_id":   str(request_data.get("phone_number_id", "")).strip(),
        "delay_minutes":     sequence[0]["delay_minutes"] if sequence else 15,
        "sequence":          sequence,
        "cooldown_hours":    max(1, min(168, int(request_data.get("cooldown_hours", 48)))),
        "min_cart_value":    max(0, float(request_data.get("min_cart_value", 0))),
        "send_window_start": max(0, min(23, int(request_data.get("send_window_start", 9)))),
        "send_window_end":   max(1, min(24, int(request_data.get("send_window_end", 21)))),
    }

    await store.save_flow_settings(username, brand, settings)
    # WA phone_number_id → merchant eşlemesini kaydet (opt-out routing için)
    phone_number_id = settings.get("phone_number_id", "")
    if phone_number_id:
        await store.set_merchant_phone_id(phone_number_id, username, brand)
    return {"ok": True}


@router.post("/api/flow/test")
async def send_test_message(
    request_data: dict,
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    settings = await store.get_flow_settings(username, brand)
    to_phone = str(request_data.get("phone", "")).strip()

    if not to_phone:
        return JSONResponse({"ok": False, "error": "Telefon numarası gerekli"}, status_code=400)
    if not settings.get("wa_token") or not settings.get("phone_number_id"):
        return JSONResponse({"ok": False, "error": "WA Token ve Phone Number ID ayarlanmamış"}, status_code=400)

    digits = "".join(c for c in to_phone if c.isdigit())
    if digits.startswith("0"):
        to_phone = f"+9{digits}"
    elif not to_phone.startswith("+"):
        to_phone = f"+{digits}"

    template = request_data.get("template", "sepet_hatirlatma")
    result = await send_wa_template(
        settings["wa_token"],
        settings["phone_number_id"],
        to_phone,
        name="Test Kullanıcı",
        product="Test Ürün",
        template_name=template,
    )
    return JSONResponse(result)


@router.post("/api/flow/quick-trigger")
async def quick_trigger_wa(
    request_data: dict,
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Belirli bir müşteriye anında WA sepet hatırlatması gönderir (Abandonment Intelligence)."""
    settings = await store.get_flow_settings(username, brand)
    to_phone = str(request_data.get("phone", "")).strip()
    name = str(request_data.get("name", "")).strip()
    product = str(request_data.get("product", "")).strip()

    if not to_phone:
        return JSONResponse({"ok": False, "error": "Telefon numarası gerekli"}, status_code=400)
    if not settings.get("wa_token") or not settings.get("phone_number_id"):
        return JSONResponse({"ok": False, "error": "WA ayarlanmamış"}, status_code=400)

    digits = "".join(c for c in to_phone if c.isdigit())
    if digits.startswith("0"):
        to_phone = f"+9{digits}"
    elif not to_phone.startswith("+"):
        to_phone = f"+{digits}"

    result = await send_wa_template(
        settings["wa_token"],
        settings["phone_number_id"],
        to_phone,
        name=name or "Değerli müşterimiz",
        product=product or "ürünler",
        template_name="sepet_hatirlatma",
    )
    if result.get("ok"):
        await store.append_flow_log(username, brand, {
            "phone": to_phone[-4:],
            "name": name,
            "product": product,
            "step": 0,
            "step_label": "Quick Send (Abandonment)",
            "ok": True,
            "manual": True,
            "ts": int(__import__("time").time() * 1000),
        })
    return JSONResponse(result)


@router.get("/api/flow/logs")
async def get_flow_logs(
    username: str = Query(""),
    brand: str = Query("default"),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    logs = await store.get_flow_logs(username, brand, limit=min(limit, 500))
    converted = await store.get_converted_tokens(username, brand)
    for entry in logs:
        token = entry.get("token", "")
        entry["converted"] = token in converted
    return {"ok": True, "logs": logs}


@router.delete("/api/flow/logs")
async def clear_flow_logs(
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    await store.clear_flow_logs(username, brand)
    return {"ok": True}


@router.get("/api/flow/orders")
async def get_converted_orders(
    username: str = Query(""),
    brand: str = Query("default"),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    orders = await store.get_converted_orders(username, brand, limit=min(limit, 100))
    return {"ok": True, "orders": orders}


@router.get("/api/flow/roi")
async def get_wa_roi(
    username: str = Query(""),
    brand: str = Query("default"),
    days: int = Query(7),
    current_user: dict = Depends(get_current_user),
):
    """WA → Sipariş ROI zinciri: son N günde WA attribution istatistikleri."""
    stats = await store.get_wa_roi_stats(username, brand, days=min(max(1, days), 90))
    return {"ok": True, **stats}


# ── Opt-out yönetimi ─────────────────────────────────────────────────────────

@router.get("/api/flow/optouts")
async def get_optouts(current_user: dict = Depends(get_current_user)):
    username = current_user.get("username", "")
    brand    = current_user.get("brand", "default")
    phones = await store.get_all_optouts(username, brand)
    return {"ok": True, "phones": phones}


@router.post("/api/flow/optout")
async def add_optout(
    request_data: dict,
    current_user: dict = Depends(get_current_user),
):
    phone    = str(request_data.get("phone", "")).strip()
    username = current_user.get("username", "")
    brand    = current_user.get("brand", "default")
    if not phone:
        return JSONResponse({"ok": False, "error": "Telefon gerekli"}, status_code=400)
    await store.add_optout(phone, username, brand)
    return {"ok": True}


@router.delete("/api/flow/optout")
async def remove_optout(
    phone: str = Query(""),
    current_user: dict = Depends(get_current_user),
):
    username = current_user.get("username", "")
    brand    = current_user.get("brand", "default")
    if not phone:
        return JSONResponse({"ok": False, "error": "Telefon gerekli"}, status_code=400)
    await store.remove_optout(phone, username, brand)
    return {"ok": True}


# ── WhatsApp Template Yönetimi ───────────────────────────────────────────────

@router.get("/api/flow/template-defaults")
async def get_template_defaults(current_user: dict = Depends(get_current_user)):
    """Varsayılan şablon metinlerini döner (merchant düzenleyebilir)."""
    return {"ok": True, "templates": _DEFAULT_TEMPLATES}


@router.post("/api/flow/create-templates")
async def create_templates(
    request_data: dict,
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """
    Merchant'ın WA token'ı ile Meta'ya şablon oluşturma isteği gönderir.
    request_data: { templates: [{name, body_tr, body_en}, ...] }
    """
    settings = await store.get_flow_settings(username, brand)
    token          = settings.get("wa_token", "")
    phone_number_id = settings.get("phone_number_id", "")

    if not token or not phone_number_id:
        return JSONResponse({"ok": False, "error": "WA Token ve Phone Number ID önce kaydedilmeli"}, status_code=400)

    waba_id = _get_waba_id(phone_number_id, token)
    if not waba_id:
        return JSONResponse({"ok": False, "error": "WABA ID alınamadı. Token ve Phone Number ID'yi kontrol edin."}, status_code=400)

    templates = request_data.get("templates", _DEFAULT_TEMPLATES)
    results = []

    for tpl in templates:
        name     = tpl.get("name", "")
        body_tr  = tpl.get("body_tr", "")
        body_en  = tpl.get("body_en", "")
        tpl_result = {"name": name, "tr": None, "en": None}

        if body_tr:
            res = _create_template(waba_id, token, name, body_tr, "tr")
            tpl_result["tr"] = res.get("status") or res.get("error", {}).get("message") or str(res)

        if body_en:
            res = _create_template(waba_id, token, name, body_en, "en_US")
            tpl_result["en"] = res.get("status") or res.get("error", {}).get("message") or str(res)

        results.append(tpl_result)
        logger.info("[WA Templates] %s: tr=%s en=%s", name, tpl_result["tr"], tpl_result["en"])

    return {"ok": True, "waba_id": waba_id, "results": results}


@router.get("/api/flow/template-status")
async def get_template_status(
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Template'lerin Meta onay durumlarını döner."""
    settings = await store.get_flow_settings(username, brand)
    token           = settings.get("wa_token", "")
    phone_number_id = settings.get("phone_number_id", "")

    if not token or not phone_number_id:
        return {"ok": True, "statuses": {}}

    waba_id = _get_waba_id(phone_number_id, token)
    if not waba_id:
        return {"ok": False, "error": "WABA ID alınamadı"}

    names = [t["name"] for t in _DEFAULT_TEMPLATES]
    statuses = _get_template_statuses(waba_id, token, names)
    return {"ok": True, "waba_id": waba_id, "statuses": statuses}
