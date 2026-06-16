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
PLAN_TRIAL_DAYS = int(os.getenv("BILLING_TRIAL_DAYS", "7"))


def _require_admin(token: str):
    if not ADMIN_TOKEN:
        raise HTTPException(500, "ADMIN_TOKEN ayarlanmamış")
    if token != ADMIN_TOKEN:
        raise HTTPException(403, "Geçersiz admin token")


SHOPIFY_API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2026-04")


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

        # Mağaza adı + token sağlık kontrolü (ek güvence: kaçırılan uninstall webhook'unu yakala)
        shop_name = settings.get("shop_name", "")
        token_for_name = admin_token_val
        if not token_for_name:
            try:
                token_for_name = await store.get_online_token(username, brand) or ""
            except Exception:
                token_for_name = ""
        # Aktif/trial/onay-bekleyen mağazalarda token'ı doğrula (terminal durumları atla)
        need_check = (billing_status not in ("uninstalled", "declined")) and bool(shop_domain) and bool(token_for_name)
        if need_check and (not shop_name or admin_token_val):
            import asyncio as _aio
            info = await _aio.to_thread(_fetch_shop_info, shop_domain, token_for_name)
            if info.get("name"):
                if info["name"] != shop_name:
                    shop_name = info["name"]
                    set_connection_settings(username, brand, "shopify", {"shop_name": shop_name})
            elif info.get("auth_failed") and admin_token_val:
                # Token revoke edilmiş → uygulama kaldırılmış (webhook kaçmış olsa bile yakala)
                billing_status = "uninstalled"
                set_connection_settings(username, brand, "shopify",
                                        {"billing_status": "uninstalled", "admin_api_token": ""})
                logger.info("[ADMIN] token revoke → uninstalled işaretlendi: %s:%s", username, brand)

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
        if tid:
            try:
                active_visitors = await store.get_active_visitor_count(tid)
            except Exception:
                pass

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
            "has_token": bool(admin_token_val),
            "granted_scopes": granted_scopes,
        })

    # Türetilmiş duruma göre sırala (önce aktif, sonra ödeme bekleyen, deneme, bitmiş...)
    STATUS_ORDER = {"active": 0, "needs_billing": 1, "trialing": 2, "trial_ended": 3,
                    "declined": 4, "uninstalled": 5}
    result.sort(key=lambda m: (STATUS_ORDER.get(m["status"], 9), m["username"]))

    return {
        "ok": True,
        "total": len(result),
        "merchants": result,
        "stats": {
            "active":       sum(1 for m in result if m["status"] == "active"),
            "trialing":     sum(1 for m in result if m["status"] == "trialing"),
            "needs_billing":sum(1 for m in result if m["status"] == "needs_billing"),
            "trial_ended":  sum(1 for m in result if m["status"] == "trial_ended"),
            "declined":     sum(1 for m in result if m["status"] == "declined"),
            "uninstalled":  sum(1 for m in result if m["status"] == "uninstalled"),
        },
    }


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
