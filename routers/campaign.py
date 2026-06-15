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
        "title_tr": "Genel Duyuru",
        "body": "Merhaba {{1}}! 🎉\n\n{{2}}\n\nBildirim almak istemiyorsanız DUR yazın.",
        "sample": ["Ahmet", "Mağazamızda yeni sezon ürünleri sizi bekliyor!"],
    },
    {
        "name": "kampanya_indirim",
        "title_tr": "İndirim Kampanyası",
        "body": "Merhaba {{1}}! 🛍️\n\n{{2}}\n\nFırsatı kaçırmayın! Bildirimleri durdurmak için DUR yazın.",
        "sample": ["Ayşe", "Tüm ürünlerde %30 indirim, sadece bu hafta sonu geçerli!"],
    },
    {
        "name": "kampanya_yeni_urun",
        "title_tr": "Yeni Ürün Duyurusu",
        "body": "Merhaba {{1}}! ✨\n\n{{2}}\n\nHemen inceleyin. Bildirim istemiyorsanız DUR yazın.",
        "sample": ["Mehmet", "Yeni koleksiyonumuz yayında — ilk görenlerden olun!"],
    },
]


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

    def score(val, quint, invert=False):
        sc = bisect.bisect_right(quint, val) + 1
        return 6 - sc if invert else sc

    for c in clist:
        r = score(c["r_days"], r_q, invert=True)
        f = score(c["frequency"], f_q)
        c["segment"] = _segment(r, f)

    return [{"phone": c["phone"], "name": c["name"], "segment": c["segment"]} for c in clist]


def _first_name(full: str) -> str:
    return (full or "").strip().split(" ")[0] if full else ""


# ---------------------------------------------------------------------------
# Endpoint: hazır şablon önerileri + mevcut onaylı görsel şablonlar
# ---------------------------------------------------------------------------
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
                comps = tpl.get("components", [])
                has_img = any(c.get("type") == "HEADER" and c.get("format") == "IMAGE" for c in comps)
                if has_img and tpl.get("category") == "MARKETING":
                    approved.append({
                        "name": tpl.get("name"),
                        "language": tpl.get("language"),
                        "status": tpl.get("status"),
                    })
        except Exception as e:
            logger.warning("[CAMPAIGN] şablon listesi alınamadı: %s", e)

    return {
        "ok": True,
        "presets": [{"name": p["name"], "title": p["title_tr"], "body": p["body"]} for p in CAMPAIGN_PRESETS],
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
    name = (preset["name"] if preset else body.get("name", "")).strip().lower().replace(" ", "_")
    body_text = preset["body"] if preset else body.get("body_text", "")
    language = body.get("language", "tr")
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
         "example": {"body_text": [preset["sample"] if preset else ["Ahmet", "Kampanya mesajı örneği"]]}},
    ]
    button_text = body.get("button_text", "")
    button_url = body.get("button_url", "")
    if button_text and button_url:
        components.append({"type": "BUTTONS", "buttons": [{"type": "URL", "text": button_text, "url": button_url}]})

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
    """Segment bazlı kişi sayıları + opt-out sonrası ulaşılabilir sayı."""
    domain = get_setting(username, brand, "shopify", "shop_domain", "")
    token = await store.get_online_token(username, brand) \
            or get_setting(username, brand, "shopify", "admin_api_token", "")
    audience = await _build_audience(domain, token, days)

    seg_counts: dict[str, int] = {}
    for a in audience:
        seg_counts[a["segment"]] = seg_counts.get(a["segment"], 0) + 1

    # opt-out filtreli toplam (tümü için)
    reachable = 0
    for a in audience:
        if not await store.is_optout(a["phone"], username, brand):
            reachable += 1

    return {
        "ok": True,
        "total": len(audience),
        "reachable": reachable,
        "opted_out": len(audience) - reachable,
        "segments": seg_counts,
        "days": days,
    }


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
    audience = await _build_audience(domain, sh_token, campaign.get("audience_days", 180))

    seg = campaign.get("segment", "all")
    targets = audience if seg == "all" else [a for a in audience if a["segment"] == seg]

    campaign["status"] = "sending"
    campaign["stats"] = {"total": len(targets), "sent": 0, "failed": 0, "opted_out": 0}
    await store.save_campaign(username, brand, campaign)

    tpl = campaign.get("template_name", "")
    lang = campaign.get("language", "tr")
    image_url = campaign.get("image_url", "")
    message = campaign.get("message", "")

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
            body_text_params=[_first_name(t["name"]) or "Değerli müşterimiz", message],
            username=username, brand=brand,
        )
        if res.get("opted_out"):
            opted += 1
        elif res.get("ok"):
            sent += 1
            if res.get("message_id"):
                await store.link_campaign_message(res["message_id"], username, brand, campaign["id"])
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


@router.post("/test")
async def send_test_campaign(
    body: dict = Body(...),
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Kendi numarana test gönderir (toplu göndermeden önce kontrol)."""
    phone = _normalize_phone(body.get("phone", ""))
    message = body.get("message", "").strip()
    image_url = body.get("image_url", "").strip()
    template_name = body.get("template_name", "").strip()
    if not phone or not message or not template_name:
        raise HTTPException(400, "Telefon, mesaj ve şablon gerekli")

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
        username=username, brand=brand,
    )
    return {"ok": res.get("ok", False), "result": res}


@router.get("/list")
async def list_campaigns(
    username: str = Query(""),
    brand: str = Query("default"),
    current_user: dict = Depends(get_current_user),
):
    """Kampanya geçmişi + istatistikler (teslim/okundu dahil)."""
    campaigns = await store.list_campaigns(username, brand)
    for c in campaigns:
        delivery = await store.get_campaign_delivery(username, brand, c.get("id", ""))
        c.setdefault("stats", {})
        c["stats"]["delivered"] = delivery["delivered"]
        c["stats"]["read"] = delivery["read"]
    return {"ok": True, "campaigns": campaigns}


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
