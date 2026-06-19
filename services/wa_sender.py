"""WhatsApp Cloud API — template mesaj gönderici."""

import logging

import httpx

logger = logging.getLogger(__name__)

WA_API = "https://graph.facebook.com/v21.0"

WA_TEMPLATE_NAME = "sepet_hatirlatma"
WA_TEMPLATE_LANG = "tr"

# Opt-out tetikleyen anahtar kelimeler (küçük harf)
OPTOUT_KEYWORDS = {"dur", "stop", "iptal", "istemiyorum", "çıkış", "cikis", "unsubscribe", "hayır", "hayir"}

# Opt-in (yeniden abone) anahtar kelimeleri
OPTIN_KEYWORDS  = {"başlat", "baslat", "start", "başla", "başla", "evet", "abone ol", "bildirim"}


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


# Sepet şablonlarının body değişken sayısı (Meta'da onaylı içerikle birebir):
#   sepet_hatirlatma   : {{1}} ad + {{2}} ürün  → 2
#   sepet_hatirlatma_2 : sadece {{1}} ad         → 1  (yanlış sayıda param = #132000)
#   sepet_hatirlatma_3 : {{1}} ad + {{2}} ürün  → 2
_CART_PARAM_COUNT = {
    "sepet_hatirlatma": 2,
    "sepet_hatirlatma_2": 1,
    "sepet_hatirlatma_3": 2,
}


def _build_params(template_name: str, name: str = "", product: str = "", order_number: str = "", products: list | None = None) -> list:
    """Her şablon için doğru body parametrelerini döner."""
    if template_name in _CART_PARAM_COUNT:
        full = [
            {"type": "text", "text": name or "Değerli müşterimiz"},
            {"type": "text", "text": _build_product_text(product, products)},
        ]
        return full[:_CART_PARAM_COUNT[template_name]]
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
    # dashboard_erisim / panel_access: link URL button component'ında —
    # _build_components() tarafından ayrıca işlenir, buradan [] döner.
    # Bilinmeyen şablonlar için parametresiz gönder
    return []


def _build_components(
    template_name: str,
    name: str = "",
    product: str = "",
    order_number: str = "",
    products: list | None = None,
) -> list:
    """Template için tam components listesini oluşturur."""
    if template_name in ("dashboard_erisim", "panel_access"):
        # Body'de named variable {{link}} — Meta yeni UI ile oluşturulmuş şablonlar
        # parameter_name alanı zorunlu (positional {{1}} değil)
        return [
            {
                "type": "body",
                "parameters": [
                    {"type": "text", "parameter_name": "link", "text": name or ""},
                ],
            }
        ]
    body_params = _build_params(
        template_name, name=name, product=product,
        order_number=order_number, products=products,
    )
    return [{"type": "body", "parameters": body_params}] if body_params else []


async def _send_optout_confirmation(token_phone: str, to_phone: str,
                                    language: str = "tr", owner=None) -> None:
    """Opt-out onay mesajı gönderir (UTILITY şablonu).
    owner: (username, brand) tuple — verilirse Redis lookup atlanır.
    NOT: Bu fonksiyon opt-out listesine eklemeden ÖNCE çağrılmalı,
         aksi halde send_wa_template is_optout kontrolünde bloklanır."""
    try:
        from services.redis_store import store
        if owner is None:
            owner = await store.find_merchant_by_phone_id(token_phone)
        if not owner:
            logger.warning("[WA] Opt-out onay: merchant bulunamadı phone_id=%s", token_phone[-6:])
            return
        username, brand = owner
        settings = await store.get_flow_settings(username, brand)
        wa_token = settings.get("wa_token", "")
        if not wa_token:
            logger.warning("[WA] Opt-out onay: wa_token yok (merchant=%s)", username)
            return
        result = await send_wa_template(
            wa_token, token_phone, to_phone,
            template_name="optout_onay",
            language=language,
            username=username, brand=brand,
        )
        if result.get("ok"):
            logger.info("[WA] Opt-out onay mesajı gönderildi: %s", to_phone[-4:])
        else:
            logger.warning("[WA] Opt-out onay gönderilemedi: %s", result.get("error"))
    except Exception as e:
        logger.warning("[WA] Opt-out onay exception: %s", e)


async def handle_incoming_message(token_phone: str, from_phone: str, body: str) -> bool:
    """Gelen WA mesajını işler. Opt-out → onay mesajı gönderir. Opt-in → listeden çıkarır."""
    from services.redis_store import store
    clean = body.strip().lower()

    # Opt-out
    for kw in OPTOUT_KEYWORDS:
        if kw in clean:
            owner = await store.find_merchant_by_phone_id(token_phone)
            # Önce onay mesajı gönder (opt-out listesine EKLENMEDEN önce,
            # aksi halde send_wa_template is_optout kontrolünde bloklanır)
            await _send_optout_confirmation(token_phone, from_phone, owner=owner)
            # Sonra opt-out listesine ekle
            if owner:
                username, brand = owner
                await store.add_optout(from_phone, username, brand)
                logger.info("[WA] Opt-out kaydedildi (merchant=%s): %s", username, from_phone[-4:])
            else:
                await store.add_optout(from_phone)
                logger.info("[WA] Opt-out kaydedildi (global): %s", from_phone[-4:])
            return True

    # Opt-in (yeniden abone)
    for kw in OPTIN_KEYWORDS:
        if kw in clean:
            owner = await store.find_merchant_by_phone_id(token_phone)
            if owner:
                username, brand = owner
                await store.remove_optout(from_phone, username, brand)
                logger.info("[WA] Opt-in: listeden çıkarıldı (merchant=%s): %s", username, from_phone[-4:])
                # Opt-in onay mesajı
                try:
                    settings = await store.get_flow_settings(username, brand)
                    wa_token = settings.get("wa_token", "")
                    if wa_token:
                        await send_wa_template(
                            wa_token, token_phone, from_phone,
                            template_name="optin_onay",
                            language="tr",
                            username=username, brand=brand,
                        )
                except Exception as e:
                    logger.warning("[WA] Opt-in onay gönderilemedi: %s", e)
            return False  # Opt-in mesajı opt-out değil

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
    username: str = "",
    brand: str = "default",
    header_image_url: str = "",
    body_text_params: list | None = None,
) -> dict:
    """
    WhatsApp Cloud API üzerinden onaylı template mesajı gönderir.
    to: E.164 formatında numara (+905xxxxxxxxx)
    template_name: onaylı şablon adı (varsayılan: sepet_hatirlatma)

    Kampanya modu (header_image_url veya body_text_params verilirse):
      - header_image_url: IMAGE header'a geçilecek public görsel linki
      - body_text_params: body değişkenleri ({{1}}, {{2}}, ...) için sıralı metin listesi
    """
    if not token or not phone_number_id or not to:
        return {"ok": False, "error": "missing_credentials"}

    from services.redis_store import store
    if await store.is_optout(to, username, brand):
        logger.info("[WA] Opt-out listesinde — gönderilmedi: %s", to[-4:])
        return {"ok": False, "error": "opted_out", "opted_out": True}

    url = f"{WA_API}/{phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    # Kampanya modu: görsel header + serbest body parametreleri
    if header_image_url or body_text_params is not None:
        components = []
        if header_image_url:
            components.append({
                "type": "header",
                "parameters": [{"type": "image", "image": {"link": header_image_url}}],
            })
        if body_text_params:
            components.append({
                "type": "body",
                "parameters": [{"type": "text", "text": str(p)} for p in body_text_params],
            })
    else:
        # Şablona göre component listesini oluştur (body veya button)
        components = _build_components(
            template_name, name=name, product=product,
            order_number=order_number, products=products,
        )

    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": language or WA_TEMPLATE_LANG},
            "components": components,
        },
    }

    logger.info("[WA] Gönderiliyor → tpl=%s lang=%s to=%s phone_id=%s components=%s",
                template_name, language, to[-4:],
                phone_number_id[-6:] if phone_number_id else "?",
                components)
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
        # Meta'nın spesifik açıklaması — hangi parametre/component sorunlu (header mı body mi)
        err_details = (err_obj.get("error_data") or {}).get("details", "")
        error_full = f"{error}" + (f" — {err_details}" if err_details else "")
        logger.warning("[WA] Gönderim hatası %s (#%s/%s): %s | details=%s | url=%s tpl=%s lang=%s | full_resp=%s",
                       to, err_code, err_sub, error, err_details, url, template_name, language, r.text[:1000])
        return {"ok": False, "error": error_full, "code": err_code, "details": err_details}
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
