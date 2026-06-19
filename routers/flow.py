"""
Flow (Otomasyon) API — WhatsApp terk edilmiş ödeme bildirimleri.
Sequence ayarları, log görüntüleme, test gönderimi, opt-out yönetimi.
"""

import logging
import os
import requests as _requests
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from services.auth import get_current_user
from services.redis_store import store
from services.wa_sender import send_wa_template

META_GRAPH = "https://graph.facebook.com/v19.0"

# WhatsApp Embedded Signup — bizim Meta app'imizin kimlik bilgileri (code→token exchange için)
META_APP_ID     = os.getenv("META_APP_ID", "")
META_APP_SECRET = os.getenv("META_APP_SECRET", "")

# Varsayılan şablon tanımları — merchant düzenleyebilir
_DEFAULT_TEMPLATES = [
    {
        "name": "sepet_hatirlatma",
        "category": "MARKETING",
        "header_tr": "Sepetinde bekleyen ürün var!",
        "header_en": "You have items waiting in your cart!",
        "body_tr": "Merhaba {{1}}! 😍\nSepetinde {{2}}, seni bekliyor.\nSiparişini tamamlamak için sepeti ziyaret edebilirsin. 🛒",
        "body_en": "Hi {{1}}! 😍\n{{2}} is waiting in your cart.\nVisit your cart to complete your order. 🛒",
        "button_text": "Sepete git",
        "button_url": "https://yourdomain.com/cart",
    },
    {
        "name": "sepet_hatirlatma_2",
        "category": "MARKETING",
        "header_tr": "Sepetini unuttun mu?",
        "header_en": "Did you forget your cart?",
        "body_tr": "{{1}}, sepetindeki ürünler hâlâ duruyor.\nStoklar sınırlı olabilir, geç kalma!",
        "body_en": "{{1}}, the items in your cart are still there.\nStocks may be limited, don't wait!",
        "button_text": "Sepete git",
        "button_url": "https://yourdomain.com/cart",
    },
    {
        "name": "sepet_hatirlatma_3",
        "category": "MARKETING",
        "header_tr": "Son hatırlatma!",
        "header_en": "Last reminder!",
        "body_tr": "{{1}}, sepetindeki {{2}} için son şansın!\nHemen tamamla.",
        "body_en": "{{1}}, last chance for {{2}} in your cart!\nComplete it now.",
        "button_text": "Sepete git",
        "button_url": "https://yourdomain.com/cart",
    },
    {
        "name": "siparis_onay",
        "category": "UTILITY",
        "header_tr": "",
        "header_en": "",
        "body_tr": "Teşekkürler {{1}}! 📦\n{{2}} siparişiniz alındı ve hazırlanıyor.",
        "body_en": "Thank you {{1}}! 📦\nYour order for {{2}} has been received and is being prepared.",
        "button_text": "",
        "button_url": "",
    },
    {
        "name": "optout_onay",
        "category": "UTILITY",
        "header_tr": "",
        "header_en": "",
        "body_tr": "Talebiniz alındı. Bildirim gönderme servisimiz sizin için devre dışı bırakıldı. Tekrar almak isterseniz 'BAŞLAT' yazabilirsiniz.",
        "body_en": "Your request has been received. Our notification service has been disabled for you. Reply 'START' anytime to re-enable it.",
        "button_text": "",
        "button_url": "",
    },
    {
        "name": "optin_onay",
        "category": "UTILITY",
        "header_tr": "",
        "header_en": "",
        "body_tr": "Tekrar hoş geldiniz! 🎉 Bildirim servisimiz yeniden aktif edildi.",
        "body_en": "Welcome back! 🎉 Our notification service has been re-enabled for you.",
        "button_text": "",
        "button_url": "",
    },
]


def _get_waba_id(phone_number_id: str, token: str) -> str | None:
    """Phone Number ID'den WhatsApp Business Account ID'yi alır."""
    # Yöntem 1: Phone Number ID üzerinden
    try:
        r = _requests.get(
            f"{META_GRAPH}/{phone_number_id}",
            params={"fields": "whatsapp_business_account", "access_token": token},
            timeout=10,
        )
        data = r.json()
        logger.info("[WA Templates] WABA lookup v1 status=%d body=%s", r.status_code, str(data)[:300])
        waba_id = data.get("whatsapp_business_account", {}).get("id")
        if waba_id:
            return waba_id
    except Exception as e:
        logger.warning("[WA Templates] WABA lookup v1 hata: %s", e)

    # Yöntem 2: Token'a bağlı business account'ları listele
    try:
        r2 = _requests.get(
            f"{META_GRAPH}/me/whatsapp_business_accounts",
            params={"access_token": token},
            timeout=10,
        )
        data2 = r2.json()
        logger.info("[WA Templates] WABA lookup v2 status=%d body=%s", r2.status_code, str(data2)[:300])
        accounts = data2.get("data", [])
        if accounts:
            return accounts[0].get("id")
    except Exception as e:
        logger.warning("[WA Templates] WABA lookup v2 hata: %s", e)

    return None


def _body_text_example(text: str) -> list | None:
    """Body'deki {{1}},{{2}}... değişkenleri için Meta'nın zorunlu kıldığı örnek
    değerleri üretir. Değişken yoksa None döner."""
    import re
    nums = [int(n) for n in re.findall(r"\{\{\s*(\d+)\s*\}\}", text or "")]
    if not nums:
        return None
    count = max(nums)
    samples = ["Ayşe", "Kırmızı Elbise", "ABC123", "10", "örnek"]
    vals = [samples[i] if i < len(samples) else "örnek" for i in range(count)]
    return [vals]   # Meta formatı: [[v1, v2, ...]]


def _clean_header(text: str) -> str:
    """WhatsApp başlığı (HEADER TEXT) emoji/yeni satır/biçimlendirme karakteri kabul
    etmez (Meta subcode 2388072). Bunları ayıklar, Türkçe harfleri korur."""
    import re, unicodedata
    if not text:
        return text
    text = re.sub(r"[\r\n\t]+", " ", text)
    for ch in "*_~`":
        text = text.replace(ch, "")
    out = []
    for ch in text:
        if ch in ("‍", "️"):          # ZWJ / variation selector
            continue
        if unicodedata.category(ch) in ("So", "Sk", "Cs", "Cf"):  # sembol/emoji
            continue
        out.append(ch)
    return re.sub(r"\s{2,}", " ", "".join(out)).strip()


def _create_template(waba_id: str, token: str, name: str, body: str, language: str,
                     category: str = "MARKETING", header: str = "", button_text: str = "", button_url: str = "") -> dict:
    """Tek bir WhatsApp template oluşturur ve Meta'ya onaya gönderir."""
    components = []
    header = _clean_header(header)
    if header:
        header_comp = {"type": "HEADER", "format": "TEXT", "text": header}
        hex_ex = _body_text_example(header)
        if hex_ex:
            header_comp["example"] = {"header_text": hex_ex[0]}
        components.append(header_comp)
    body_comp = {"type": "BODY", "text": body}
    body_ex = _body_text_example(body)
    if body_ex:
        body_comp["example"] = {"body_text": body_ex}   # Meta: değişkenli body'de zorunlu
    components.append(body_comp)
    if button_text and button_url:
        components.append({
            "type": "BUTTONS",
            "buttons": [{"type": "URL", "text": button_text, "url": button_url}]
        })
    payload = {
        "name": name,
        "language": language,
        "category": category,
        "components": components,
    }
    r = _requests.post(
        f"{META_GRAPH}/{waba_id}/message_templates",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    data = r.json()
    if r.status_code != 200:
        err = data.get("error", {})
        subcode = err.get("error_subcode")
        # 2388024 = şablon bu dilde zaten var → başarı gibi davran
        if subcode == 2388024:
            logger.info("[WA Templates] Zaten mevcut: name=%s lang=%s", name, language)
            return {"status": "ALREADY_EXISTS", "id": ""}
        logger.warning("[WA Templates] Meta hata: name=%s lang=%s status=%d body=%s",
                       name, language, r.status_code, str(data)[:300])
    return data


def _get_template_statuses(waba_id: str, token: str, names: list[str]) -> dict:
    """Template'lerin onay durumlarını döner: {name_lang: status}"""
    result = {}
    try:
        r = _requests.get(
            f"{META_GRAPH}/{waba_id}/message_templates",
            params={"fields": "name,language,status", "limit": 200, "access_token": token},
            timeout=10,
        )
        for tpl in r.json().get("data", []):
            key = f"{tpl['name']}_{tpl['language']}"
            result[key] = tpl.get("status", "UNKNOWN")
    except Exception as e:
        logger.warning("[WA Templates] Durum alınamadı: %s", e)
    return result


def _get_template_details(waba_id: str, token: str) -> list[dict]:
    """Meta'dan tüm template'lerin tam içeriğini (components) çeker."""
    try:
        r = _requests.get(
            f"{META_GRAPH}/{waba_id}/message_templates",
            params={"fields": "name,language,status,components,category", "limit": 200, "access_token": token},
            timeout=10,
        )
        data = r.json().get("data", [])
        result = []
        for tpl in data:
            body_text = ""
            header_text = ""
            buttons = []
            for comp in tpl.get("components", []):
                ctype = comp.get("type", "").upper()
                if ctype == "BODY":
                    body_text = comp.get("text", "")
                elif ctype == "HEADER" and comp.get("format") == "TEXT":
                    header_text = comp.get("text", "")
                elif ctype == "BUTTONS":
                    buttons = [{"type": b.get("type"), "text": b.get("text"), "url": b.get("url", "")}
                               for b in comp.get("buttons", [])]
            result.append({
                "name":     tpl.get("name"),
                "language": tpl.get("language"),
                "status":   tpl.get("status", "UNKNOWN"),
                "category": tpl.get("category", "MARKETING"),
                "header":   header_text,
                "body":     body_text,
                "buttons":  buttons,
            })
        return result
    except Exception as e:
        logger.warning("[WA Templates] İçerik alınamadı: %s", e)
        return []

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
    # Her açılışta phone_id → merchant mapping'ini yenile (opt-out routing için)
    phone_number_id = settings.get("phone_number_id", "")
    if phone_number_id:
        await store.set_merchant_phone_id(phone_number_id, username, brand)
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
        "waba_id":           str(request_data.get("waba_id", "")).strip(),
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

    # WABA'yı uygulamanın webhook'una abone et — gelen opt-out ("dur") ve teslim/okundu
    # bildirimleri ancak böyle /api/wa/webhook'a düşer. Manuel "Kaydet" yolu da
    # Quick Connect gibi abone etsin (idempotent). Geçersiz token'da Meta hata döndürür.
    subscribed = None
    if settings.get("wa_token") and settings.get("waba_id"):
        try:
            sub = _requests.post(f"{META_GRAPH}/{settings['waba_id']}/subscribed_apps",
                                 params={"access_token": settings["wa_token"]}, timeout=12)
            sub_body = sub.json() if sub.content else {}
            subscribed = bool(sub_body.get("success")) or sub.status_code == 200
            logger.info("[FLOW-SETTINGS] subscribed_apps status=%s body=%s",
                        sub.status_code, str(sub_body)[:200])
        except Exception as e:
            logger.warning("[FLOW-SETTINGS] subscribed_apps hatası: %s", e)
    return {"ok": True, "subscribed": subscribed}


@router.post("/api/flow/wa-connect")
async def wa_connect(
    request_data: dict,
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """
    Quick connect: merchant SADECE token yapıştırır → WABA ID + Phone Number ID
    Meta API'sinden otomatik bulunur ve kaydedilir. 3 teknik alan yerine 1.
    """
    token = str(request_data.get("token", "")).strip()
    if not token:
        return JSONResponse({"ok": False, "error": "token_required",
                             "message": "WhatsApp token gerekli."}, status_code=400)

    # 1. Token'dan WABA ID'yi bul (debug_token → granular_scopes → target_ids)
    waba_id = ""
    scopes_seen = []
    meta_detail = ""
    try:
        r = _requests.get(f"{META_GRAPH}/debug_token",
                          params={"input_token": token, "access_token": token}, timeout=12)
        body = r.json() or {}
        data = body.get("data", {}) or {}
        # Meta hata döndürdüyse (geçersiz/expired token vb.) yakala
        if body.get("error"):
            meta_detail = str(body["error"].get("message", body["error"]))
            logger.warning("[WA-CONNECT] debug_token Meta hatası: %s", meta_detail)
        for gs in data.get("granular_scopes", []) or []:
            scopes_seen.append(gs.get("scope"))
            if gs.get("scope") in ("whatsapp_business_management", "whatsapp_business_messaging"):
                tids = gs.get("target_ids") or []
                if tids:
                    waba_id = str(tids[0])
                    break
        logger.info("[WA-CONNECT] debug_token status=%s scopes=%s waba=%s",
                    r.status_code, scopes_seen, waba_id or "—")
    except Exception as e:
        meta_detail = str(e)
        logger.warning("[WA-CONNECT] debug_token istisna: %s", e)
    if not waba_id:
        # Sebep ayrımı: scope var ama target_ids boş mu, yoksa scope hiç yok mu?
        has_wa_scope = any(s in ("whatsapp_business_management", "whatsapp_business_messaging")
                           for s in scopes_seen)
        if has_wa_scope:
            msg = ("Token WhatsApp iznine sahip ama bağlı bir WhatsApp Business hesabı "
                   "(WABA) bulunamadı. Token'ı oluştururken doğru WhatsApp Business "
                   "hesabını/uygulamasını seçtiğinizden emin olun.")
        else:
            msg = ("Token'da WhatsApp Business hesabı bulunamadı. Token'ı "
                   "whatsapp_business_management ve whatsapp_business_messaging "
                   "izinleriyle oluşturduğunuzdan emin olun.")
        logger.warning("[WA-CONNECT] waba_not_found %s:%s scopes=%s detail=%s",
                       username, brand, scopes_seen, meta_detail)
        return JSONResponse({"ok": False, "error": "waba_not_found",
            "message": msg, "detail": meta_detail, "scopes": scopes_seen}, status_code=400)

    # 2. WABA'dan telefon numarasını ve ID'sini bul
    phone_number_id = ""
    phone_display = ""
    phone_detail = ""
    try:
        r = _requests.get(f"{META_GRAPH}/{waba_id}/phone_numbers",
                          params={"access_token": token,
                                  "fields": "id,display_phone_number,verified_name"}, timeout=12)
        body = r.json() or {}
        if body.get("error"):
            phone_detail = str(body["error"].get("message", body["error"]))
            logger.warning("[WA-CONNECT] phone_numbers Meta hatası: %s", phone_detail)
        nums = body.get("data", []) or []
        if nums:
            phone_number_id = str(nums[0].get("id", ""))
            phone_display = nums[0].get("display_phone_number", "") or nums[0].get("verified_name", "")
        logger.info("[WA-CONNECT] phone_numbers status=%s count=%s", r.status_code, len(nums))
    except Exception as e:
        phone_detail = str(e)
        logger.warning("[WA-CONNECT] phone_numbers istisna: %s", e)
    if not phone_number_id:
        logger.warning("[WA-CONNECT] phone_not_found %s:%s waba=%s detail=%s",
                       username, brand, waba_id, phone_detail)
        return JSONResponse({"ok": False, "error": "phone_not_found",
            "message": "Bu WhatsApp Business hesabında telefon numarası bulunamadı. "
                       "Önce Meta'da numara ekleyin, sonra tekrar deneyin.",
            "detail": phone_detail}, status_code=400)

    # 3. WABA'yı uygulamanın webhook'una abone et — gelen mesaj (opt-out "dur") ve
    #    teslim/okundu bildirimleri ancak böyle /api/wa/webhook'a düşer.
    subscribed = False
    try:
        sub = _requests.post(f"{META_GRAPH}/{waba_id}/subscribed_apps",
                             params={"access_token": token}, timeout=12)
        sub_body = sub.json() if sub.content else {}
        subscribed = bool(sub_body.get("success")) or sub.status_code == 200
        logger.info("[WA-CONNECT] subscribed_apps status=%s body=%s", sub.status_code, str(sub_body)[:200])
    except Exception as e:
        logger.warning("[WA-CONNECT] subscribed_apps hatası: %s", e)

    # 4. Mevcut ayarları koruyarak bağlantı bilgilerini kaydet
    existing = await store.get_flow_settings(username, brand)
    settings = {**existing, "wa_token": token, "waba_id": waba_id, "phone_number_id": phone_number_id}
    await store.save_flow_settings(username, brand, settings)
    await store.set_merchant_phone_id(phone_number_id, username, brand)
    logger.info("[WA-CONNECT] ✓ %s:%s → waba=%s phone_id=%s (%s) subscribed=%s",
                username, brand, waba_id, phone_number_id, phone_display, subscribed)

    return {"ok": True, "waba_id": waba_id, "phone_number_id": phone_number_id,
            "phone": phone_display, "subscribed": subscribed}


@router.post("/api/flow/wa-embedded")
async def wa_embedded_signup(
    request_data: dict,
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """
    WhatsApp Embedded Signup tamamlama: frontend'den gelen code + waba_id + phone_number_id
    ile token alır, app'i WABA webhook'larına abone eder, numarayı kaydeder ve saklar.
    Merchant hiçbir teknik veri girmez — 3 tıkla bağlanır.
    """
    code = str(request_data.get("code", "")).strip()
    waba_id = str(request_data.get("waba_id", "")).strip()
    phone_number_id = str(request_data.get("phone_number_id", "")).strip()

    if not META_APP_ID or not META_APP_SECRET:
        return JSONResponse({"ok": False, "error": "not_configured",
            "message": "Embedded Signup henüz yapılandırılmadı (META_APP_ID/SECRET)."}, status_code=400)
    if not code:
        return JSONResponse({"ok": False, "error": "code_required"}, status_code=400)

    # 1. code → uzun ömürlü access token
    token = ""
    try:
        r = _requests.get(f"{META_GRAPH}/oauth/access_token", params={
            "client_id": META_APP_ID,
            "client_secret": META_APP_SECRET,
            "code": code,
        }, timeout=15)
        token = (r.json() or {}).get("access_token", "")
        if not token:
            logger.warning("[WA-ES] token alınamadı: %s", r.text[:300])
    except Exception as e:
        logger.warning("[WA-ES] token exchange hatası: %s", e)
    if not token:
        return JSONResponse({"ok": False, "error": "token_exchange_failed",
            "message": "Meta ile bağlantı tamamlanamadı. Tekrar deneyin."}, status_code=400)

    # 2. WABA ID / Phone Number ID eksikse token'dan tamamla (debug_token + phone_numbers)
    if not waba_id:
        try:
            r = _requests.get(f"{META_GRAPH}/debug_token",
                              params={"input_token": token, "access_token": token}, timeout=10)
            data = (r.json() or {}).get("data", {})
            for gs in data.get("granular_scopes", []) or []:
                if gs.get("scope") in ("whatsapp_business_management", "whatsapp_business_messaging"):
                    tids = gs.get("target_ids") or []
                    if tids:
                        waba_id = str(tids[0]); break
        except Exception as e:
            logger.warning("[WA-ES] waba çözümleme hatası: %s", e)
    if waba_id and not phone_number_id:
        try:
            r = _requests.get(f"{META_GRAPH}/{waba_id}/phone_numbers",
                              params={"access_token": token, "fields": "id,display_phone_number"}, timeout=10)
            nums = (r.json() or {}).get("data", []) or []
            if nums:
                phone_number_id = str(nums[0].get("id", ""))
        except Exception as e:
            logger.warning("[WA-ES] phone çözümleme hatası: %s", e)
    if not waba_id or not phone_number_id:
        return JSONResponse({"ok": False, "error": "ids_not_found",
            "message": "WhatsApp hesabı/numarası bulunamadı."}, status_code=400)

    # 3. App'i WABA webhook'larına abone et (gelen mesaj + status için)
    try:
        _requests.post(f"{META_GRAPH}/{waba_id}/subscribed_apps",
                       params={"access_token": token}, timeout=10)
    except Exception as e:
        logger.warning("[WA-ES] subscribed_apps hatası (devam): %s", e)

    # 4. Numarayı Cloud API'ye kaydet (zaten kayıtlıysa hata yutulur)
    try:
        _requests.post(f"{META_GRAPH}/{phone_number_id}/register",
                       json={"messaging_product": "whatsapp", "pin": "000000"},
                       params={"access_token": token}, timeout=10)
    except Exception as e:
        logger.warning("[WA-ES] register hatası (devam): %s", e)

    # 5. Kaydet
    existing = await store.get_flow_settings(username, brand)
    settings = {**existing, "wa_token": token, "waba_id": waba_id, "phone_number_id": phone_number_id}
    await store.save_flow_settings(username, brand, settings)
    await store.set_merchant_phone_id(phone_number_id, username, brand)
    logger.info("[WA-ES] ✓ Embedded signup: %s:%s waba=%s phone_id=%s", username, brand, waba_id, phone_number_id)

    return {"ok": True, "waba_id": waba_id, "phone_number_id": phone_number_id}


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

_CUSTOMER_BY_PHONE_GQL = """
query($q: String!) {
  customers(first: 1, query: $q) {
    edges { node { firstName lastName } }
  }
}
"""


async def _resolve_name_by_phone(domain: str, token: str, phone: str) -> str:
    """Shopify'da telefonla müşteri arar, 'Ad Soyad' döner (yoksa boş)."""
    if not (domain and token and phone):
        return ""
    import asyncio
    from routers.live import _shopify_graphql
    try:
        # Shopify telefonları E.164 ("+90...") formatında saklar
        q = f"phone:{phone}"
        body = await asyncio.to_thread(_shopify_graphql, domain, token, _CUSTOMER_BY_PHONE_GQL, {"q": q})
        edges = (body.get("data", {}).get("customers", {}) or {}).get("edges", []) or []
        if edges:
            node = edges[0].get("node", {}) or {}
            return " ".join(filter(None, [node.get("firstName"), node.get("lastName")])).strip()
    except Exception as e:
        logger.warning("[OPTOUT] isim çözümleme hatası phone=***%s err=%s", phone[-4:], e)
    return ""


@router.get("/api/flow/optouts")
async def get_optouts(current_user: dict = Depends(get_current_user)):
    username = current_user.get("username", "")
    brand    = current_user.get("brand", "default")
    phones = await store.get_all_optouts(username, brand)

    # Telefon → isim çöz: önce Redis cache, yoksa Shopify'da ara (read_customers scope)
    from services.db import get_setting
    domain = get_setting(username, brand, "shopify", "shop_domain", "")
    token  = await store.get_online_token(username, brand) \
             or get_setting(username, brand, "shopify", "admin_api_token", "")

    items = []
    for phone in phones:
        name = await store.get_phone_name(phone)
        if not name and domain and token:
            name = await _resolve_name_by_phone(domain, token, phone)
            if name:
                await store.set_phone_name(phone, name)
        items.append({"phone": phone, "name": name})

    # Geriye dönük uyumluluk: phones alanını da koru
    return {"ok": True, "phones": phones, "items": items}


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
async def get_template_defaults(
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Varsayılan şablon metinlerini döner (merchant düzenleyebilir).
    button_url placeholder'ı mağazanın kendi domain'iyle değiştirilir."""
    from services.db import get_setting
    shop_domain = get_setting(username, brand, "shopify", "shop_domain", "")
    templates = _DEFAULT_TEMPLATES
    if shop_domain:
        base = shop_domain.replace("https://", "").replace("http://", "").strip().rstrip("/")
        cart_url = f"https://{base}/cart"
        import copy
        templates = copy.deepcopy(_DEFAULT_TEMPLATES)
        for tpl in templates:
            if tpl.get("button_url") == "https://yourdomain.com/cart":
                tpl["button_url"] = cart_url
    return {"ok": True, "templates": templates}


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

    waba_id = settings.get("waba_id", "").strip() or _get_waba_id(phone_number_id, token)
    if not waba_id:
        return JSONResponse({"ok": False, "error": "WABA ID bulunamadı. Settings → Connection'da WABA ID alanını doldurun."}, status_code=400)

    templates = request_data.get("templates", _DEFAULT_TEMPLATES)
    results = []

    for tpl in templates:
        name     = tpl.get("name", "")
        body_tr  = tpl.get("body_tr", "")
        body_en  = tpl.get("body_en", "")
        tpl_result = {"name": name, "tr": None, "en": None}

        category   = tpl.get("category", "MARKETING")
        header_tr  = tpl.get("header_tr", "")
        header_en  = tpl.get("header_en", "")
        btn_text   = tpl.get("button_text", "")
        btn_url    = tpl.get("button_url", "")

        if body_tr:
            res = _create_template(waba_id, token, name, body_tr, "tr", category, header_tr, btn_text, btn_url)
            status_tr = res.get("status") or res.get("error", {}).get("message") or str(res)
            tpl_id_tr = res.get("id", "")
            tpl_result["tr"] = status_tr
            logger.info("[WA Templates] %-30s TR → status=%s id=%s", name, status_tr, tpl_id_tr)

        if body_en:
            res = _create_template(waba_id, token, name, body_en, "en_US", category, header_en, btn_text, btn_url)
            status_en = res.get("status") or res.get("error", {}).get("message") or str(res)
            tpl_id_en = res.get("id", "")
            tpl_result["en"] = status_en
            logger.info("[WA Templates] %-30s EN → status=%s id=%s", name, status_en, tpl_id_en)

        results.append(tpl_result)

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

    # Merchant'ın kaydettiği WABA ID'yi önce dene, yoksa API'den çözümle
    waba_id = settings.get("waba_id", "").strip() or _get_waba_id(phone_number_id, token)
    if not waba_id:
        logger.warning("[WA Templates] WABA ID alınamadı — phone_id=%s", phone_number_id[:8] if phone_number_id else "?")
        return {"ok": True, "statuses": {}, "error": "WABA ID alınamadı — Settings'e WABA ID'yi girin"}

    names = [t["name"] for t in _DEFAULT_TEMPLATES]
    statuses = _get_template_statuses(waba_id, token, names)
    details  = _get_template_details(waba_id, token)
    logger.info("[WA Templates] Durum alındı: waba=%s count=%d details=%d", waba_id, len(statuses), len(details))
    return {"ok": True, "waba_id": waba_id, "statuses": statuses, "details": details}
