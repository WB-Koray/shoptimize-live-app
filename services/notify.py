"""
services/notify.py
Operatöre (panel sahibine) anlık WhatsApp bildirimi — lifecycle olayları
(yeni mağaza, WA bağlandı, ödeme geldi) ve sağlık uyarıları (sorun/düzelme).

Gerekli env:
  OPERATOR_WA_TOKEN       — operatör WABA System User token (mevcut)
  OPERATOR_WA_PHONE_ID    — operatör WhatsApp gönderen numara id (mevcut)
  OPERATOR_ALERT_PHONE    — bildirimlerin gideceği KENDİ numaran (E.164, örn. +9053...)
  OPERATOR_ALERT_TEMPLATE — şablon adı (varsayılan: operator_bildirim, body: "Shoptimize bildirimi: {{1}}")
  OPERATOR_ALERT_LANG     — şablon dili (varsayılan: tr)

Şablon param kuralı gereği {{1}} metni TEK SATIR olmalı (newline yasak) → ayraç olarak ' · ' kullan.
"""

import logging
import os

from services.redis_store import store
from services.wa_sender import send_wa_template

logger = logging.getLogger(__name__)

OPERATOR_WA_TOKEN       = os.getenv("OPERATOR_WA_TOKEN", "")
OPERATOR_WA_PHONE_ID    = os.getenv("OPERATOR_WA_PHONE_ID", "")
OPERATOR_ALERT_PHONE    = os.getenv("OPERATOR_ALERT_PHONE", "")
OPERATOR_ALERT_TEMPLATE = os.getenv("OPERATOR_ALERT_TEMPLATE", "operator_bildirim")
OPERATOR_ALERT_LANG     = os.getenv("OPERATOR_ALERT_LANG", "tr")


def is_configured() -> bool:
    return bool(OPERATOR_WA_TOKEN and OPERATOR_WA_PHONE_ID and OPERATOR_ALERT_PHONE)


async def notify_operator(text: str, dedupe_key: str = "", cooldown_sec: int = 0) -> bool:
    """Operatöre tek satırlık WhatsApp bildirimi gönderir.
    dedupe_key + cooldown_sec verilirse, o pencerede aynı olay tekrar gönderilmez."""
    if not is_configured():
        logger.info("[NOTIFY] atlandı (env eksik): %s", text[:80])
        return False

    # Newline param hatasını önle (tek satıra indir)
    clean = " · ".join(p.strip() for p in str(text).replace("\n", " · ").split(" · ") if p.strip())

    if dedupe_key and cooldown_sec > 0:
        try:
            if not await store.once(f"opnotify:{dedupe_key}", cooldown_sec):
                return False
        except Exception:
            pass

    try:
        res = await send_wa_template(
            OPERATOR_WA_TOKEN, OPERATOR_WA_PHONE_ID, OPERATOR_ALERT_PHONE,
            name=clean, template_name=OPERATOR_ALERT_TEMPLATE, language=OPERATOR_ALERT_LANG,
        )
        if res.get("ok"):
            logger.info("[NOTIFY] ✓ operatör bildirimi: %s", clean[:80])
            return True
        logger.warning("[NOTIFY] ✗ bildirim gönderilemedi (%s): %s", res.get("error"), clean[:80])
    except Exception as e:
        logger.warning("[NOTIFY] istisna: %s", e)
    return False
