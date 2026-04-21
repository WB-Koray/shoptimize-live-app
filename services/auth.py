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


def _secret() -> str:
    return AUTH_TOKEN_SECRET.strip() or "wb-dashboard-auth-secret"


def create_access_token(username: str, brand: str = "default", expires_days: int = 30) -> str:
    payload = {
        "username": username,
        "brand": brand,
        "exp": time.time() + expires_days * 86400,
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

    return payload
