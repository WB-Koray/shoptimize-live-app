"""
Flow (Otomasyon) API — WhatsApp terk edilmiş ödeme bildirimleri.
Ayar kaydetme, log görüntüleme ve test gönderimi.
"""

import time
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from services.auth import get_current_user
from services.redis_store import store
from services.wa_sender import send_wa_text, render_template

router = APIRouter()

_DEFAULT_TEMPLATE = (
    "Merhaba {name}! 👋 Sepetinizde {product} bekleniyor. "
    "Siparişinizi tamamlamak için mağazamızı ziyaret edebilirsiniz."
)


@router.get("/api/flow/settings")
async def get_flow_settings(
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    settings = await store.get_flow_settings(username, brand)
    # Token'ı maskele
    if settings.get("wa_token"):
        settings["wa_token_masked"] = "•" * 8 + settings["wa_token"][-4:]
        settings["wa_token"] = ""
    return {"ok": True, "settings": settings}


@router.post("/api/flow/settings")
async def save_flow_settings(
    request_data: dict,
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    existing = await store.get_flow_settings(username, brand)

    # Token boş gelirse mevcut token'ı koru
    wa_token = request_data.get("wa_token", "").strip()
    if not wa_token and existing.get("wa_token"):
        wa_token = existing["wa_token"]

    settings = {
        "enabled":          bool(request_data.get("enabled", False)),
        "wa_token":         wa_token,
        "phone_number_id":  str(request_data.get("phone_number_id", "")).strip(),
        "delay_minutes":    max(5, min(120, int(request_data.get("delay_minutes", 15)))),
        "message_template": str(request_data.get("message_template", _DEFAULT_TEMPLATE)).strip() or _DEFAULT_TEMPLATE,
    }

    await store.save_flow_settings(username, brand, settings)
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

    # E.164 normalizasyonu
    digits = "".join(c for c in to_phone if c.isdigit())
    if digits.startswith("0"):
        to_phone = f"+9{digits}"
    elif not to_phone.startswith("+"):
        to_phone = f"+{digits}"

    template = settings.get("message_template", _DEFAULT_TEMPLATE)
    message = render_template(template, name="Test Kullanıcı", product="Test Ürün")

    result = await send_wa_text(
        settings["wa_token"],
        settings["phone_number_id"],
        to_phone,
        message,
    )
    return result


@router.get("/api/flow/logs")
async def get_flow_logs(
    username: str = Query(""),
    brand: str = Query("default"),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    logs = await store.get_flow_logs(username, brand, limit=min(limit, 200))
    return {"ok": True, "logs": logs}


@router.delete("/api/flow/logs")
async def clear_flow_logs(
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    await store.clear_flow_logs(username, brand)
    return {"ok": True}
