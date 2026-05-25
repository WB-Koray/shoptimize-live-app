"""
routers/admin.py
Operatör admin paneli — tüm merchant'ları ve billing durumlarını döner.
Erişim: GET /api/admin/merchants?admin_token=<ADMIN_TOKEN>
"""

import logging
import os
import time

from fastapi import APIRouter, HTTPException, Query

from services.db import get_all_shopify_connections
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

    connections = get_all_shopify_connections()
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
            "trialing": sum(1 for m in result if m["billing_status"] in ("pending", "none") and m.get("trial_remaining_hours", 0) > 0),
            "declined": sum(1 for m in result if m["billing_status"] == "declined"),
            "uninstalled": sum(1 for m in result if m["billing_status"] == "uninstalled"),
        },
    }
