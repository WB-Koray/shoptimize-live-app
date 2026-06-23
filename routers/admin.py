"""
routers/admin.py
Operatör admin paneli — tüm merchant'ları ve billing durumlarını döner.
Erişim: GET /api/admin/merchants?admin_token=<ADMIN_TOKEN>
"""

import logging
import os
import time

from fastapi import APIRouter, HTTPException, Query

import json
from services.db import get_all_shopify_connections, set_connection_settings, _get_conn
from services.redis_store import store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin")

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
PLAN_TRIAL_DAYS = int(os.getenv("BILLING_TRIAL_DAYS", "0"))  # Managed pricing → Shopify yönetir
PLAN_PRICE = float(os.getenv("BILLING_PLAN_PRICE", "9.99"))


def _require_admin(token: str):
    if not ADMIN_TOKEN:
        raise HTTPException(500, "ADMIN_TOKEN ayarlanmamış")
    if token != ADMIN_TOKEN:
        raise HTTPException(403, "Geçersiz admin token")


SHOPIFY_API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2026-04")
META_GRAPH = "https://graph.facebook.com/v21.0"


def _check_wa_health(waba_id: str, token: str, phone_id: str = "") -> dict:
    """WhatsApp bağlantı sağlığı: token geçerli mi + onaylı şablon sayısı + GÖNDERİM
    yapılacak telefona erişim var mı (token şablon okuyabilir ama gönderemiyor olabilir).
    status: ok | invalid (token öldü, #190 vb.) | send_blocked (telefon erişimi yok) | error | no_token"""
    import requests as _rq
    if not token:
        return {"status": "no_token"}
    try:
        if waba_id:
            r = _rq.get(
                f"{META_GRAPH}/{waba_id}/message_templates",
                params={"fields": "name,status", "limit": 200, "access_token": token},
                timeout=10,
            )
        else:
            # WABA yoksa en azından token'ı doğrula
            r = _rq.get(f"{META_GRAPH}/debug_token",
                        params={"input_token": token, "access_token": token}, timeout=10)
        body = r.json() or {}
        if r.status_code == 200 and waba_id and "data" in body:
            data = body.get("data", []) or []
            approved = [t for t in data if t.get("status") == "APPROVED"]
            cart = [t for t in approved if str(t.get("name", "")).startswith("sepet_hatirlatma")]
            # Gönderim ön koşulu: token, gönderen telefona erişebiliyor mu? (gönderimsiz test)
            if phone_id:
                pr = _rq.get(f"{META_GRAPH}/{phone_id}",
                             params={"fields": "verified_name,quality_rating,code_verification_status",
                                     "access_token": token}, timeout=10)
                pbody = pr.json() or {}
                if pr.status_code != 200 or pbody.get("error"):
                    perr = pbody.get("error", {}) or {}
                    return {"status": "send_blocked", "approved": len(approved),
                            "cart_approved": len(cart), "total": len(data),
                            "error_code": perr.get("code"),
                            "error": "Telefon erişimi yok (gönderim yapılamaz): "
                                     + str(perr.get("message", ""))[:110]}
                return {"status": "ok", "approved": len(approved),
                        "cart_approved": len(cart), "total": len(data),
                        "quality": pbody.get("quality_rating", "")}
            return {"status": "ok", "approved": len(approved),
                    "cart_approved": len(cart), "total": len(data)}
        if r.status_code == 200 and not waba_id:
            # debug_token başarılı → token canlı ama şablon sayısı bilinmiyor
            err = (body.get("data") or {}).get("error")
            if err:
                return {"status": "invalid", "error_code": err.get("code"),
                        "error": str(err.get("message", ""))[:140]}
            return {"status": "ok", "approved": 0, "cart_approved": 0, "total": 0, "note": "no_waba"}
        err = body.get("error", {}) or {}
        return {"status": "invalid", "error_code": err.get("code"),
                "error": str(err.get("message", ""))[:140]}
    except Exception as e:
        return {"status": "error", "error": str(e)[:140]}


def _fetch_shop_info(domain: str, token: str) -> dict:
    """Mağaza adını çeker + token sağlığını döner.
    {name: str, auth_failed: bool} — auth_failed=True ise token revoke (uninstall sinyali)."""
    import requests as _rq
    d = domain.replace("https://", "").replace("http://", "").strip().rstrip("/")
    if not d or not token:
        return {"name": "", "auth_failed": False}
    # REST: /admin/api/{ver}/shop.json — dar scope'lu token'larda da genelde erişilebilir
    try:
        r = _rq.get(
            f"https://{d}/admin/api/{SHOPIFY_API_VERSION}/shop.json",
            headers={"X-Shopify-Access-Token": token},
            params={"fields": "name"},
            timeout=10,
        )
        if r.status_code == 200:
            name = ((r.json() or {}).get("shop") or {}).get("name", "")
            return {"name": name, "auth_failed": False}
        if r.status_code in (401, 403):
            return {"name": "", "auth_failed": True}  # token revoke → uninstall sinyali
    except Exception as e:
        logger.warning("[ADMIN] shop adı REST hatası %s: %s", d, e)
    # GraphQL fallback (data:null olabilir → defansif)
    try:
        r = _rq.post(
            f"https://{d}/admin/api/{SHOPIFY_API_VERSION}/graphql.json",
            json={"query": "{ shop { name } }"},
            headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"},
            timeout=10,
        )
        if r.status_code in (401, 403):
            return {"name": "", "auth_failed": True}
        body = r.json() if r.status_code == 200 else {}
        data = body.get("data") or {}
        return {"name": (data.get("shop") or {}).get("name", "") or "", "auth_failed": False}
    except Exception as e:
        logger.warning("[ADMIN] shop adı GraphQL hatası %s: %s", d, e)
    return {"name": "", "auth_failed": False}


@router.get("/merchants")
async def list_merchants(admin_token: str = Query(...)):
    """Tüm merchant'ları billing durumu ve event sayısıyla döner."""
    _require_admin(admin_token)

    try:
        connections = get_all_shopify_connections()
    except Exception as e:
        logger.exception("[ADMIN] get_all_shopify_connections hatası")
        raise HTTPException(500, f"DB hatası: {e}")
    now = time.time()
    result = []

    for conn in connections:
        settings = conn.get("connection", {}).get("settings", {})
        username = conn["username"]
        brand = conn["brand"]

        tid = settings.get("pixel_tracking_id", "")
        billing_status = settings.get("billing_status", "none")
        installed_at = int(settings.get("installed_at", 0) or 0)
        shop_domain = settings.get("shop_domain", "")
        granted_scopes = settings.get("granted_scopes", "")
        # Token kök veya nested 'settings' altında olabilir (paylaşımlı DB)
        admin_token_val = settings.get("admin_api_token") or (settings.get("settings") or {}).get("admin_api_token") or ""
        # Sahip telefonu (iletişim için)
        owner_phone = ""
        try:
            owner_phone = await store.get_owner_phone(username, brand)
        except Exception:
            pass

        # WhatsApp bağlı mı (flow ayarları)
        wa_connected = False
        try:
            _fs = await store.get_flow_settings(username, brand)
            wa_connected = bool(_fs.get("wa_token") and _fs.get("phone_number_id"))
        except Exception:
            pass

        # Event sayısı — ömür boyu toplam (buffer llen 5000'de kapanır), ikisinin maks'ı
        event_count = 0
        if tid:
            try:
                buf = await store.count_events(tid)
                total = await store.get_total_events(tid)
                event_count = max(buf, total)
            except Exception:
                pass

        # Aktif ziyaretçi sayısı
        active_visitors = 0
        last_event_ts = 0
        if tid:
            try:
                active_visitors = await store.get_active_visitor_count(tid)
                last_event_ts = await store.get_last_event_ts(tid)
            except Exception:
                pass

        # Takip edilen sipariş + ciro (wa_orders cache)
        orders_count = 0
        revenue = 0.0
        try:
            _orders = await store.get_converted_orders(username, brand, limit=200)
            orders_count = len(_orders)
            revenue = sum(float(o.get("total_price", 0) or 0) for o in _orders)
        except Exception:
            pass

        # HEAL: yanlış "uninstalled" — son 1 saatte aktivite varsa mağaza kesinlikle kurulu
        # (kaldırılmış app event göndermez). Önceki agresif token-check hatasını düzeltir.
        if billing_status == "uninstalled" and last_event_ts and (now * 1000 - last_event_ts) < 3600 * 1000:
            billing_status = "none"
            set_connection_settings(username, brand, "shopify", {"billing_status": "none"})
            logger.info("[ADMIN] yanlış uninstalled düzeltildi (aktivite var): %s:%s", username, brand)

        # Mağaza adı backfill + token sağlık göstergesi
        shop_name = settings.get("shop_name", "")
        token_for_name = admin_token_val
        if not token_for_name:
            try:
                token_for_name = await store.get_online_token(username, brand) or ""
            except Exception:
                token_for_name = ""
        token_invalid = False
        need_check = (billing_status not in ("uninstalled", "declined")) and bool(shop_domain) and bool(token_for_name)
        if need_check and (not shop_name or admin_token_val):
            import asyncio as _aio
            info = await _aio.to_thread(_fetch_shop_info, shop_domain, token_for_name)
            if info.get("name"):
                if info["name"] != shop_name:
                    shop_name = info["name"]
                    set_connection_settings(username, brand, "shopify", {"shop_name": shop_name})
            elif info.get("auth_failed"):
                # 401 = token iptal. Aktif mağazayı korumak için: yalnızca uzun süredir
                # aktivite YOKSA (dormant) uninstalled işaretle. Token'ı SİLME.
                token_invalid = True
                dormant = (not last_event_ts) or (now * 1000 - last_event_ts) > 2 * 86400 * 1000
                if dormant and admin_token_val:
                    billing_status = "uninstalled"
                    set_connection_settings(username, brand, "shopify", {"billing_status": "uninstalled"})
                    logger.info("[ADMIN] token revoke + dormant → uninstalled: %s:%s", username, brand)

        # Deneme süresi hesapla
        trial_ends_at = None
        trial_remaining_hours = None
        if installed_at and billing_status in ("pending", "none", "needs_billing", "cancelled", "frozen"):
            trial_ends_at = installed_at + PLAN_TRIAL_DAYS * 86400
            trial_remaining_hours = max(0, int((trial_ends_at - now) / 3600))

        # Türetilmiş durum — etiket/filtre/istatistik tutarlı olsun diye tek kaynak
        if billing_status == "active":
            status = "active"
        elif billing_status == "declined":
            status = "declined"
        elif billing_status == "uninstalled":
            status = "uninstalled"
        elif billing_status == "needs_billing":
            status = "needs_billing"
        elif (trial_remaining_hours or 0) > 0:
            status = "trialing"
        else:
            status = "trial_ended"

        result.append({
            "username": username,
            "brand": brand,
            "shop_domain": shop_domain,
            "shop_name": shop_name,
            "owner_phone": owner_phone,
            "wa_connected": wa_connected,
            "billing_status": billing_status,
            "status": status,
            "installed_at": installed_at,
            "installed_days_ago": int((now - installed_at) / 86400) if installed_at else None,
            "trial_ends_at": trial_ends_at,
            "trial_remaining_hours": trial_remaining_hours,
            "tid": tid,
            "event_count": event_count,
            "active_visitors": active_visitors,
            "last_event_ts": last_event_ts,
            "orders_count": orders_count,
            "revenue": round(revenue, 2),
            "has_token": bool(admin_token_val),
            "token_invalid": token_invalid,
            "pixel_ready": bool(tid),
            "granted_scopes": granted_scopes,
        })

    # Türetilmiş duruma göre sırala (önce aktif, sonra ödeme bekleyen, deneme, bitmiş...)
    STATUS_ORDER = {"active": 0, "needs_billing": 1, "trialing": 2, "trial_ended": 3,
                    "declined": 4, "uninstalled": 5}
    result.sort(key=lambda m: (STATUS_ORDER.get(m["status"], 9), m["username"]))

    active_n = sum(1 for m in result if m["status"] == "active")
    # Dönüşüm: ücretli / (ücretli + deneme bitmiş + reddetmiş) — denemeyi tamamlamış kitle
    converted_pool = active_n + sum(1 for m in result if m["status"] in ("trial_ended", "declined"))
    conversion = round(active_n / converted_pool * 100, 1) if converted_pool else 0.0

    billing_enabled = os.getenv("BILLING_ENABLED", "true").strip().lower() in ("true", "1", "yes", "on")
    return {
        "ok": True,
        "total": len(result),
        "merchants": result,
        "plan_price": PLAN_PRICE,
        "billing_enabled": billing_enabled,
        "stats": {
            "active":       active_n,
            "trialing":     sum(1 for m in result if m["status"] == "trialing"),
            "needs_billing":sum(1 for m in result if m["status"] == "needs_billing"),
            "trial_ended":  sum(1 for m in result if m["status"] == "trial_ended"),
            "declined":     sum(1 for m in result if m["status"] == "declined"),
            "uninstalled":  sum(1 for m in result if m["status"] == "uninstalled"),
            "mrr":          round(active_n * PLAN_PRICE, 2),
            "conversion":   conversion,
            "total_revenue":round(sum(m["revenue"] for m in result), 2),
        },
    }


async def compute_store_health(conn: dict) -> dict:
    """Tek mağazanın WhatsApp/sepet-kurtarma boru hattı sağlığını döner.
    Hem /api/admin/health endpoint'i hem de periyodik health worker kullanır."""
    import asyncio as _aio
    username = conn["username"]
    brand = conn["brand"]
    settings = conn.get("connection", {}).get("settings", {})
    shop_domain = settings.get("shop_domain", "")
    shop_name = settings.get("shop_name", "") or username
    billing_status = settings.get("billing_status", "none")
    tid = settings.get("pixel_tracking_id", "")
    webhooks_registered = settings.get("webhooks_registered", "") == "wh_v2"

    try:
        owner_phone = await store.get_owner_phone(username, brand)
    except Exception:
        owner_phone = ""
    try:
        fs = await store.get_flow_settings(username, brand)
    except Exception:
        fs = {}
    wa_token = fs.get("wa_token", "")
    waba_id = fs.get("waba_id", "")
    phone_id = fs.get("phone_number_id", "")
    flow_enabled = bool(fs.get("enabled"))
    wa_connected = bool(wa_token and phone_id)

    wa = {"status": "skip"}
    if wa_connected and billing_status != "uninstalled":
        wa = await _aio.to_thread(_check_wa_health, waba_id, wa_token, phone_id)

    problems = []
    if billing_status != "uninstalled":
        if flow_enabled and not wa_connected:
            problems.append("Akış açık ama WhatsApp bağlı değil")
        if wa_connected and wa.get("status") == "invalid":
            code = wa.get("error_code")
            problems.append(f"WA token geçersiz (#{code})" if code else "WA token geçersiz/expired")
        if wa_connected and wa.get("status") == "send_blocked":
            code = wa.get("error_code")
            problems.append(f"WA gönderemiyor — telefon erişimi yok{f' (#{code})' if code else ''}")
        if wa_connected and wa.get("status") == "error":
            problems.append("WA kontrolü yapılamadı (Meta erişim hatası)")
        if wa_connected and wa.get("status") == "ok" and wa.get("cart_approved", 0) == 0:
            problems.append("Onaylı sepet şablonu yok (count=0)")
        if flow_enabled and not webhooks_registered:
            problems.append("Shopify webhook kayıtlı değil")
        if flow_enabled and not tid:
            problems.append("Pixel kurulu değil")

    return {
        "username": username, "brand": brand,
        "shop_name": shop_name, "shop_domain": shop_domain,
        "owner_phone": owner_phone,
        "billing_status": billing_status,
        "flow_enabled": flow_enabled, "wa_connected": wa_connected,
        "waba_id": waba_id, "phone_id": phone_id,
        "webhooks_registered": webhooks_registered, "pixel_ready": bool(tid),
        "wa": wa, "problems": problems, "healthy": len(problems) == 0,
        # worker filtresi için
        "relevant": (flow_enabled or wa_connected) and billing_status != "uninstalled",
    }


@router.get("/health")
async def merchants_health(admin_token: str = Query(...)):
    """Operatör monitöring — her mağaza için WhatsApp/sepet-kurtarma boru hattı
    sağlığı. Sorunlu süreçleri (ölü token, eksik şablon, kayıtsız webhook, kapalı
    akış, eksik pixel) tek bakışta gösterir."""
    _require_admin(admin_token)
    import asyncio as _aio

    try:
        connections = get_all_shopify_connections()
    except Exception as e:
        logger.exception("[ADMIN] health get_all_shopify_connections hatası")
        raise HTTPException(500, f"DB hatası: {e}")

    results = await _aio.gather(*[compute_store_health(c) for c in connections])
    relevant = [r for r in results if r["relevant"]]
    relevant.sort(key=lambda r: (r["healthy"], r["shop_name"].lower()))
    problem_count = sum(1 for r in relevant if not r["healthy"])
    return {"ok": True, "checked": len(relevant),
            "problem_count": problem_count, "merchants": relevant}


@router.post("/test-alert")
async def test_alert(admin_token: str = Query(...)):
    """Operatör bildirim hattını test eder — kendi telefonuna örnek mesaj atar."""
    _require_admin(admin_token)
    from services.notify import notify_operator, is_configured, OPERATOR_ALERT_PHONE
    if not is_configured():
        return {"ok": False, "error": "env_eksik",
                "message": "OPERATOR_WA_TOKEN / OPERATOR_WA_PHONE_ID / OPERATOR_ALERT_PHONE ayarlanmalı."}
    ok = await notify_operator("🔔 Test bildirimi — operatör hattı çalışıyor")
    return {"ok": ok, "to": OPERATOR_ALERT_PHONE[-4:] if OPERATOR_ALERT_PHONE else ""}


@router.post("/setup-operator-template")
def setup_operator_template(admin_token: str = Query(...)):
    """operator_bildirim şablonunu operatör WABA'sında oluşturur (tek seferlik).
    Gerekli env: OPERATOR_WA_TOKEN + OPERATOR_WABA_ID."""
    _require_admin(admin_token)
    import requests as _rq
    token = os.getenv("OPERATOR_WA_TOKEN", "")
    waba = os.getenv("OPERATOR_WABA_ID", "")
    name = os.getenv("OPERATOR_ALERT_TEMPLATE", "operator_bildirim")
    if not token:
        return {"ok": False, "error": "env_eksik",
                "message": "OPERATOR_WA_TOKEN env'i gerekli."}
    # WABA verilmediyse token'dan otomatik bul (debug_token → granular_scopes → target_ids)
    if not waba:
        try:
            dbg = _rq.get(f"{META_GRAPH}/debug_token",
                          params={"input_token": token, "access_token": token}, timeout=12)
            data = (dbg.json() or {}).get("data", {}) or {}
            for gs in data.get("granular_scopes", []) or []:
                if gs.get("scope") in ("whatsapp_business_management", "whatsapp_business_messaging"):
                    tids = gs.get("target_ids") or []
                    if tids:
                        waba = str(tids[0])
                        break
            logger.info("[ADMIN] operator WABA otomatik bulundu: %s", waba or "—")
        except Exception as e:
            logger.warning("[ADMIN] operator WABA debug_token hatası: %s", e)
    if not waba:
        return {"ok": False, "error": "waba_bulunamadi",
                "message": "WABA bulunamadı — OPERATOR_WABA_ID env'ini elle ekleyin."}
    payload = {
        "name": name, "language": "tr", "category": "UTILITY",
        "components": [{
            # Meta kuralı: değişken body'nin başında/sonunda olamaz → sona sabit metin
            "type": "BODY", "text": "Shoptimize bildirimi: {{1}} — Shoptimize Live",
            "example": {"body_text": [["Yeni mağaza kuruldu: ornek.myshopify.com"]]},
        }],
    }
    sent_text = payload["components"][0]["text"]
    logger.info("[ADMIN] setup-operator-template waba=%s gövde=%r", waba, sent_text)
    try:
        r = _rq.post(f"{META_GRAPH}/{waba}/message_templates",
                     params={"access_token": token}, json=payload, timeout=15)
        body = r.json() if r.content else {}
        ok = r.status_code in (200, 201) and not body.get("error")
        logger.info("[ADMIN] setup-operator-template status=%s body=%s", r.status_code, str(body)[:200])
        return {"ok": ok, "status": r.status_code, "sent_text": sent_text, "response": body}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/nudge")
async def nudge_merchant(request_data: dict, admin_token: str = Query(...)):
    """Ödemeyen merchant'ın sahip telefonuna WhatsApp ile dashboard/onay linki gönderir.
    Link açılınca billing aktif değilse 'aboneliği aktive et' ekranına düşer → dönüşüm."""
    _require_admin(admin_token)
    username = str(request_data.get("username", "")).strip()
    brand = str(request_data.get("brand", "default")).strip()
    if not username:
        raise HTTPException(400, "username gerekli")

    phone = await store.get_owner_phone(username, brand)
    if not phone:
        return {"ok": False, "error": "no_phone"}

    op_token = os.getenv("OPERATOR_WA_TOKEN", "")
    op_phone_id = os.getenv("OPERATOR_WA_PHONE_ID", "")
    if not op_token or not op_phone_id:
        return {"ok": False, "error": "wa_not_configured"}

    from services.auth import create_access_token
    from services.db import get_setting
    from services.wa_sender import send_wa_template

    tid = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
    app_url = os.getenv("SHOPIFY_APP_URL", "https://live.shoptimize.com.tr")
    token = create_access_token(username, brand, expires_days=0, expires_hours=1)
    access_url = f"{app_url}/?auto_token={token}&u={username}&b={brand}" + (f"&tid={tid}" if tid else "")

    lang = "tr" if phone.lstrip("+").startswith("90") else "en"
    tpl = "dashboard_erisim" if lang == "tr" else "panel_access"
    res = await send_wa_template(op_token, op_phone_id, phone, name=access_url,
                                 template_name=tpl, language=lang)
    if res.get("ok"):
        logger.info("[ADMIN] nudge gönderildi: %s:%s → %s", username, brand, phone[-4:])
        return {"ok": True, "phone": phone}
    return {"ok": False, "error": res.get("error", "send_failed")}


@router.post("/set-shopify-token")
async def set_shopify_token(
    request_data: dict,
    admin_token: str = Query(...),
):
    """
    Shopify admin_api_token'ı doğrudan DB'ye yazar.
    Kullanım: POST /api/admin/set-shopify-token?admin_token=XXX
    Body: {"username": "...", "brand": "default", "token": "shpat_...", "shop_domain": "xxx.myshopify.com"}
    """
    _require_admin(admin_token)

    username   = str(request_data.get("username", "")).strip()
    brand      = str(request_data.get("brand", "default")).strip() or "default"
    token      = str(request_data.get("token", "")).strip()
    shop_domain = str(request_data.get("shop_domain", "")).strip()

    if not username or not token:
        raise HTTPException(400, "username ve token zorunlu")

    updates: dict = {"admin_api_token": token}
    if shop_domain:
        updates["shop_domain"] = shop_domain

    set_connection_settings(username, brand, "shopify", updates)
    logger.info("[ADMIN] set-shopify-token: username=%s brand=%s shop=%s", username, brand, shop_domain)
    return {"ok": True, "username": username, "brand": brand, "token_set": True}


@router.get("/shopify-records")
async def list_shopify_records(admin_token: str = Query(...)):
    """
    Tüm Shopify integration_connections kayıtlarını gösterir.
    Token'ın son 6 karakterini gösterir (güvenli).
    """
    _require_admin(admin_token)
    import psycopg2.extras
    rows = []
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT username, brand, payload_json FROM integration_connections WHERE integration_id = 'shopify' ORDER BY username"
                )
                for row in cur.fetchall():
                    data = row["payload_json"] or {}
                    if isinstance(data, str):
                        data = json.loads(data)
                    token = data.get("admin_api_token", "")
                    rows.append({
                        "username": row["username"],
                        "brand": row["brand"],
                        "shop_domain": data.get("shop_domain", ""),
                        "has_token": bool(token),
                        "token_tail": ("..." + token[-6:]) if token else "",
                        "keys": list(data.keys()),
                    })
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"ok": True, "records": rows}


@router.post("/copy-shopify-token")
async def copy_shopify_token(
    request_data: dict,
    admin_token: str = Query(...),
):
    """
    Bir kullanıcının admin_api_token'ını başka bir kullanıcıya kopyalar.
    Body: {"from_username": "59fc15-cd", "from_brand": "default",
           "to_username": "koray@...", "to_brand": "default"}
    """
    _require_admin(admin_token)
    import psycopg2.extras

    from_user  = str(request_data.get("from_username", "")).strip()
    from_brand = str(request_data.get("from_brand", "default")).strip() or "default"
    to_user    = str(request_data.get("to_username", "")).strip()
    to_brand   = str(request_data.get("to_brand", "default")).strip() or "default"

    if not from_user or not to_user:
        raise HTTPException(400, "from_username ve to_username zorunlu")

    # Kaynak kaydı oku
    src_token = ""
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT payload_json FROM integration_connections WHERE username=%s AND brand=%s AND integration_id='shopify' LIMIT 1",
                    (from_user, from_brand),
                )
                row = cur.fetchone()
                if row and row["payload_json"]:
                    data = row["payload_json"]
                    if isinstance(data, str):
                        data = json.loads(data)
                    src_token = data.get("admin_api_token", "")
    except Exception as e:
        raise HTTPException(500, f"Kaynak okuma hatası: {e}")

    if not src_token:
        raise HTTPException(404, f"'{from_user}' kaydında admin_api_token yok")

    set_connection_settings(to_user, to_brand, "shopify", {"admin_api_token": src_token})
    logger.info("[ADMIN] copy-shopify-token: %s→%s token_tail=%s", from_user, to_user, src_token[-6:])
    return {"ok": True, "from": from_user, "to": to_user, "token_tail": "..." + src_token[-6:]}
