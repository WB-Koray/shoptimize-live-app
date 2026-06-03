"""
Flow (Otomasyon) API — WhatsApp terk edilmiş ödeme bildirimleri.
Sequence ayarları, log görüntüleme, test gönderimi, opt-out yönetimi.
"""

import logging
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from services.auth import get_current_user
from services.redis_store import store
from services.wa_sender import send_wa_template

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
