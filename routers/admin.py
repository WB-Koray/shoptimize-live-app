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

        # Event sayısı
        event_count = 0
        if tid:
            try:
                event_count = await store.count_events(tid)
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
        if installed_at and billing_status in ("pending", "none"):
            trial_ends_at = installed_at + PLAN_TRIAL_DAYS * 86400
            trial_remaining_hours = max(0, int((trial_ends_at - now) / 3600))

        result.append({
            "username": username,
            "brand": brand,
            "shop_domain": shop_domain,
            "billing_status": billing_status,
            "installed_at": installed_at,
            "installed_days_ago": int((now - installed_at) / 86400) if installed_at else None,
            "trial_ends_at": trial_ends_at,
            "trial_remaining_hours": trial_remaining_hours,
            "tid": tid,
            "event_count": event_count,
            "active_visitors": active_visitors,
            "has_token": bool(settings.get("admin_api_token")),
            "granted_scopes": granted_scopes,
        })

    # Billing durumuna göre sırala: active → pending → none → declined → uninstalled
    STATUS_ORDER = {"active": 0, "pending": 1, "none": 2, "declined": 3, "uninstalled": 4, "frozen": 5, "cancelled": 6}
    result.sort(key=lambda m: (STATUS_ORDER.get(m["billing_status"], 9), m["username"]))

    return {
        "ok": True,
        "total": len(result),
        "merchants": result,
        "stats": {
            "active": sum(1 for m in result if m["billing_status"] == "active"),
            "trialing": sum(1 for m in result if m["billing_status"] in ("pending", "none") and (m.get("trial_remaining_hours") or 0) > 0),
            "declined": sum(1 for m in result if m["billing_status"] == "declined"),
            "uninstalled": sum(1 for m in result if m["billing_status"] == "uninstalled"),
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
