"""
PostgreSQL bağlantısı — TID ve webhook token okuma için.
Mevcut shoptimize backend ile aynı DB'yi paylaşır, sadece okur.
"""

import os
import json
import logging
import psycopg2
import psycopg2.extras
from typing import Optional

logger = logging.getLogger(__name__)

DSN = os.getenv(
    "INTEGRATIONS_POSTGRES_DSN",
    os.getenv("DATABASE_URL", "")
)


def _get_conn():
    return psycopg2.connect(DSN)


def get_setting(username: str, brand: str, integration: str, key: str, default=""):
    """
    integrations tablosundan ayar okur.
    Mevcut backend'deki get_setting() ile aynı davranış.
    """
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT settings FROM integrations
                    WHERE username = %s AND brand = %s AND integration = %s
                    LIMIT 1
                    """,
                    (username, brand, integration),
                )
                row = cur.fetchone()
                if row and row["settings"]:
                    settings = row["settings"]
                    if isinstance(settings, str):
                        settings = json.loads(settings)
                    return settings.get(key, default)
    except Exception as e:
        logger.error("[DB] get_setting hatası: %s", e)
    return default


def set_connection_settings(username: str, brand: str, integration: str, updates: dict):
    """
    integrations tablosundaki settings alanını günceller.
    """
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT settings FROM integrations
                    WHERE username = %s AND brand = %s AND integration = %s
                    LIMIT 1
                    """,
                    (username, brand, integration),
                )
                row = cur.fetchone()
                if row:
                    existing = row["settings"] or {}
                    if isinstance(existing, str):
                        existing = json.loads(existing)
                    existing.update(updates)
                    cur.execute(
                        """
                        UPDATE integrations SET settings = %s
                        WHERE username = %s AND brand = %s AND integration = %s
                        """,
                        (json.dumps(existing), username, brand, integration),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO integrations (username, brand, integration, settings)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (username, brand, integration, json.dumps(updates)),
                    )
            conn.commit()
    except Exception as e:
        logger.error("[DB] set_connection_settings hatası: %s", e)


def get_all_shopify_connections():
    """
    Tüm Shopify bağlantılarını döner — TID warmup için.
    """
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT username, brand, settings FROM integrations
                    WHERE integration = 'shopify'
                    """
                )
                rows = cur.fetchall()
                result = []
                for row in rows:
                    settings = row["settings"] or {}
                    if isinstance(settings, str):
                        settings = json.loads(settings)
                    result.append({
                        "username": row["username"],
                        "brand": row["brand"],
                        "connection": {"settings": settings},
                    })
                return result
    except Exception as e:
        logger.error("[DB] get_all_shopify_connections hatası: %s", e)
        return []
