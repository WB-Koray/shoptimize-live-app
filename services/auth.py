"""
services/auth.py
JWT doğrulama — mevcut shoptimize backend ile uyumlu (custom HMAC-SHA256)
"""

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

from fastapi import HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

AUTH_TOKEN_SECRET = os.getenv("AUTH_TOKEN_SECRET", "wb-dashboard-auth-secret")
BILLING_ENABLED   = os.getenv("BILLING_ENABLED", "true").lower() == "true"
PLAN_TRIAL_DAYS   = int(os.getenv("BILLING_TRIAL_DAYS", "7"))
APP_URL           = os.getenv("SHOPIFY_APP_URL", "https://live.shoptimize.com.tr")


def _secret() -> str:
    return AUTH_TOKEN_SECRET.strip() or "wb-dashboard-auth-secret"


def create_access_token(username: str, brand: str = "default", expires_days: int = 30, expires_hours: int = 0) -> str:
    """expires_days=0, expires_hours=1 → 1 saatlik token."""
    ttl = expires_days * 86400 + expires_hours * 3600
    if ttl <= 0:
        ttl = 3600  # varsayılan 1 saat
    payload = {
        "username": username,
        "brand": brand,
        "exp": time.time() + ttl,
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    signature = hmac.new(_secret().encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{signature}"


def decode_access_token(token: str) -> Optional[dict]:
    """Token'ı doğrula ve payload'ı döner. Geçersizse None."""
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, signature = parts
        expected_sig = hmac.new(
            _secret().encode(), payload_b64.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected_sig, signature):
            return None
        padding = 4 - len(payload_b64) % 4
        payload_json = base64.urlsafe_b64decode(payload_b64 + "=" * padding)
        payload = json.loads(payload_json)
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def _check_billing_inline(username: str, brand: str) -> None:
    """
    Her authenticate edilmiş isteğe billing kontrolü uygular.
    DB erişilemezse sessizce geçer (hata fırlatmaz).
    BILLING_ENABLED=false ise tamamen atlar.
    """
    if not BILLING_ENABLED or not username:
        return
    try:
        from services.db import get_setting
        billing_status = get_setting(username, brand, "shopify", "billing_status", "")
        # Kayıt yoksa (self-hosted / doğrudan kurulum) → izin ver
        if not billing_status or billing_status == "active":
            return
        shop = get_setting(username, brand, "shopify", "shop_domain", "")
        retry_url = f"{APP_URL}/auth/shopify/install?shop={shop}" if shop else APP_URL
        if billing_status == "declined":
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "billing_declined",
                    "message": "Abonelik reddedildi. Shoptimize Live'ı kullanmak için ödemeyi onaylamanız gerekiyor.",
                    "retry_url": retry_url,
                },
            )
        if billing_status in ("pending", "cancelled", "frozen"):
            installed_at = int(get_setting(username, brand, "shopify", "installed_at", 0) or 0)
            if installed_at and (time.time() < installed_at + PLAN_TRIAL_DAYS * 86400):
                return  # Deneme süresi dolmamış
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "trial_expired",
                    "message": f"Deneme süreniz doldu ({PLAN_TRIAL_DAYS} gün). Aboneliğinizi aktive edin.",
                    "retry_url": retry_url,
                },
            )
    except HTTPException:
        raise
    except Exception:
        pass  # DB erişilemez → bloke etme


async def get_current_user(request: Request) -> dict:
    """
    FastAPI dependency — Authorization header veya ?token= query param'dan JWT okur.
    SSE endpoint'leri query param kullanır (EventSource header gönderemez).
    """
    token = None

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]

    if not token:
        token = request.query_params.get("token", "")

    if not token:
        raise HTTPException(status_code=401, detail="Token gerekli")

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Geçersiz veya süresi dolmuş token")

    # Trial / billing durumu kontrolü — süresi dolmuşsa 402 fırlat
    _check_billing_inline(
        payload.get("username", ""),
        payload.get("brand", "default"),
    )

    return payload
