"""WhatsApp Cloud API — template mesaj gönderici."""

import logging

import httpx

logger = logging.getLogger(__name__)

WA_API = "https://graph.facebook.com/v19.0"

# Onaylı WhatsApp şablon adı ve dili
WA_TEMPLATE_NAME = "sepet_hatirlatma"
WA_TEMPLATE_LANG = "tr"


async def send_wa_template(
    token: str,
    phone_number_id: str,
    to: str,
    name: str = "",
    product: str = "",
) -> dict:
    """
    WhatsApp Cloud API üzerinden onaylı template mesajı gönderir.
    Template: sepet_hatirlatma (tr)  — {{1}}=name, {{2}}=product
    to: E.164 formatında numara (+905xxxxxxxxx)
    """
    if not token or not phone_number_id or not to:
        return {"ok": False, "error": "missing_credentials"}

    url = f"{WA_API}/{phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": {
            "name": WA_TEMPLATE_NAME,
            "language": {"code": WA_TEMPLATE_LANG},
            "components": [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": name or "Değerli müşterimiz"},
                        {"type": "text", "text": product or "ürün"},
                    ],
                }
            ],
        },
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, headers=headers, json=payload)
        data = r.json()
        if r.status_code == 200 and data.get("messages"):
            msg_id = data["messages"][0].get("id", "")
            logger.info("[WA] Template gönderildi %s → %s", to, msg_id)
            return {"ok": True, "message_id": msg_id}
        error = data.get("error", {}).get("message", r.text[:200])
        logger.warning("[WA] Gönderim hatası %s: %s", to, error)
        return {"ok": False, "error": error}
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
