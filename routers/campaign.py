"""
routers/campaign.py — Toplu WhatsApp kampanya broadcast.

Akış:
  1. Merchant panelden MARKETING şablonu oluşturur (görsel header + {{1}} isim + {{2}} mesaj).
  2. Kampanya yazar: mesaj metni + görsel URL (Shopify CDN) + hedef kitle (tümü / RFM segment).
  3. "Şimdi gönder" veya "planla" → opt-out filtreli, batch + rate-limit'li gönderim.
  4. Stats + geçmiş tutulur. Planlı kampanyalar main.py worker'ı ile gönderilir.

Görsel hosting YOK: merchant Shopify CDN linkini yapıştırır (opsiyonel upload yedeği Redis'te).
Audience = son N günde sipariş veren müşteriler (telefonu olanlar) — WhatsApp kalite puanı için
ilgisiz herkese değil, sadece alışveriş yapmış (engaged) kitleye gönderim.
"""

import base64
import bisect
import logging
import re
import secrets
import time
from datetime import datetime, timezone

import httpx
import requests as _requests
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response

from services.auth import get_current_user
from services.db import get_setting
from services.redis_store import store
from services.wa_sender import send_wa_template

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/campaign")

META_GRAPH = "https://graph.facebook.com/v21.0"

# Kampanya gönderim batch ayarları (WhatsApp kalite puanını korumak için)
_BATCH_SIZE = 20
_BATCH_DELAY_SEC = 2.0

# Önerilen hazır kampanya şablonları (merchant panelden tek tıkla oluşturur)
CAMPAIGN_PRESETS = [
    {
        "name": "kampanya_genel",
        "title_tr": "Genel Duyuru", "title_en": "General Announcement",
        "body_tr": "Merhaba {{1}}! 🎉\n\n{{2}}\n\nBildirim almak istemiyorsanız DUR yazın.",
        "body_en": "Hi {{1}}! 🎉\n\n{{2}}\n\nReply STOP to unsubscribe.",
        "sample_tr": ["Ahmet", "Mağazamızda yeni sezon ürünleri sizi bekliyor!"],
        "sample_en": ["John", "New season arrivals are waiting for you in our store!"],
    },
    {
        "name": "kampanya_indirim",
        "title_tr": "İndirim Kampanyası", "title_en": "Discount Campaign",
        "body_tr": "Merhaba {{1}}! 🛍️\n\n{{2}}\n\nFırsatı kaçırmayın! Bildirimleri durdurmak için DUR yazın.",
        "body_en": "Hi {{1}}! 🛍️\n\n{{2}}\n\nDon't miss out! Reply STOP to unsubscribe.",
        "sample_tr": ["Ayşe", "Tüm ürünlerde %30 indirim, sadece bu hafta sonu geçerli!"],
        "sample_en": ["Emily", "30% off everything — this weekend only!"],
    },
    {
        "name": "kampanya_yeni_urun",
        "title_tr": "Yeni Ürün Duyurusu", "title_en": "New Product Announcement",
        "body_tr": "Merhaba {{1}}! ✨\n\n{{2}}\n\nHemen inceleyin. Bildirim istemiyorsanız DUR yazın.",
        "body_en": "Hi {{1}}! ✨\n\n{{2}}\n\nCheck it out now. Reply STOP to unsubscribe.",
        "sample_tr": ["Mehmet", "Yeni koleksiyonumuz yayında — ilk görenlerden olun!"],
        "sample_en": ["Michael", "Our new collection is live — be among the first to see it!"],
    },
]


def _preset_lang_key(language: str) -> str:
    """WhatsApp dil kodundan preset anahtarı: 'en*' → en, aksi halde tr."""
    return "en" if str(language or "").lower().startswith("en") else "tr"


# ---------------------------------------------------------------------------
# Yardımcılar
# ---------------------------------------------------------------------------
def _normalize_phone(raw: str) -> str:
    """Telefonu E.164'e normalize eder (+90... TR varsayımı)."""
    raw = str(raw or "").strip()
    if not raw:
        return ""
    digits = "".join(c for c in raw if c.isdigit())
    if not digits:
        return ""
    if raw.startswith("+"):
        return "+" + digits
    if digits.startswith("90"):
        return "+" + digits
    if digits.startswith("0"):
        return "+9" + digits
    if len(digits) == 10:  # 5XXXXXXXXX
        return "+90" + digits
    return "+" + digits


def _wa_creds(username: str, brand: str) -> tuple[str, str, str]:
    """(wa_token, phone_number_id, waba_id) döner — flow ayarlarından."""
    # get_flow_settings async; burada sync get_setting kullanamayız (ayarlar Redis'te).
    # Çağıran async fonksiyon settings'i geçer. Bu helper yerine inline kullanılacak.
    return "", "", ""


def _get_app_id(token: str) -> str:
    """System user token'ından Meta app_id'yi çıkarır (debug_token)."""
    try:
        r = _requests.get(
            f"{META_GRAPH}/debug_token",
            params={"input_token": token, "access_token": token},
            timeout=10,
        )
        return str(((r.json().get("data") or {}).get("app_id")) or "")
    except Exception as e:
        logger.warning("[CAMPAIGN] app_id alınamadı: %s", e)
        return ""


def _resumable_upload(token: str, app_id: str, image_bytes: bytes, mime: str = "image/jpeg") -> str:
    """Meta Resumable Upload — şablon görsel örneği için header_handle döner."""
    if not app_id:
        return ""
    try:
        # 1. Upload session başlat
        start = _requests.post(
            f"{META_GRAPH}/{app_id}/uploads",
            params={"file_length": len(image_bytes), "file_type": mime, "access_token": token},
            timeout=15,
        )
        session_id = (start.json() or {}).get("id", "")
        if not session_id:
            logger.warning("[CAMPAIGN] upload session yok: %s", start.text[:200])
            return ""
        # 2. Byte'ları yükle
        up = _requests.post(
            f"{META_GRAPH}/{session_id}",
            headers={"Authorization": f"OAuth {token}", "file_offset": "0"},
            data=image_bytes,
            timeout=30,
        )
        handle = (up.json() or {}).get("h", "")
        if not handle:
            logger.warning("[CAMPAIGN] upload handle yok: %s", up.text[:200])
        return handle
    except Exception as e:
        logger.warning("[CAMPAIGN] resumable upload hatası: %s", e)
        return ""


# ---------------------------------------------------------------------------
# Hedef kitle — son N günde sipariş veren müşteriler (telefon + RFM segment)
# ---------------------------------------------------------------------------
_AUDIENCE_GQL = """
query AudienceOrders($cursor: String, $query: String!) {
  orders(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      totalPriceSet { shopMoney { amount } }
      customer { id displayName phone }
    }
  }
}
"""


def _segment(r: int, f: int) -> str:
    if r >= 4 and f >= 4: return "champions"
    if r >= 3 and f >= 3: return "loyal"
    if r >= 4 and f < 3:  return "promising"
    if r == 1 and f >= 2: return "lost"
    if r <= 2 and f >= 3: return "at_risk"
    if r >= 4 and f == 1: return "new"
    return "needs_attention"


async def _build_audience(domain: str, token: str, days: int = 180) -> list[dict]:
    """Son N günde sipariş veren, telefonu olan müşterileri RFM segmentiyle döner.
    [{phone, name, segment}]"""
    if not domain or not token:
        return []
    gql_url = f"https://{domain.replace('https://','').rstrip('/')}/admin/api/2026-04/graphql.json"
    headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
    since = (datetime.now(timezone.utc).timestamp() - days * 86400)
    since_iso = datetime.fromtimestamp(since, tz=timezone.utc).strftime("%Y-%m-%d")
    q_filter = f"created_at:>{since_iso}"

    nodes = []
    cursor = None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            for _ in range(4):  # maks 1000 sipariş
                payload = {"query": _AUDIENCE_GQL, "variables": {"cursor": cursor, "query": q_filter}}
                r = await client.post(gql_url, headers=headers, json=payload)
                if r.status_code != 200:
                    break
                od = ((r.json().get("data") or {}).get("orders") or {})
                nodes.extend(od.get("nodes") or [])
                pi = od.get("pageInfo") or {}
                if not pi.get("hasNextPage"):
                    break
                cursor = pi.get("endCursor")
    except Exception as e:
        logger.warning("[CAMPAIGN] audience sorgu hatası: %s", e)
        return []

    now_dt = datetime.now(timezone.utc)
    custs: dict[str, dict] = {}
    for node in nodes:
        cust = node.get("customer") or {}
        cid = cust.get("id", "")
        phone = _normalize_phone(cust.get("phone", ""))
        if not cid or not phone:
            continue
        amt = float((node.get("totalPriceSet") or {}).get("shopMoney", {}).get("amount") or 0)
        try:
            order_dt = datetime.fromisoformat(node["createdAt"].replace("Z", "+00:00"))
        except Exception:
            continue
        r_days = (now_dt - order_dt).days
        if cid not in custs:
            custs[cid] = {"phone": phone, "name": cust.get("displayName", ""),
                          "r_days": r_days, "frequency": 0, "monetary": 0.0}
        c = custs[cid]
        c["frequency"] += 1
        c["monetary"] += amt
        if r_days < c["r_days"]:
            c["r_days"] = r_days

    clist = list(custs.values())
    if not clist:
        return []

    def quintiles(vals):
        s = sorted(vals); n = len(s)
        return [s[max(0, int(n * p / 5) - 1)] for p in range(1, 5)]

    r_q = quintiles([c["r_days"] for c in clist])
    f_q = quintiles([c["frequency"] for c in clist])
    m_q = quintiles([c["monetary"] for c in clist])

    def score(val, quint, invert=False):
        sc = bisect.bisect_right(quint, val) + 1
        return 6 - sc if invert else sc

    for c in clist:
        r = score(c["r_days"], r_q, invert=True)
        f = score(c["frequency"], f_q)
        m = score(c["monetary"], m_q)
        c["segment"] = _segment(r, f)
        c["m_score"] = m  # parasal değer skoru (5 = en üst %20 harcayan)

    return [{"phone": c["phone"], "name": c["name"], "segment": c["segment"],
             "monetary": round(c["monetary"], 2), "m_score": c["m_score"]} for c in clist]


# SMS pazarlama onayı vermiş müşteriler (sipariş şartı YOK) — telefonu olanlar
_SMS_AUDIENCE_GQL = """
query SmsAudience($cursor: String) {
  customers(first: 250, after: $cursor, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { id displayName phone smsMarketingConsent { marketingState } }
  }
}
"""


async def _build_sms_audience(domain: str, token: str, max_pages: int = 20) -> list[dict]:
    """Shopify'da SMS pazarlama onayı (SUBSCRIBED) vermiş, telefonu olan müşteriler.
    RFM'den bağımsız — sipariş vermemiş olsalar bile döner. [{phone, name, segment}]"""
    if not domain or not token:
        return []
    gql_url = f"https://{domain.replace('https://','').rstrip('/')}/admin/api/2026-04/graphql.json"
    headers = {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}
    out: dict[str, dict] = {}
    cursor = None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            for _ in range(max_pages):
                payload = {"query": _SMS_AUDIENCE_GQL, "variables": {"cursor": cursor}}
                r = await client.post(gql_url, headers=headers, json=payload)
                if r.status_code != 200:
                    break
                cd = ((r.json().get("data") or {}).get("customers") or {})
                for n in cd.get("nodes") or []:
                    phone = _normalize_phone(n.get("phone", ""))
                    state = ((n.get("smsMarketingConsent") or {}).get("marketingState") or "").upper()
                    if phone and state == "SUBSCRIBED":
                        key = n.get("id") or phone
                        out[key] = {"phone": phone, "name": n.get("displayName", ""),
                                    "segment": "sms_consent", "monetary": 0.0, "m_score": 0}
                pi = cd.get("pageInfo") or {}
                if not pi.get("hasNextPage"):
                    break
                cursor = pi.get("endCursor")
    except Exception as e:
        logger.warning("[CAMPAIGN] SMS audience sorgu hatası: %s", e)
        return []
    return list(out.values())


def _first_name(full: str) -> str:
    return (full or "").strip().split(" ")[0] if full else ""


def _clean_param(text: str) -> str:
    """WhatsApp şablon değişkenleri newline/tab/4+ardışık boşluk içeremez.
    Tüm boşluk dizilerini tek boşluğa indirger."""
    return re.sub(r"\s+", " ", str(text or "")).strip()


# ---------------------------------------------------------------------------
# Endpoint: hazır şablon önerileri + mevcut onaylı görsel şablonlar
# ---------------------------------------------------------------------------
def _analyze_template(comps: list) -> dict:
    """Şablon component'lerini analiz eder → önizleme + form uyarıları için yapı.
    header_format: NONE|TEXT|IMAGE|VIDEO|DOCUMENT, body_var_count, buttons, has_coupon."""
    import re as _re
    header_format = "NONE"
    header_text = ""
    body_text = ""
    var_count = 0
    buttons = []
    for c in comps or []:
        ctype = (c.get("type") or "").upper()
        if ctype == "HEADER":
            header_format = (c.get("format") or "TEXT").upper()
            if header_format == "TEXT":
                header_text = c.get("text", "") or ""
        elif ctype == "BODY":
            body_text = c.get("text", "") or ""
            nums = re.findall(r"\{\{\s*(\d+)\s*\}\}", body_text)
            var_count = len(set(nums))
        elif ctype == "BUTTONS":
            for b in c.get("buttons", []) or []:
                buttons.append({"type": (b.get("type") or "").upper(), "text": b.get("text", "") or ""})
    return {
        "header_format": header_format,
        "header_text": header_text,
        "body_text": body_text,
        "body_var_count": var_count,
        "buttons": buttons,
        "has_coupon": any(b["type"] == "COPY_CODE" for b in buttons),
    }


@router.get("/templates")
async def list_campaign_templates(
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Hazır şablon önerileri + Meta'da onaylı IMAGE-header MARKETING şablonları."""
    settings = await store.get_flow_settings(username, brand)
    wa_token = settings.get("wa_token", "")
    phone_id = settings.get("phone_number_id", "")
    waba_id = settings.get("waba_id", "")

    approved = []
    if wa_token and waba_id:
        try:
            r = _requests.get(
                f"{META_GRAPH}/{waba_id}/message_templates",
                params={"fields": "name,language,status,category,components", "limit": 200, "access_token": wa_token},
                timeout=10,
            )
            for tpl in r.json().get("data", []):
                if tpl.get("status") != "APPROVED":
                    continue
                comps = tpl.get("components", [])
                analysis = _analyze_template(comps)
                approved.append({
                    "name": tpl.get("name"),
                    "language": tpl.get("language"),
                    "status": tpl.get("status"),
                    "category": tpl.get("category"),
                    **analysis,
                })
        except Exception as e:
            logger.warning("[CAMPAIGN] şablon listesi alınamadı: %s", e)

    return {
        "ok": True,
        "presets": [{"name": p["name"], "title_tr": p["title_tr"], "title_en": p["title_en"],
                     "body_tr": p["body_tr"], "body_en": p["body_en"]} for p in CAMPAIGN_PRESETS],
        "approved": approved,
        "wa_ready": bool(wa_token and phone_id),
    }


# ---------------------------------------------------------------------------
# Endpoint: kampanya şablonu oluştur (görsel header) → Meta onayına gönder
# ---------------------------------------------------------------------------
@router.post("/template")
async def create_campaign_template(
    body: dict = Body(...),
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """
    Görsel header'lı MARKETING şablonu oluşturur.
    body: { preset?: "kampanya_indirim", name?, body_text?, language?, sample_image_url, button_text?, button_url? }
    sample_image_url: Meta'nın onay için isteyeceği örnek görsel (Shopify CDN linki).
    """
    settings = await store.get_flow_settings(username, brand)
    wa_token = settings.get("wa_token", "")
    waba_id = settings.get("waba_id", "")
    if not wa_token or not waba_id:
        raise HTTPException(400, "WhatsApp bağlantısı eksik (token/WABA ID). Ayarlar'dan tamamlayın.")

    preset_name = body.get("preset", "")
    preset = next((p for p in CAMPAIGN_PRESETS if p["name"] == preset_name), None)
    language = body.get("language", "tr")
    lk = _preset_lang_key(language)
    # Custom ad verilmişse onu kullan (preset seçili olsa bile); yoksa preset adı.
    raw_name = (body.get("name", "").strip() or (preset["name"] if preset else ""))
    # WhatsApp şablon adı kuralı: yalnız küçük harf, rakam ve alt çizgi.
    name = re.sub(r"[^a-z0-9_]", "", raw_name.lower().replace(" ", "_").replace("-", "_"))
    body_text = preset["body_" + lk] if preset else body.get("body_text", "")
    sample_url = body.get("sample_image_url", "").strip()
    if not name or not body_text:
        raise HTTPException(400, "Şablon adı ve metni gerekli")
    if not sample_url:
        raise HTTPException(400, "Onay için örnek görsel URL'i gerekli (Shopify CDN linki)")

    # Örnek görseli indir → resumable upload → handle
    try:
        img_r = _requests.get(sample_url, timeout=15)
        img_r.raise_for_status()
        image_bytes = img_r.content
        mime = img_r.headers.get("Content-Type", "image/jpeg").split(";")[0]
    except Exception as e:
        raise HTTPException(400, f"Örnek görsel indirilemedi: {e}")

    app_id = _get_app_id(wa_token)
    handle = _resumable_upload(wa_token, app_id, image_bytes, mime)
    if not handle:
        raise HTTPException(502, "Görsel Meta'ya yüklenemedi (resumable upload başarısız)")

    components = [
        {"type": "HEADER", "format": "IMAGE", "example": {"header_handle": [handle]}},
        {"type": "BODY", "text": body_text,
         "example": {"body_text": [preset["sample_" + lk] if preset else ["Ahmet", "Kampanya mesajı örneği"]]}},
    ]
    btns = []
    button_text = body.get("button_text", "")
    button_url = body.get("button_url", "")
    if button_text and button_url:
        btns.append({"type": "URL", "text": button_text, "url": button_url})
    # Opsiyonel kupon kodu butonu (copy_code) — örnek kod Meta onayı için gerekli
    if body.get("coupon_button"):
        coupon_example = (body.get("coupon_example", "") or "INDIRIM10").strip()
        btns.append({"type": "COPY_CODE", "example": coupon_example})
    if btns:
        components.append({"type": "BUTTONS", "buttons": btns})

    payload = {"name": name, "language": language, "category": "MARKETING", "components": components}
    r = _requests.post(
        f"{META_GRAPH}/{waba_id}/message_templates",
        json=payload, headers={"Authorization": f"Bearer {wa_token}"}, timeout=15,
    )
    data = r.json()
    if r.status_code != 200:
        err = data.get("error", {})
        if err.get("error_subcode") == 2388024:  # zaten var
            return {"ok": True, "status": "ALREADY_EXISTS", "name": name}
        logger.warning("[CAMPAIGN] şablon oluşturma hatası: %s", str(data)[:400])
        raise HTTPException(502, f"Meta hatası: {err.get('message', str(data)[:200])}")
    return {"ok": True, "status": data.get("status", "PENDING"), "name": name, "id": data.get("id", "")}


# ---------------------------------------------------------------------------
# Endpoint: görsel upload yedeği (URL'i olmayan merchant için) — Redis'te saklar
# ---------------------------------------------------------------------------
@router.post("/media")
async def upload_campaign_media(
    body: dict = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """
    base64 görseli Redis'te saklar, public URL döner.
    body: { data: "data:image/jpeg;base64,...", filename? }
    Birincil yol Shopify CDN URL yapıştırma; bu sadece yedek kolaylık.
    """
    data_uri = body.get("data", "")
    if not data_uri or "," not in data_uri:
        raise HTTPException(400, "Geçersiz görsel verisi")
    try:
        header, b64 = data_uri.split(",", 1)
        ct = "image/jpeg"
        if ":" in header and ";" in header:
            ct = header.split(":", 1)[1].split(";", 1)[0]
        # boyut kontrolü (5 MB)
        if len(base64.b64decode(b64)) > 5 * 1024 * 1024:
            raise HTTPException(400, "Görsel 5 MB'tan büyük olamaz")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Görsel çözümlenemedi")

    media_id = secrets.token_hex(12)
    await store.save_campaign_media(media_id, ct, b64)
    from os import getenv
    app_url = getenv("SHOPIFY_APP_URL", "https://live.shoptimize.com.tr")
    return {"ok": True, "url": f"{app_url}/campaign-media/{media_id}"}


# ---------------------------------------------------------------------------
# Endpoint: hedef kitle sayısı / önizleme
# ---------------------------------------------------------------------------
@router.get("/audience")
async def get_audience(
    username: str = Query(""),
    brand: str = Query("default"),
    days: int = Query(180),
    current_user: dict = Depends(get_current_user),
):
    """Segment bazlı kişi sayıları + potansiyel ciro + Yüksek Harcayanlar + ulaşılabilir."""
    domain = get_setting(username, brand, "shopify", "shop_domain", "")
    token = await store.get_online_token(username, brand) \
            or get_setting(username, brand, "shopify", "admin_api_token", "")
    audience = await _build_audience(domain, token, days)

    seg_counts: dict[str, int] = {}
    seg_revenue: dict[str, float] = {}   # segment → toplam harcama (potansiyel ciro göstergesi)
    for a in audience:
        s = a["segment"]
        seg_counts[s] = seg_counts.get(s, 0) + 1
        seg_revenue[s] = seg_revenue.get(s, 0) + a.get("monetary", 0)

    # Yüksek Harcayanlar: en üst %20 harcama dilimi (RFM segmentinden bağımsız kesit)
    high_value = [a for a in audience if a.get("m_score", 0) >= 4]
    high_value_revenue = sum(a.get("monetary", 0) for a in high_value)

    # opt-out filtreli toplam (tümü için)
    reachable = 0
    for a in audience:
        if not await store.is_optout(a["phone"], username, brand):
            reachable += 1

    # SMS pazarlama onaylı müşteriler (sipariş şartından bağımsız ayrı kitle)
    sms_list = await _build_sms_audience(domain, token)
    sms_reachable = 0
    for a in sms_list:
        if not await store.is_optout(a["phone"], username, brand):
            sms_reachable += 1

    return {
        "ok": True,
        "total": len(audience),
        "reachable": reachable,
        "opted_out": len(audience) - reachable,
        "segments": seg_counts,
        "segment_revenue": {k: round(v, 2) for k, v in seg_revenue.items()},
        "high_value": {"count": len(high_value), "revenue": round(high_value_revenue, 2)},
        "sms_consent": {"count": len(sms_list), "reachable": sms_reachable},
        "total_revenue": round(sum(a.get("monetary", 0) for a in audience), 2),
        "days": days,
    }


@router.get("/audience/members")
async def get_audience_members(
    username: str = Query(""),
    brand: str = Query("default"),
    segment: str = Query("all"),
    days: int = Query(180),
    current_user: dict = Depends(get_current_user),
):
    """Seçili segmentteki kişileri döner (isim, telefon, harcama, opt-out durumu)."""
    domain = get_setting(username, brand, "shopify", "shop_domain", "")
    token = await store.get_online_token(username, brand) \
            or get_setting(username, brand, "shopify", "admin_api_token", "")
    if segment == "sms_consent":
        members = await _build_sms_audience(domain, token)
    else:
        audience = await _build_audience(domain, token, days)
        if segment == "all":
            members = audience
        elif segment == "high_value":
            members = [a for a in audience if a.get("m_score", 0) >= 4]
        else:
            members = [a for a in audience if a["segment"] == segment]

    members = sorted(members, key=lambda x: -x.get("monetary", 0))[:500]
    out = []
    for m in members:
        out.append({
            "name": m.get("name", ""),
            "phone": m["phone"],
            "monetary": m.get("monetary", 0),
            "segment": m.get("segment", ""),
            "opted_out": await store.is_optout(m["phone"], username, brand),
        })
    return {"ok": True, "members": out, "count": len(out)}


# ---------------------------------------------------------------------------
# Gönderim motoru — şimdi gönder / planla / worker tarafından çağrılır
# ---------------------------------------------------------------------------
async def execute_campaign(username: str, brand: str, campaign: dict) -> dict:
    """Kampanyayı gönderir: opt-out filtre + batch + rate-limit. Stats günceller."""
    import asyncio

    settings = await store.get_flow_settings(username, brand)
    wa_token = settings.get("wa_token", "")
    phone_id = settings.get("phone_number_id", "")
    if not wa_token or not phone_id:
        campaign["status"] = "failed"
        campaign["error"] = "WhatsApp bağlantısı eksik"
        await store.save_campaign(username, brand, campaign)
        return campaign

    domain = get_setting(username, brand, "shopify", "shop_domain", "")
    sh_token = await store.get_online_token(username, brand) \
               or get_setting(username, brand, "shopify", "admin_api_token", "")
    seg = campaign.get("segment", "all")
    if seg == "sms_consent":
        targets = await _build_sms_audience(domain, sh_token)
    else:
        audience = await _build_audience(domain, sh_token, campaign.get("audience_days", 180))
        if seg == "all":
            targets = audience
        elif seg == "high_value":
            targets = [a for a in audience if a.get("m_score", 0) >= 4]
        else:
            targets = [a for a in audience if a["segment"] == seg]

    campaign["status"] = "sending"
    campaign["stats"] = {"total": len(targets), "sent": 0, "failed": 0, "opted_out": 0}
    await store.save_campaign(username, brand, campaign)

    tpl = campaign.get("template_name", "")
    lang = campaign.get("language", "tr")
    image_url = campaign.get("image_url", "")
    coupon_code = campaign.get("coupon_code", "")
    message = _clean_param(campaign.get("message", ""))

    # Link varsa UTM ile etiketle ve mesaja ekle (boşlukla — newline WA param'da yasak)
    link = campaign.get("link", "").strip()
    if link:
        sep = "&" if "?" in link else "?"
        tagged = f"{link}{sep}utm_source=whatsapp&utm_medium=campaign&utm_campaign={campaign['id']}"
        message = f"{message} {tagged}"

    seen = set()
    sent = failed = opted = 0
    for i, t in enumerate(targets):
        phone = t["phone"]
        if phone in seen:
            continue
        seen.add(phone)
        res = await send_wa_template(
            wa_token, phone_id, phone,
            template_name=tpl, language=lang,
            header_image_url=image_url,
            body_text_params=[_clean_param(_first_name(t["name"])) or "Değerli müşterimiz", message],
            coupon_code=coupon_code,
            username=username, brand=brand,
        )
        if res.get("opted_out"):
            opted += 1
        elif res.get("ok"):
            sent += 1
            mid = res.get("message_id", "")
            if mid:
                await store.link_campaign_message(mid, username, brand, campaign["id"])
            # Kişi bazlı takip için alıcıyı kaydet (telefon → isim + msg_id)
            await store.add_campaign_recipient(username, brand, campaign["id"], phone, t.get("name", ""), mid)
        else:
            failed += 1
        if (i + 1) % _BATCH_SIZE == 0:
            campaign["stats"] = {"total": len(targets), "sent": sent, "failed": failed, "opted_out": opted}
            await store.save_campaign(username, brand, campaign)
            await asyncio.sleep(_BATCH_DELAY_SEC)

    campaign["status"] = "sent"
    campaign["sent_at"] = int(time.time() * 1000)
    campaign["stats"] = {"total": len(targets), "sent": sent, "failed": failed, "opted_out": opted}
    await store.save_campaign(username, brand, campaign)
    logger.info("[CAMPAIGN] gönderildi: %s sent=%d failed=%d opted=%d", campaign.get("id"), sent, failed, opted)
    return campaign


@router.post("/send")
async def send_campaign(
    body: dict = Body(...),
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """
    Kampanya oluşturur ve şimdi gönderir veya planlar.
    body: { name, template_name, language?, message, image_url, segment, audience_days?, scheduled_at? (ms) }
    """
    message = body.get("message", "").strip()
    image_url = body.get("image_url", "").strip()
    template_name = body.get("template_name", "").strip()
    if not message or not template_name:
        raise HTTPException(400, "Mesaj ve şablon gerekli")

    cid = secrets.token_hex(8)
    campaign = {
        "id": cid,
        "name": body.get("name", "") or "Kampanya",
        "template_name": template_name,
        "language": body.get("language", "tr"),
        "message": message,
        "image_url": image_url,
        "coupon_code": body.get("coupon_code", "").strip(),
        "link": body.get("link", "").strip(),
        "segment": body.get("segment", "all"),
        "audience_days": int(body.get("audience_days", 180)),
        "created_at": int(time.time() * 1000),
        "scheduled_at": body.get("scheduled_at"),
        "status": "draft",
        "stats": {"total": 0, "sent": 0, "failed": 0, "opted_out": 0},
    }

    scheduled_at = body.get("scheduled_at")
    if scheduled_at and int(scheduled_at) > int(time.time() * 1000) + 30000:
        campaign["status"] = "scheduled"
        await store.save_campaign(username, brand, campaign)
        await store.schedule_campaign(username, brand, cid, int(scheduled_at))
        return {"ok": True, "campaign_id": cid, "status": "scheduled", "scheduled_at": scheduled_at}

    # Şimdi gönder — arka planda çalıştır (HTTP isteğini bloklamamak için)
    import asyncio
    await store.save_campaign(username, brand, campaign)
    asyncio.ensure_future(execute_campaign(username, brand, campaign))
    return {"ok": True, "campaign_id": cid, "status": "sending"}


@router.post("/cancel")
async def cancel_campaign(
    body: dict = Body(...),
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Planlanmış (henüz gönderilmemiş) bir kampanyayı iptal eder."""
    cid = str(body.get("campaign_id", "")).strip()
    if not cid:
        raise HTTPException(400, "campaign_id gerekli")
    camp = await store.get_campaign(username, brand, cid)
    if not camp:
        raise HTTPException(404, "Kampanya bulunamadı")
    if camp.get("status") != "scheduled":
        return {"ok": False, "error": "not_scheduled",
                "message": "Yalnızca planlanmış kampanyalar iptal edilebilir."}
    await store.unschedule_campaign(f"{username}:{brand}:{cid}")
    camp["status"] = "cancelled"
    await store.save_campaign(username, brand, camp)
    logger.info("[CAMPAIGN] iptal edildi: %s:%s %s", username, brand, cid)
    return {"ok": True, "status": "cancelled"}


@router.post("/test")
async def send_test_campaign(
    body: dict = Body(...),
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Kendi numarana test gönderir (toplu göndermeden önce kontrol)."""
    phone = _normalize_phone(body.get("phone", ""))
    message = _clean_param(body.get("message", ""))
    image_url = body.get("image_url", "").strip()
    coupon_code = body.get("coupon_code", "").strip()
    link = body.get("link", "").strip()
    template_name = body.get("template_name", "").strip()
    if not phone or not message or not template_name:
        raise HTTPException(400, "Telefon, mesaj ve şablon gerekli")
    if link:
        sep = "&" if "?" in link else "?"
        message = f"{message} {link}{sep}utm_source=whatsapp&utm_medium=campaign&utm_campaign=test"

    settings = await store.get_flow_settings(username, brand)
    wa_token = settings.get("wa_token", "")
    phone_id = settings.get("phone_number_id", "")
    if not wa_token or not phone_id:
        raise HTTPException(400, "WhatsApp bağlantısı eksik")

    res = await send_wa_template(
        wa_token, phone_id, phone,
        template_name=template_name, language=body.get("language", "tr"),
        header_image_url=image_url,
        body_text_params=["Test", message],
        coupon_code=coupon_code,
        username=username, brand=brand,
    )
    return {"ok": res.get("ok", False), "result": res}


@router.get("/list")
async def list_campaigns(
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Kampanya geçmişi + istatistikler (teslim/okundu + tıklama/sipariş atfı)."""
    campaigns = await store.list_campaigns(username, brand)

    # Pixel event'lerinden tıklama/sipariş atfı (utm_campaign == kampanya id)
    tid = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
    click_vids: dict[str, set] = {}   # cid → tıklayan vid'ler
    purchase_vids: set = set()        # satın alan vid'ler
    rev_by_vid: dict[str, float] = {} # vid → ciro
    if tid:
        try:
            events = await store.get_recent_events(tid, limit=5000)
            for ev in events:
                vid = ev.get("vid", "")
                utm = ev.get("utm") or {}
                camp = utm.get("utm_campaign", "")
                if vid and camp:
                    click_vids.setdefault(camp, set()).add(vid)
                if ev.get("event_type") == "checkout_completed" and vid:
                    purchase_vids.add(vid)
                    d = ev.get("data") or {}
                    val = d.get("value") or d.get("total") or d.get("total_price") or d.get("price") or 0
                    try:
                        rev_by_vid[vid] = float(val)
                    except (TypeError, ValueError):
                        pass
        except Exception as e:
            logger.warning("[CAMPAIGN] atıf hesabı hatası: %s", e)

    for c in campaigns:
        cid = c.get("id", "")
        delivery = await store.get_campaign_delivery(username, brand, cid)
        c.setdefault("stats", {})
        c["stats"]["delivered"] = delivery["delivered"]
        c["stats"]["read"] = delivery["read"]
        clickers = click_vids.get(cid, set())
        order_vids = clickers & purchase_vids
        c["stats"]["clicks"] = len(clickers)
        c["stats"]["orders"] = len(order_vids)
        c["stats"]["revenue"] = round(sum(rev_by_vid.get(v, 0) for v in order_vids), 2)

    return {"ok": True, "campaigns": campaigns}


@router.get("/recipients")
async def campaign_recipients(
    cid: str = Query(""),
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Kişi bazlı kampanya takibi: her alıcı için iletildi/okundu/sipariş (+ürün +ciro)."""
    if not cid:
        raise HTTPException(400, "cid gerekli")
    recips = await store.get_campaign_recipients(username, brand, cid)
    delivered_set, read_set = await store.get_campaign_delivery_sets(username, brand, cid)
    camp = await store.get_campaign(username, brand, cid) or {}
    sent_at = camp.get("sent_at") or camp.get("created_at") or 0

    # Siparişleri telefona göre indeksle (gönderimden -1s .. +14g penceresi)
    orders = await store.get_converted_orders(username, brand, limit=200)
    def _norm(p):
        return re.sub(r"\D", "", str(p or ""))[-10:]
    window_end = sent_at + 14 * 86400 * 1000
    orders_by_phone = {}
    for o in orders:
        k = _norm(o.get("phone", ""))
        ots = o.get("ts", 0)
        if k and (sent_at == 0 or (ots >= sent_at - 3600 * 1000 and ots <= window_end)):
            orders_by_phone.setdefault(k, o)  # liste yeni→eski; ilk eşleşen en yeni

    out = []
    for r in recips:
        mid = r.get("msg_id", "")
        order = orders_by_phone.get(_norm(r.get("phone", "")))
        li = (order or {}).get("line_items") or []
        out.append({
            "phone": r.get("phone", ""),
            "name": r.get("name", ""),
            "delivered": bool(mid) and mid in delivered_set,
            "read": bool(mid) and mid in read_set,
            "ordered": bool(order),
            "product": (li[0].get("title", "") if li else "") if order else "",
            "revenue": float((order or {}).get("total_price", 0) or 0) if order else 0,
        })
    out.sort(key=lambda x: (x["ordered"], x["read"], x["delivered"]), reverse=True)
    return {"ok": True, "recipients": out, "count": len(out)}


# ---------------------------------------------------------------------------
# Görsel servis (upload yedeği için) — prefix dışında, ayrı router
# ---------------------------------------------------------------------------
media_router = APIRouter()


@media_router.get("/campaign-media/{media_id}")
async def serve_campaign_media(media_id: str):
    media = await store.get_campaign_media(media_id)
    if not media:
        raise HTTPException(404, "Görsel bulunamadı")
    try:
        raw = base64.b64decode(media["b64"])
    except Exception:
        raise HTTPException(500, "Görsel çözümlenemedi")
    return Response(content=raw, media_type=media.get("ct", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=2592000"})
