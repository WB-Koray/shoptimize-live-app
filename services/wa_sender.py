"""WhatsApp Cloud API — basit metin mesajı gönderici."""

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

WA_API = "https://graph.facebook.com/v19.0"


async def send_wa_text(
    token: str,
    phone_number_id: str,
    to: str,
    body: str,
) -> dict:
    """
    WhatsApp Cloud API üzerinden metin mesajı gönderir.
    to: E.164 formatında numara (+905xxxxxxxxx)
    Başarı: {"ok": True, "message_id": "..."}
    Hata:   {"ok": False, "error": "..."}
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
        "type": "text",
        "text": {"body": body, "preview_url": False},
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, headers=headers, json=payload)
        data = r.json()
        if r.status_code == 200 and data.get("messages"):
            msg_id = data["messages"][0].get("id", "")
            logger.info("[WA] Mesaj gönderildi %s → %s", to, msg_id)
            return {"ok": True, "message_id": msg_id}
        error = data.get("error", {}).get("message", r.text[:200])
        logger.warning("[WA] Gönderim hatası %s: %s", to, error)
        return {"ok": False, "error": error}
    except Exception as e:
        logger.error("[WA] İstek hatası: %s", e)
        return {"ok": False, "error": str(e)}


def render_template(template: str, name: str = "", product: str = "", phone: str = "") -> str:
    """Mesaj şablonundaki değişkenleri doldurur."""
    return (
        template
        .replace("{name}", name or "Değerli müşterimiz")
        .replace("{product}", product or "ürün")
        .replace("{phone}", phone or "")
        .strip()
    )
