"""WhatsApp Cloud API — template mesaj gönderici."""

import logging

import httpx

logger = logging.getLogger(__name__)

WA_API = "https://graph.facebook.com/v21.0"

WA_TEMPLATE_NAME = "sepet_hatirlatma"
WA_TEMPLATE_LANG = "tr"

# Opt-out tetikleyen anahtar kelimeler (küçük harf)
OPTOUT_KEYWORDS = {"dur", "stop", "iptal", "istemiyorum", "çıkış", "cikis", "unsubscribe", "hayır", "hayir"}


def _build_product_text(product: str, products: list | None) -> str:
    """Ürün listesini {{2}} parametresi için tek string'e dönüştürür."""
    if not products or len(products) <= 1:
        return product or "ürün"
    titles = [p.get("title", "") for p in products if p.get("title")]
    if not titles:
        return product or "ürün"
    if len(titles) == 2:
        return f"{titles[0]} ve {titles[1]}"
    if len(titles) >= 3:
        return f"{titles[0]}, {titles[1]} ve {len(titles) - 2} ürün daha"
    return titles[0]


def _build_params(template_name: str, name: str = "", product: str = "", order_number: str = "", products: list | None = None) -> list:
    """Her şablon için doğru body parametrelerini döner."""
    if template_name in ("sepet_hatirlatma", "sepet_hatirlatma_2", "sepet_hatirlatma_3"):
        return [
            {"type": "text", "text": name or "Değerli müşterimiz"},
            {"type": "text", "text": _build_product_text(product, products)},
        ]
    if template_name == "siparis_onay":
        return [
            {"type": "text", "text": name or "Değerli müşterimiz"},
            {"type": "text", "text": order_number or "-"},
        ]
    if template_name == "shoptimize_kurulum":
        # Template: Merhaba {{isim}}, ... Mağaza: {{magaza}} ... {{link}}
        # Named vars → positional array: [isim, magaza, link]
        return [
            {"type": "text", "text": name or "Değerli üye"},   # {{isim}}
            {"type": "text", "text": product or ""},            # {{magaza}}
            {"type": "text", "text": order_number or ""},       # {{link}}
        ]
    if template_name in ("dashboard_erisim", "panel_access"):
        # TR: dashboard_erisim  |  EN: panel_access
        # Her ikisinde de tek değişken: {{link}} = erişim URL'i
        return [
            {"type": "text", "text": name or ""},              # {{link}}
        ]
    # Bilinmeyen şablonlar için parametresiz gönder
    return []


async def handle_incoming_message(token_phone: str, from_phone: str, body: str) -> bool:
    """Gelen WA mesajını işler. Opt-out ise True döner."""
    clean = body.strip().lower()
    for kw in OPTOUT_KEYWORDS:
        if kw in clean:
            from services.redis_store import store
            await store.add_optout(from_phone)
            logger.info("[WA] Opt-out kaydedildi: %s", from_phone[-4:])
            return True
    return False


async def send_wa_template(
    token: str,
    phone_number_id: str,
    to: str,
    name: str = "",
    product: str = "",
    template_name: str = WA_TEMPLATE_NAME,
    order_number: str = "",
    language: str = WA_TEMPLATE_LANG,
    products: list | None = None,
) -> dict:
    """
    WhatsApp Cloud API üzerinden onaylı template mesajı gönderir.
    to: E.164 formatında numara (+905xxxxxxxxx)
    template_name: onaylı şablon adı (varsayılan: sepet_hatirlatma)
    """
    if not token or not phone_number_id or not to:
        return {"ok": False, "error": "missing_credentials"}

    from services.redis_store import store
    if await store.is_optout(to):
        logger.info("[WA] Opt-out listesinde — gönderilmedi: %s", to[-4:])
        return {"ok": False, "error": "opted_out", "opted_out": True}

    url = f"{WA_API}/{phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    # Şablona göre body parametrelerini oluştur
    body_params = _build_params(template_name, name=name, product=product, order_number=order_number, products=products)

    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": language or WA_TEMPLATE_LANG},
            "components": [{"type": "body", "parameters": body_params}] if body_params else [],
        },
    }

    logger.debug("[WA] Gönderiliyor → url=%s tpl=%s lang=%s to=%s phone_id=%s",
                 url, template_name, language, to[-4:], phone_number_id[-6:] if phone_number_id else "?")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, headers=headers, json=payload)
        data = r.json()
        if r.status_code == 200 and data.get("messages"):
            msg_id = data["messages"][0].get("id", "")
            logger.info("[WA] Template gönderildi [%s] %s → %s", template_name, to[-4:], msg_id)
            return {"ok": True, "message_id": msg_id}
        err_obj = data.get("error", {})
        error = err_obj.get("message", r.text[:300])
        err_code = err_obj.get("code", r.status_code)
        err_sub = err_obj.get("error_subcode", "")
        logger.warning("[WA] Gönderim hatası %s (#%s/%s): %s | url=%s tpl=%s lang=%s",
                       to, err_code, err_sub, error, url, template_name, language)
        return {"ok": False, "error": error, "code": err_code}
    except Exception as e:
        logger.error("[WA] İstek hatası: %s", e)
        return {"ok": False, "error": str(e)}


# Geriye dönük uyumluluk — main.py worker ve flow.py test endpoint'i bu ismi çağırıyor
async def send_wa_text(
    token: str,
    phone_number_id: str,
    to: str,
    body: str,  # artık kullanılmıyor, template gönderiliyor
) -> dict:
    name = ""
    product = ""
    # body'den {name} / {product} değerlerini geri çıkarmaya gerek yok;
    # çağıran yer zaten co["name"] / co["product"] biliyor — template direkt kullanılıyor
    return await send_wa_template(token, phone_number_id, to, name, product)


def render_template(template: str, name: str = "", product: str = "", phone: str = "") -> str:
    """Artık sadece log/fallback için — asıl gönderim template API ile yapılıyor."""
    return (
        template
        .replace("{name}", name or "Değerli müşterimiz")
        .replace("{product}", product or "ürün")
        .replace("{phone}", phone or "")
        .strip()
    )
